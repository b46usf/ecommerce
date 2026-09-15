import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DatabaseTransaction } from '../../database/index.js';
import { legalEntities, storeMembers, storeOrigins, stores } from '../../database/schema.js';
import { routeSchema } from '../../shared/contracts.js';
import { encryptSensitive, fingerprint } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { requireStoreRole, requireUser } from '../auth/index.js';
import { assertVersion, boundedText, cursorScope, decodeCursor, encodeCursor, expectedVersion, validateSlug } from './policy.js';
import { audit, presentStore, type PageQuery } from './service.js';

interface StoreParams { storeId: string }
interface StoreCreate { name: string; slug: string; contact_phone: string; legal_entity_id: string }
interface StorePatch { name?: string; contact_phone?: string }
interface OriginWrite { contact_name: string; phone: string; street: string; postal_code: string;
  area_id?: string; latitude?: number; longitude?: number }
interface LegalEntityCreate { kind: 'INDIVIDUAL' | 'COMPANY'; legal_name: string; tax_identifier?: string }

function presentOrigin(row: typeof storeOrigins.$inferSelect) {
  return { id: row.id, created_at: row.createdAt.toISOString(), row_version: row.rowVersion,
    contact_name: row.contactName, phone: row.phone, street: row.street, postal_code: row.postalCode,
    ...(row.areaId === null ? {} : { area_id: row.areaId }),
    ...(row.latitude === null ? {} : { latitude: Number(row.latitude), longitude: Number(row.longitude) }) };
}

function originValues(body: OriginWrite) {
  if ((body.latitude === undefined) !== (body.longitude === undefined) ||
    (body.latitude !== undefined && (!Number.isFinite(body.latitude) || Math.abs(body.latitude) > 90)) ||
    (body.longitude !== undefined && (!Number.isFinite(body.longitude) || Math.abs(body.longitude) > 180))) {
    throw new AppError(422, 'INVALID_COORDINATES', 'Supply latitude and longitude together within valid ranges.');
  }
  const postalCode = boundedText(body.postal_code, 'postal_code', 10);
  if (!/^\d{5}$/.test(postalCode)) throw new AppError(422, 'INVALID_POSTAL_CODE', 'Indonesian postal code must contain five digits.');
  return { contactName: boundedText(body.contact_name, 'contact_name', 150), phone: boundedText(body.phone, 'phone', 32),
    street: boundedText(body.street, 'street', 2000), postalCode,
    areaId: body.area_id === undefined ? null : boundedText(body.area_id, 'area_id', 100),
    latitude: body.latitude?.toFixed(7) ?? null, longitude: body.longitude?.toFixed(7) ?? null };
}

async function lockStore(tx: DatabaseTransaction, storeId: string) {
  const [row] = await tx.select().from(stores).where(eq(stores.id, storeId)).limit(1).for('update');
  if (!row) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  return row;
}

export async function storeRoutes(app: FastifyInstance) {
  app.post<{ Body: LegalEntityCreate }>('/vendor/legal-entities', { schema: routeSchema('createLegalEntity') }, async (request, reply) => {
    const actor = await requireUser(request);
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'createLegalEntity' }, async tx => {
      const taxId = request.body.tax_identifier?.replace(/[.\s-]/g, '');
      if (taxId !== undefined && !/^\d{15,16}$/.test(taxId)) throw new AppError(422, 'INVALID_TAX_IDENTIFIER', 'Tax identifier must contain 15 or 16 digits.');
      const id = randomUUID();
      await tx.insert(legalEntities).values({ id, createdBy: actor.id, kind: request.body.kind,
        legalName: boundedText(request.body.legal_name, 'legal_name', 200), status: 'PENDING',
        taxIdentifierCiphertext: taxId ? encryptSensitive(taxId, app.services.config.dataEncryptionKey, 'tax-identifier') : null,
        taxIdentifierFingerprint: taxId ? fingerprint(taxId, app.services.config.dataEncryptionKey) : null });
      await audit(tx, actor.id, 'legal_entity', id, 'CREATE', request.id, { kind: request.body.kind, status: 'PENDING' });
      const [entity] = await tx.select().from(legalEntities).where(eq(legalEntities.id, id));
      return { statusCode: 201, body: { id, created_at: entity!.createdAt.toISOString(), row_version: entity!.rowVersion,
        kind: entity!.kind, legal_name: entity!.legalName, status: entity!.status,
        tax_identifier_masked: taxId ? `${'*'.repeat(taxId.length - 4)}${taxId.slice(-4)}` : null }, headers: { ETag: '"0"' } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });

  app.get<{ Querystring: PageQuery }>('/vendor/stores', { schema: routeSchema('listMyStores') }, async (request, reply) => {
    const actor = await requireUser(request);
    const scope = cursorScope(['my-stores', actor.id]);
    const cursor = decodeCursor(request.query.cursor, scope);
    const limit = request.query.limit ?? 20;
    const rows = await app.services.db.select({ store: stores }).from(stores).innerJoin(storeMembers, eq(storeMembers.storeId, stores.id))
      .where(and(eq(storeMembers.userId, actor.id), isNull(storeMembers.revokedAt), cursor ? gt(stores.id, cursor.id) : undefined))
      .orderBy(asc(stores.id)).limit(limit + 1);
    const selected = rows.slice(0, limit);
    const last = selected.at(-1)?.store;
    return reply.header('Cache-Control', 'private, no-store').send({ items: selected.map(row => presentStore(row.store)),
      next_cursor: rows.length > limit && last ? encodeCursor({ id: last.id, value: last.id, scope }) : null });
  });

  app.post<{ Body: StoreCreate }>('/vendor/stores', { schema: routeSchema('createStore') }, async (request, reply) => {
    const actor = await requireUser(request);
    const [legal] = await app.services.db.select().from(legalEntities).where(and(eq(legalEntities.id, request.body.legal_entity_id), eq(legalEntities.createdBy, actor.id))).limit(1);
    if (!legal) throw new AppError(404, 'LEGAL_ENTITY_NOT_FOUND', 'Legal entity not found.');
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'createStore' }, async tx => {
      const [entity] = await tx.select().from(legalEntities).where(and(eq(legalEntities.id, request.body.legal_entity_id), eq(legalEntities.createdBy, actor.id))).limit(1).for('update');
      if (!entity) throw new AppError(404, 'LEGAL_ENTITY_NOT_FOUND', 'Legal entity not found.');
      if (entity.status === 'SUSPENDED') throw new AppError(409, 'LEGAL_ENTITY_SUSPENDED', 'Legal entity is suspended.');
      const id = randomUUID();
      await tx.insert(stores).values({ id, legalEntityId: entity.id, name: boundedText(request.body.name, 'name', 200),
        slug: validateSlug(request.body.slug), contactPhone: boundedText(request.body.contact_phone, 'contact_phone', 32), status: 'DRAFT' });
      await tx.insert(storeMembers).values({ storeId: id, userId: actor.id, roleCode: 'OWNER' });
      await audit(tx, actor.id, 'store', id, 'CREATE', request.id, { status: 'DRAFT' });
      const row = await lockStore(tx, id);
      return { statusCode: 201, body: presentStore(row), headers: { ETag: '"0"' } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });

  app.patch<{ Params: StoreParams; Body: StorePatch }>('/vendor/stores/:storeId', { schema: routeSchema('updateStore') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER']);
    const version = expectedVersion(request.headers['if-match']);
    if (Object.keys(request.body).length === 0) throw new AppError(422, 'EMPTY_UPDATE', 'Provide at least one profile field.');
    const result = await app.services.db.transaction(async tx => {
      const row = await lockStore(tx, request.params.storeId);
      assertVersion(row.rowVersion, version);
      const values = { name: request.body.name === undefined ? row.name : boundedText(request.body.name, 'name', 200),
        contactPhone: request.body.contact_phone === undefined ? row.contactPhone : boundedText(request.body.contact_phone, 'contact_phone', 32),
        rowVersion: row.rowVersion + 1, updatedAt: new Date() };
      await tx.update(stores).set(values).where(eq(stores.id, row.id));
      await audit(tx, actor.id, 'store', row.id, 'UPDATE', request.id, { before_version: row.rowVersion, after_version: values.rowVersion });
      return presentStore({ ...row, ...values });
    });
    return reply.header('ETag', `"${result.row_version}"`).send(result);
  });

  app.post<{ Params: StoreParams }>('/vendor/stores/:storeId/submit', { schema: routeSchema('submitStore') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER']);
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'submitStore' }, async tx => {
      const row = await lockStore(tx, request.params.storeId);
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      if (!['DRAFT', 'REJECTED'].includes(row.status)) throw new AppError(409, 'INVALID_STORE_STATE', 'Only draft or rejected stores can be submitted.');
      const [origin] = await tx.select().from(storeOrigins).where(and(eq(storeOrigins.storeId, row.id), eq(storeOrigins.active, true))).limit(1);
      if (!origin || (!origin.areaId && origin.latitude === null)) throw new AppError(422, 'ORIGIN_REQUIRED', 'Provide a shipping origin with an area ID or coordinates before submitting.');
      await tx.update(stores).set({ status: 'SUBMITTED', rowVersion: row.rowVersion + 1, moderationReason: null, updatedAt: new Date() }).where(eq(stores.id, row.id));
      await audit(tx, actor.id, 'store', row.id, 'SUBMIT', request.id, { before: row.status, after: 'SUBMITTED' });
      return { statusCode: 200, body: presentStore({ ...row, status: 'SUBMITTED', rowVersion: row.rowVersion + 1 }), headers: { ETag: `"${row.rowVersion + 1}"` } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });

  app.get<{ Params: StoreParams }>('/vendor/stores/:storeId/origin', { schema: routeSchema('getOrigin') }, async (request, reply) => {
    await requireStoreRole(request, request.params.storeId, ['OWNER', 'FULFILLMENT']);
    const [row] = await app.services.db.select().from(storeOrigins).where(and(eq(storeOrigins.storeId, request.params.storeId), eq(storeOrigins.active, true))).limit(1);
    if (!row) throw new AppError(404, 'ORIGIN_NOT_FOUND', 'Store shipping origin not found.');
    return reply.header('ETag', `"${row.rowVersion}"`).send(presentOrigin(row));
  });

  app.put<{ Params: StoreParams; Body: OriginWrite }>('/vendor/stores/:storeId/origin', { schema: routeSchema('setOrigin') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER']);
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'setOrigin' }, async tx => {
      const store = await lockStore(tx, request.params.storeId);
      const values = originValues(request.body);
      await tx.update(storeOrigins).set({ active: false, updatedAt: new Date() }).where(and(eq(storeOrigins.storeId, store.id), eq(storeOrigins.active, true)));
      const id = randomUUID();
      await tx.insert(storeOrigins).values({ id, storeId: store.id, ...values });
      await tx.update(stores).set({ rowVersion: store.rowVersion + 1, updatedAt: new Date() }).where(eq(stores.id, store.id));
      await audit(tx, actor.id, 'store', store.id, 'SET_ORIGIN', request.id, { origin_id: id });
      const [origin] = await tx.select().from(storeOrigins).where(eq(storeOrigins.id, id));
      return { statusCode: 200, body: presentOrigin(origin!), headers: { ETag: '"0"' } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });
}
