import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Ajv } from 'ajv';
import type { DatabaseTransaction } from '../../database/index.js';
import { auditLogs, categories, legalEntities, storeMembers, storeOrigins, stores, taxClasses, users } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { routeSchema } from '../../shared/contracts.js';
import { executeIdempotent, type MutationResult } from '../../shared/idempotency.js';
import { requireAdminRole } from '../auth/index.js';
import { assertVersion, boundedText, cursorScope, decodeCursor, encodeCursor, expectedVersion, validateSlug } from '../catalog/policy.js';

type Decision = { decision: 'APPROVE' | 'REJECT'; reason: string };
type CategoryWrite = { name: string; slug: string; parent_id?: string | null; attribute_schema?: Record<string, unknown> };
type Page = { cursor?: string; limit?: number };
type EntityRow = typeof legalEntities.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type StoreRow = typeof stores.$inferSelect;
type TaxClassRow = typeof taxClasses.$inferSelect;
const schemaValidator = new Ajv({ strict: false, validateFormats: false });

function base(row: { id: string; createdAt: Date; rowVersion: number }) {
  return { id: row.id, created_at: row.createdAt.toISOString(), row_version: row.rowVersion };
}
function presentEntity(row: EntityRow) {
  return { ...base(row), kind: row.kind, legal_name: row.legalName, status: row.status,
    tax_identifier_masked: row.taxIdentifierCiphertext ? '********' : null };
}
function presentStore(row: StoreRow) { return { ...base(row), name: row.name, slug: row.slug, status: row.status }; }
function presentCategory(row: CategoryRow) {
  return { ...base(row), name: row.name, slug: row.slug, parent_id: row.parentId, attribute_schema: row.attributeSchema };
}
function presentTaxClass(row: TaxClassRow) { return { ...base(row), code: row.code, name: row.name, status: row.status }; }
function respond(reply: FastifyReply, result: MutationResult) {
  return reply.headers(result.headers ?? {}).code(result.statusCode).send(result.body);
}
function mutation(body: { row_version: number }, statusCode = 200): MutationResult {
  return { statusCode, body, headers: { ETag: `"${body.row_version}"` } };
}
function reason(value: string): string {
  const clean = boundedText(value, 'reason', 2000);
  if (clean.length < 3) throw new AppError(422, 'INVALID_REASON', 'Alasan harus berisi minimal tiga karakter.');
  return clean;
}
async function audit(tx: DatabaseTransaction, actorId: string, entityType: string, entityId: string,
  action: string, correlationId: string, changes: Record<string, unknown>, explanation?: string) {
  await tx.insert(auditLogs).values({ actorId, entityType, entityId, action, correlationId,
    changesRedacted: changes, reason: explanation ?? null });
}

function attributeSchema(value: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(value).length > 20_000) throw new AppError(422, 'INVALID_ATTRIBUTE_SCHEMA', 'Schema atribut terlalu besar.');
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12) throw new AppError(422, 'INVALID_ATTRIBUTE_SCHEMA', 'Schema atribut terlalu dalam.');
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      // Regex and remote references could make validation of untrusted product attributes unbounded.
      if (['$ref', '$dynamicRef', 'pattern', 'patternProperties'].includes(key)) {
        throw new AppError(422, 'INVALID_ATTRIBUTE_SCHEMA', 'Referensi dan pola regex tidak didukung pada schema atribut.');
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  try { schemaValidator.compile(value); } catch {
    throw new AppError(422, 'INVALID_ATTRIBUTE_SCHEMA', 'Schema atribut bukan JSON Schema yang valid.');
  }
  return value;
}

/** Category edits serialize on the small taxonomy to prevent concurrent reparenting cycles. */
async function categoryValues(tx: DatabaseTransaction, id: string, body: CategoryWrite) {
  const all = await tx.select({ id: categories.id, parentId: categories.parentId }).from(categories)
    .orderBy(asc(categories.id)).for('update');
  const parents = new Map(all.map(row => [row.id, row.parentId]));
  const seen = new Set([id]);
  let ancestor = body.parent_id ?? null;
  while (ancestor !== null) {
    if (seen.has(ancestor)) throw new AppError(422, 'CATEGORY_CYCLE', 'Kategori tidak boleh menjadi turunan dirinya sendiri.');
    seen.add(ancestor);
    if (!parents.has(ancestor)) throw new AppError(422, 'CATEGORY_PARENT_NOT_FOUND', 'Kategori induk tidak ditemukan.');
    ancestor = parents.get(ancestor) ?? null;
  }
  return { name: boundedText(body.name, 'name', 200), slug: validateSlug(body.slug),
    parentId: body.parent_id ?? null, attributeSchema: attributeSchema(body.attribute_schema ?? {}) };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Page }>('/admin/stores', { schema: routeSchema('listAdminStores') }, async request => {
    await requireAdminRole(request, ['OPERATIONS']);
    const scope = cursorScope('admin:stores');
    const cursor = decodeCursor(request.query.cursor, scope);
    const limit = request.query.limit ?? 20;
    const rows = await app.services.db.select().from(stores).where(cursor ? gt(stores.id, cursor.id) : undefined)
      .orderBy(asc(stores.id)).limit(limit + 1);
    const selected = rows.slice(0, limit), last = selected.at(-1);
    return { items: selected.map(presentStore), next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.id, value: last.id }) : null };
  });

  app.get<{ Querystring: Page }>('/admin/legal-entities', { schema: routeSchema('listLegalEntities') }, async request => {
    await requireAdminRole(request, ['OPERATIONS', 'FINANCE']);
    const scope = cursorScope('admin:legal-entities');
    const cursor = decodeCursor(request.query.cursor, scope);
    const limit = request.query.limit ?? 20;
    const rows = await app.services.db.select().from(legalEntities).where(cursor ? gt(legalEntities.id, cursor.id) : undefined)
      .orderBy(asc(legalEntities.id)).limit(limit + 1);
    const selected = rows.slice(0, limit), last = selected.at(-1);
    return { items: selected.map(presentEntity), next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.id, value: last.id }) : null };
  });

  app.post<{ Params: { legalEntityId: string }; Body: Decision }>('/admin/legal-entities/:legalEntityId/decision', {
    schema: routeSchema('verifyLegalEntity'),
  }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['OPERATIONS', 'FINANCE']);
    const explanation = reason(request.body.reason);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'verifyLegalEntity' }, async tx => {
      const [row] = await tx.select().from(legalEntities).where(eq(legalEntities.id, request.params.legalEntityId)).limit(1).for('update');
      if (!row) throw new AppError(404, 'LEGAL_ENTITY_NOT_FOUND', 'Entitas penjual tidak ditemukan.');
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      if (!['PENDING', 'SUSPENDED'].includes(row.status) || row.isPlatform) throw new AppError(409, 'INVALID_STATE', 'Entitas ini tidak sedang menunggu verifikasi.');
      const status = request.body.decision === 'APPROVE' ? 'VERIFIED' : 'SUSPENDED';
      await tx.update(legalEntities).set({ status, rowVersion: row.rowVersion + 1 }).where(eq(legalEntities.id, row.id));
      await audit(tx, actor.id, 'LEGAL_ENTITY', row.id, 'LEGAL_ENTITY_DECISION', request.id, { from: row.status, to: status }, explanation);
      return mutation(presentEntity({ ...row, status, rowVersion: row.rowVersion + 1 }));
    }));
  });

  app.post<{ Params: { storeId: string }; Body: Decision }>('/admin/stores/:storeId/decision', {
    schema: routeSchema('decideStore'),
  }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['OPERATIONS']);
    const explanation = reason(request.body.reason);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'decideStore' }, async tx => {
      const [row] = await tx.select().from(stores).where(eq(stores.id, request.params.storeId)).limit(1).for('update');
      if (!row) throw new AppError(404, 'STORE_NOT_FOUND', 'Toko tidak ditemukan.');
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      if (row.status !== 'SUBMITTED') throw new AppError(409, 'INVALID_STATE', 'Hanya toko yang telah diajukan dapat ditinjau.');
      const status = request.body.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      if (status === 'ACTIVE') {
        const [entity] = await tx.select().from(legalEntities).where(eq(legalEntities.id, row.legalEntityId)).limit(1).for('update');
        const [owner] = await tx.select({ id: users.id, status: users.status, verified: users.emailVerifiedAt }).from(storeMembers)
          .innerJoin(users, eq(users.id, storeMembers.userId))
          .where(and(eq(storeMembers.storeId, row.id), eq(storeMembers.roleCode, 'OWNER'), isNull(storeMembers.revokedAt))).limit(1).for('update');
        const [origin] = await tx.select().from(storeOrigins).where(and(eq(storeOrigins.storeId, row.id), eq(storeOrigins.active, true))).limit(1).for('update');
        if (entity?.status !== 'VERIFIED' || !owner || owner.status !== 'ACTIVE' || !owner.verified || !origin) {
          throw new AppError(422, 'STORE_INCOMPLETE', 'Persetujuan memerlukan entitas terverifikasi, pemilik aktif dengan email terverifikasi, dan asal pengiriman.');
        }
      }
      await tx.update(stores).set({ status, reviewedBy: actor.id, reviewedAt: new Date(), moderationReason: explanation, rowVersion: row.rowVersion + 1 }).where(eq(stores.id, row.id));
      await audit(tx, actor.id, 'STORE', row.id, 'STORE_DECISION', request.id, { from: row.status, to: status }, explanation);
      return mutation(presentStore({ ...row, status, rowVersion: row.rowVersion + 1 }));
    }));
  });

  app.post<{ Params: { storeId: string }; Body: { reason: string } }>('/admin/stores/:storeId/suspend', {
    schema: routeSchema('suspendStore'),
  }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['OPERATIONS']);
    const explanation = reason(request.body.reason);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'suspendStore' }, async tx => {
      const [row] = await tx.select().from(stores).where(eq(stores.id, request.params.storeId)).limit(1).for('update');
      if (!row) throw new AppError(404, 'STORE_NOT_FOUND', 'Toko tidak ditemukan.');
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      if (row.status !== 'ACTIVE') throw new AppError(409, 'INVALID_STATE', 'Hanya toko aktif dapat ditangguhkan.');
      await tx.update(stores).set({ status: 'SUSPENDED', moderationReason: explanation, reviewedBy: actor.id, reviewedAt: new Date(), rowVersion: row.rowVersion + 1 }).where(eq(stores.id, row.id));
      await audit(tx, actor.id, 'STORE', row.id, 'STORE_SUSPENDED', request.id, { from: row.status, to: 'SUSPENDED' }, explanation);
      return mutation(presentStore({ ...row, status: 'SUSPENDED', rowVersion: row.rowVersion + 1 }));
    }));
  });

  app.post<{ Body: CategoryWrite }>('/admin/categories', { schema: routeSchema('createCategory') }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['OPERATIONS']);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'createCategory' }, async tx => {
      const id = randomUUID(), values = await categoryValues(tx, id, request.body);
      await tx.insert(categories).values({ id, ...values });
      const [row] = await tx.select().from(categories).where(eq(categories.id, id));
      await audit(tx, actor.id, 'CATEGORY', id, 'CATEGORY_CREATED', request.id, { name: values.name, slug: values.slug, parent_id: values.parentId });
      return mutation(presentCategory(row!), 201);
    }));
  });

  app.put<{ Params: { categoryId: string }; Body: CategoryWrite }>('/admin/categories/:categoryId', {
    schema: routeSchema('updateCategory'),
  }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['OPERATIONS']);
    // PUT is naturally idempotent and the supplied OpenAPI requires only If-Match here.
    const result = await app.services.db.transaction(async tx => {
      const values = await categoryValues(tx, request.params.categoryId, request.body);
      const [row] = await tx.select().from(categories).where(eq(categories.id, request.params.categoryId)).limit(1).for('update');
      if (!row) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Kategori tidak ditemukan.');
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      await tx.update(categories).set({ ...values, rowVersion: row.rowVersion + 1 }).where(eq(categories.id, row.id));
      await audit(tx, actor.id, 'CATEGORY', row.id, 'CATEGORY_UPDATED', request.id, { name: values.name, slug: values.slug, parent_id: values.parentId, row_version: row.rowVersion + 1 });
      return mutation(presentCategory({ ...row, ...values, rowVersion: row.rowVersion + 1 }));
    });
    return respond(reply, result);
  });

  app.get<{ Querystring: Page }>('/admin/tax-classes', { schema: routeSchema('listTaxClasses') }, async request => {
    await requireAdminRole(request, ['OPERATIONS', 'FINANCE']);
    const scope = cursorScope('admin:tax-classes'), cursor = decodeCursor(request.query.cursor, scope);
    const limit = request.query.limit ?? 20;
    const rows = await app.services.db.select().from(taxClasses).where(cursor ? gt(taxClasses.id, cursor.id) : undefined)
      .orderBy(asc(taxClasses.id)).limit(limit + 1);
    const selected = rows.slice(0, limit), last = selected.at(-1);
    return { items: selected.map(presentTaxClass), next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.id, value: last.id }) : null };
  });

  app.post<{ Body: { code: string; name: string } }>('/admin/tax-classes', { schema: routeSchema('createTaxClass') }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['FINANCE']);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'createTaxClass' }, async tx => {
      const id = randomUUID(), code = boundedText(request.body.code, 'code', 50), name = boundedText(request.body.name, 'name', 150);
      await tx.insert(taxClasses).values({ id, code, name, status: 'UNVERIFIED' });
      const [row] = await tx.select().from(taxClasses).where(eq(taxClasses.id, id));
      await audit(tx, actor.id, 'TAX_CLASS', id, 'TAX_CLASS_CREATED', request.id, { code, name });
      return mutation(presentTaxClass(row!), 201);
    }));
  });

  app.post<{ Params: { taxClassId: string }; Body: { reason: string } }>('/admin/tax-classes/:taxClassId/activate', {
    schema: routeSchema('activateTaxClass'),
  }, async (request, reply) => {
    const actor = await requireAdminRole(request, ['FINANCE']);
    const explanation = reason(request.body.reason);
    return respond(reply, await executeIdempotent(request, { actorId: actor.id, operation: 'activateTaxClass' }, async tx => {
      const [row] = await tx.select().from(taxClasses).where(eq(taxClasses.id, request.params.taxClassId)).limit(1).for('update');
      if (!row) throw new AppError(404, 'TAX_CLASS_NOT_FOUND', 'Kelas pajak tidak ditemukan.');
      assertVersion(row.rowVersion, expectedVersion(request.headers['if-match']));
      if (row.status !== 'UNVERIFIED') throw new AppError(409, 'INVALID_STATE', 'Kelas pajak harus belum terverifikasi.');
      await tx.update(taxClasses).set({ status: 'ACTIVE', rowVersion: sql`${taxClasses.rowVersion} + 1` }).where(eq(taxClasses.id, row.id));
      await audit(tx, actor.id, 'TAX_CLASS', row.id, 'TAX_CLASS_ACTIVATED', request.id, { from: row.status, to: 'ACTIVE' }, explanation);
      return mutation(presentTaxClass({ ...row, status: 'ACTIVE', rowVersion: row.rowVersion + 1 }));
    }));
  });
}
