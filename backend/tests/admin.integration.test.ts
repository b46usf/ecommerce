import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/index.js';
import { adminGrants, auditLogs, categories, legalEntities, storeMembers, storeOrigins, stores, users } from '../src/database/schema.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { AppError } from '../src/shared/errors.js';
import { adminRoutes } from '../src/modules/admin/index.js';
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js';
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('admin authorization and moderation against InnoDB', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Expected a dedicated _test database.');
    database = createDatabase({ databaseUrl });
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.decorate('services', {
      db: database.db, config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl,
        REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'admin-integration-secret-at-least-32-characters' }),
      redis: { get: async (key: string) => sessions.get(key) ?? null,
        set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; },
        del: async (key: string) => sessions.delete(key) ? 1 : 0 },
      checkDatabase: database.ping, close: async () => {},
    } as unknown as Services);
    app.setErrorHandler((error, _request, reply) => {
      const err = error as Error & { validation?: unknown };
      reply.code(error instanceof AppError ? error.statusCode : err.validation ? 400 : 500)
        .send({ message: error instanceof Error ? error.message : 'Unknown error' });
    });
    await app.register(cookie);
    registerSessionHooks(app);
    app.addHook('preValidation', async request => {
      if (['POST', 'PUT'].includes(request.method)) requireCsrf(request);
    });
    await app.register(adminRoutes, { prefix: '/api/v1' });
    await app.ready();
  });
  afterAll(async () => { if (app) await app.close(); if (database) await database.close(); });

  async function fixture() {
    const adminId = randomUUID(), ownerId = randomUUID(), legalId = randomUUID(), storeId = randomUUID();
    const passwordHash = 'admin-integration-password-hash';
    await database.db.insert(users).values([
      { id: adminId, name: 'Operations', emailNormalized: `${adminId}@example.test`, passwordHash, emailVerifiedAt: new Date() },
      { id: ownerId, name: 'Owner', emailNormalized: `${ownerId}@example.test`, passwordHash, emailVerifiedAt: new Date() },
    ]);
    await database.db.insert(adminGrants).values({ userId: adminId, roleCode: 'OPERATIONS' });
    await database.db.insert(legalEntities).values({ id: legalId, createdBy: ownerId, legalName: 'Admin Test Entity', kind: 'INDIVIDUAL', status: 'PENDING' });
    await database.db.insert(stores).values({ id: storeId, legalEntityId: legalId, name: 'Review Store', slug: `store-${storeId}`, contactPhone: '+62800111222', status: 'SUBMITTED' });
    await database.db.insert(storeMembers).values({ storeId, userId: ownerId, roleCode: 'OWNER' });
    const token = randomToken(), csrfToken = randomToken();
    sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({ userId: adminId,
      passwordVersion: tokenHash(passwordHash), csrfToken, expiresAt: Date.now() + 60_000 }));
    const headers = { cookie: `marketplace_session=${token}`, 'x-csrf-token': csrfToken };
    return { adminId, ownerId, legalId, storeId, headers };
  }

  it('requires verification and shipping origin before approval, then supports suspension with version checks', async () => {
    const f = await fixture();
    const decision = { decision: 'APPROVE', reason: 'Manual evidence checked' };
    const storeUrl = `/api/v1/admin/stores/${f.storeId}/decision`;
    const blocked = await app.inject({ method: 'POST', url: storeUrl, payload: decision,
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(blocked.statusCode, blocked.body).toBe(422);
    const entity = await app.inject({ method: 'POST', url: `/api/v1/admin/legal-entities/${f.legalId}/decision`, payload: decision,
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(entity.statusCode, entity.body).toBe(200);
    expect(entity.json().status).toBe('VERIFIED');
    const missingOrigin = await app.inject({ method: 'POST', url: storeUrl, payload: decision,
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(missingOrigin.statusCode, missingOrigin.body).toBe(422);
    await database.db.insert(storeOrigins).values({ storeId: f.storeId, contactName: 'Owner', phone: '+62800111222', street: 'Test Street', postalCode: '12345' });
    const approved = await app.inject({ method: 'POST', url: storeUrl, payload: decision,
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'ACTIVE', row_version: 1 });
    const suspendUrl = `/api/v1/admin/stores/${f.storeId}/suspend`;
    const stale = await app.inject({ method: 'POST', url: suspendUrl, payload: { reason: 'Policy violation' },
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(stale.statusCode, stale.body).toBe(412);
    const suspended = await app.inject({ method: 'POST', url: suspendUrl, payload: { reason: 'Policy violation' },
      headers: { ...f.headers, 'idempotency-key': randomUUID(), 'if-match': '"1"' } });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json()).toMatchObject({ status: 'SUSPENDED', row_version: 2 });
    const audit = await database.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.storeId), eq(auditLogs.action, 'STORE_SUSPENDED')));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.reason).toBe('Policy violation');
  });

  it('replays category creation exactly once and rejects replay after the admin grant is revoked', async () => {
    const f = await fixture();
    const request = { method: 'POST' as const, url: '/api/v1/admin/categories',
      headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { name: 'Category', slug: `category-${randomUUID()}` } };
    const first = await app.inject(request), replay = await app.inject(request);
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const audit = await database.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, first.json().id), eq(auditLogs.action, 'CATEGORY_CREATED')));
    expect(audit).toHaveLength(1);
    await database.db.update(adminGrants).set({ revokedAt: new Date() }).where(eq(adminGrants.userId, f.adminId));
    const denied = await app.inject(request);
    expect(denied.statusCode, denied.body).toBe(403);
  });

  it('prevents category cycles and separates operations from finance permissions', async () => {
    const f = await fixture();
    const parentId = randomUUID(), childId = randomUUID();
    await database.db.insert(categories).values({ id: parentId, name: 'Parent', slug: `parent-${parentId}` });
    await database.db.insert(categories).values({ id: childId, name: 'Child', slug: `child-${childId}`, parentId });
    const cycle = await app.inject({ method: 'PUT', url: `/api/v1/admin/categories/${parentId}`,
      headers: { ...f.headers, 'if-match': '"0"' }, payload: { name: 'Parent', slug: `parent-${parentId}`, parent_id: childId } });
    expect(cycle.statusCode, cycle.body).toBe(422);
    const [stored] = await database.db.select().from(categories).where(eq(categories.id, parentId));
    expect(stored?.parentId).toBeNull();
    const financeOnly = await app.inject({ method: 'POST', url: '/api/v1/admin/tax-classes',
      headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { code: 'TEST', name: 'Tax metadata' } });
    expect(financeOnly.statusCode, financeOnly.body).toBe(403);
  });
});
