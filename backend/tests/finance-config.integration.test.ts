import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/database/index.js';
import { adminGrants, bankAccounts, categories, documents, legalEntities, storeMembers, stores, taxClasses, users } from '../src/database/schema.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { AppError } from '../src/shared/errors.js';
import { decryptSensitive } from '../src/shared/crypto.js';
import { financeConfigRoutes } from '../src/modules/finance-config/index.js';
import { documentsRoutes } from '../src/modules/documents/index.js';
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js';
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('finance configuration and private documents against InnoDB', () => {
  let database: ReturnType<typeof createDatabase>, app: FastifyInstance, scanner: Server;
  const objects = new Map<string, Buffer>(), sessions = new Map<string, string>();
  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Expected isolated _test database.');
    database = createDatabase({ databaseUrl });
    scanner = createServer(socket => {
      let input = Buffer.alloc(0), cursor = 10;
      const chunks: Buffer[] = [];
      socket.on('data', chunk => {
        input = Buffer.concat([input, Buffer.from(chunk)]);
        while (input.length >= cursor + 4) {
          const length = input.readUInt32BE(cursor);
          if (input.length < cursor + 4 + length) return;
          cursor += 4;
          if (!length) {
            const content = Buffer.concat(chunks);
            socket.end(content.includes(Buffer.from('EICAR')) ? 'stream: Eicar-Test-Signature FOUND\0' : content.includes(Buffer.from('SCANERROR')) ? 'stream: scanner failure ERROR\0' : 'stream: OK\0'); return;
          }
          chunks.push(input.subarray(cursor, cursor + length)); cursor += length;
        }
      });
    });
    scanner.listen(0, '127.0.0.1'); await once(scanner, 'listening');
    const address = scanner.address();
    if (!address || typeof address === 'string') throw new Error('Scanner binding unavailable.');
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array)); return {}; }
      if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
      if (command instanceof GetObjectCommand) {
        const object = objects.get(command.input.Key!);
        if (!object) throw new Error('Object missing');
        return { ContentLength: object.length, Body: { transformToByteArray: async () => object } };
      }
      throw new Error('Unexpected object storage command');
    });
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'finance-integration-secret-with-32-characters', S3_ENDPOINT: 'http://127.0.0.1:9999',
      S3_BUCKET: 'private-test', S3_ACCESS_KEY_ID: 'local-test', S3_SECRET_ACCESS_KEY: 'local-test-secret',
      CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(address.port), CLAMAV_TIMEOUT_MS: '1000' });
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.decorate('services', { db: database.db, config, redis: {
      get: async (key: string) => sessions.get(key) ?? null,
      set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; },
      del: async (key: string) => sessions.delete(key) ? 1 : 0,
    }, checkDatabase: database.ping, close: async () => {} } as unknown as Services);
    app.setErrorHandler((error, _request, reply) => {
      const err = error as Error & { validation?: unknown };
      reply.code(error instanceof AppError ? error.statusCode : err.validation ? 400 : 500).send({ message: err.message });
    });
    await app.register(cookie); await app.register(multipart);
    registerSessionHooks(app);
    app.addHook('preValidation', async request => { if (['POST', 'PUT'].includes(request.method)) requireCsrf(request); });
    await app.register(async api => { await financeConfigRoutes(api); await documentsRoutes(api); }, { prefix: '/api/v1' });
    await app.ready();
  });
  afterAll(async () => {
    if (app) await app.close(); if (database) await database.close();
    if (scanner) await new Promise<void>(resolve => scanner.close(() => resolve()));
    vi.restoreAllMocks();
  });
  async function fixture() {
    const ownerId = randomUUID(), financeId = randomUUID(), strangerId = randomUUID(), legalId = randomUUID(), storeId = randomUUID();
    const passwordHash = 'finance-integration-hash';
    await database.db.insert(users).values([ownerId, financeId, strangerId].map(id => ({ id, name: 'Test Actor', emailNormalized: `${id}@example.test`, passwordHash, emailVerifiedAt: new Date() })));
    await database.db.insert(adminGrants).values({ userId: financeId, roleCode: 'FINANCE' });
    await database.db.insert(legalEntities).values({ id: legalId, createdBy: ownerId, legalName: 'Finance Test Entity', kind: 'INDIVIDUAL', status: 'VERIFIED' });
    await database.db.insert(stores).values({ id: storeId, legalEntityId: legalId, name: 'Finance Store', slug: `finance-${storeId}`, contactPhone: '+6280011122', status: 'ACTIVE' });
    await database.db.insert(storeMembers).values({ storeId, userId: ownerId, roleCode: 'OWNER' });
    const headers = (userId: string) => {
      const token = randomToken(), csrfToken = randomToken();
      sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({ userId, passwordVersion: tokenHash(passwordHash), csrfToken, expiresAt: Date.now() + 120_000 }));
      return { cookie: `marketplace_session=${token}`, 'x-csrf-token': csrfToken };
    };
    return { ownerId, financeId, legalId, storeId, owner: headers(ownerId), finance: headers(financeId), stranger: headers(strangerId) };
  }
  const post = (url: string, headers: Record<string, string>, payload: unknown, rowVersion?: number) => app.inject({ method: 'POST', url,
    headers: { ...headers, 'idempotency-key': randomUUID(), ...(rowVersion === undefined ? {} : { 'if-match': `"${rowVersion}"` }) }, payload: payload as any });
  function upload(legalId: string, headers: Record<string, string>, contents = '%PDF-1.4\n%%EOF') {
    const boundary = `test-${randomUUID()}`;
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\nOTHER\r\n--${boundary}\r\nContent-Disposition: form-data; name="legal_entity_id"\r\n\r\n${legalId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="private.pdf"\r\nContent-Type: application/pdf\r\n\r\n${contents}\r\n--${boundary}--\r\n`);
    return app.inject({ method: 'POST', url: '/api/v1/documents', headers: { ...headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  }

  it('encrypts bank accounts, scopes vendor access, and requires finance for verification', async () => {
    const f = await fixture();
    const created = await post(`/api/v1/vendor/stores/${f.storeId}/bank-accounts`, f.owner, { bank_code: 'bca', account_name: 'Legal Owner', account_number: '0012-3456 789' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().account_number_masked).toBe('*******6789');
    expect(created.body).not.toContain('00123456789');
    const [stored] = await database.db.select().from(bankAccounts).where(eq(bankAccounts.id, created.json().id));
    expect(decryptSensitive(stored!.accountNumberCiphertext, app.services.config.dataEncryptionKey, 'bank-account-number')).toBe('00123456789');
    const foreign = await app.inject({ url: `/api/v1/vendor/stores/${f.storeId}/bank-accounts`, headers: f.stranger });
    expect(foreign.statusCode).toBe(403);
    const denied = await post(`/api/v1/admin/bank-accounts/${created.json().id}/decision`, f.owner, { decision: 'APPROVE', reason: 'Verified identity' }, 0);
    expect(denied.statusCode).toBe(403);
    const approved = await post(`/api/v1/admin/bank-accounts/${created.json().id}/decision`, f.finance, { decision: 'APPROVE', reason: 'Verified identity' }, 0);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().status).toBe('VERIFIED');
  });

  it('stores scanned documents encrypted and binds download signatures to the authorized user', async () => {
    const f = await fixture(), uploaded = await upload(f.legalId, f.owner);
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const [stored] = await database.db.select().from(documents).where(eq(documents.id, uploaded.json().id));
    expect(objects.get(stored!.objectKey)?.includes(Buffer.from('%PDF-1.4'))).toBe(false);
    const metadata = await app.inject({ url: `/api/v1/documents/${stored!.id}`, headers: f.owner });
    expect(metadata.statusCode, metadata.body).toBe(200);
    const url = new URL(metadata.json().download_url);
    const download = await app.inject({ url: `${url.pathname}${url.search}`, headers: f.owner });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe('%PDF-1.4\n%%EOF');
    const stolen = await app.inject({ url: `${url.pathname}${url.search}`, headers: f.stranger });
    expect(stolen.statusCode).toBe(403);
    const expired = new URL(url); expired.searchParams.set('expires', '0');
    expect((await app.inject({ url: `${expired.pathname}${expired.search}`, headers: f.owner })).statusCode).toBe(403);
    const denied = await upload(f.legalId, f.stranger);
    expect(denied.statusCode).toBe(404);
    const malware = await upload(f.legalId, f.owner, '%PDF-1.4\nEICAR\n%%EOF');
    expect(malware.statusCode, malware.body).toBe(422);
    const scannerFailure = await upload(f.legalId, f.owner, '%PDF-1.4\nSCANERROR\n%%EOF');
    expect(scannerFailure.statusCode, scannerFailure.body).toBe(503);
  });

  it('serializes overlapping fee policy activation even across different policy keys', async () => {
    const f = await fixture(), categoryId = randomUUID();
    await database.db.insert(categories).values({ id: categoryId, name: 'Policy Scope', slug: `policy-${categoryId}` });
    const create = () => post('/api/v1/admin/fee-policies', f.finance, { policy_key: randomUUID(), category_id: categoryId,
      commission_rate: 0.02, buyer_fee_amount: 0, valid_from: '2030-01-01T00:00:00Z', valid_until: '2031-01-01T00:00:00Z' });
    const first = await create(), second = await create();
    expect(first.statusCode, first.body).toBe(201); expect(second.statusCode, second.body).toBe(201);
    const results = await Promise.all([first, second].map(row => post(`/api/v1/admin/fee-policies/${row.json().id}/activate`, f.finance, { reason: 'Reviewed fee scope' }, 0)));
    expect(results.map(result => result.statusCode).sort(), results.map(result => result.body).join('\n')).toEqual([200, 409]);
  });

  it('requires verified tax evidence and prevents two profiles from covering the same entity period', async () => {
    const f = await fixture(), uploadResult = await upload(f.legalId, f.owner);
    expect(uploadResult.statusCode, uploadResult.body).toBe(201);
    const documentId = uploadResult.json().id;
    const body = { is_pkp: false, collector_enabled: false, valid_from: '2030-01-01T00:00:00Z', valid_until: '2031-01-01T00:00:00Z', document_ids: [documentId] };
    const first = await post(`/api/v1/admin/legal-entities/${f.legalId}/tax-profiles`, f.finance, body);
    expect(first.statusCode, first.body).toBe(201);
    const blocked = await post(`/api/v1/admin/tax-profiles/${first.json().id}/verify`, f.finance, { reason: 'Tax evidence reviewed' }, 0);
    expect(blocked.statusCode, blocked.body).toBe(422);
    const verifyDoc = await post(`/api/v1/admin/documents/${documentId}/decision`, f.finance, { decision: 'APPROVE', reason: 'Evidence checked' }, 0);
    expect(verifyDoc.statusCode, verifyDoc.body).toBe(200);
    const second = await post(`/api/v1/admin/legal-entities/${f.legalId}/tax-profiles`, f.finance, body);
    expect(second.statusCode, second.body).toBe(201);
    const results = await Promise.all([first, second].map(row => post(`/api/v1/admin/tax-profiles/${row.json().id}/verify`, f.finance, { reason: 'Tax evidence reviewed' }, 0)));
    expect(results.map(result => result.statusCode).sort(), results.map(result => result.body).join('\n')).toEqual([200, 409]);
  });

  it('creates and activates tax policies with exact rates, class scope, and nonoverlapping periods', async () => {
    const f = await fixture(), classId = randomUUID();
    await database.db.insert(taxClasses).values({ id: classId, code: classId, name: 'Tax policy test', status: 'ACTIVE' });
    const body = { policy_key: randomUUID(), tax_class_id: classId, kind: 'ITEM_VAT', rate: 0.12,
      dpp_numerator: 11, dpp_denominator: 12, valid_from: '2030-01-01T00:00:00Z', valid_until: '2031-01-01T00:00:00Z' };
    const wrongScope = await post('/api/v1/admin/tax-policies', f.finance, { ...body, kind: 'COMMISSION_VAT' });
    expect(wrongScope.statusCode, wrongScope.body).toBe(422);
    const precision = await post('/api/v1/admin/tax-policies', f.finance, { ...body, rate: 0.123456789 });
    expect(precision.statusCode, precision.body).toBe(422);
    const created = await post('/api/v1/admin/tax-policies', f.finance, body);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().rate).toBe(0.12);
    const approved = await post(`/api/v1/admin/tax-policies/${created.json().id}/activate`, f.finance, { reason: 'Rule and period reviewed' }, 0);
    expect(approved.statusCode, approved.body).toBe(200);
    const second = await post('/api/v1/admin/tax-policies', f.finance, { ...body, policy_key: randomUUID() });
    expect(second.statusCode, second.body).toBe(201);
    const conflict = await post(`/api/v1/admin/tax-policies/${second.json().id}/activate`, f.finance, { reason: 'Rule reviewed' }, 0);
    expect(conflict.statusCode, conflict.body).toBe(409);
    const adjacent = await post('/api/v1/admin/tax-policies', f.finance, { ...body, policy_key: body.policy_key, valid_from: body.valid_until, valid_until: null });
    expect(adjacent.statusCode, adjacent.body).toBe(201);
    const adjacentActive = await post(`/api/v1/admin/tax-policies/${adjacent.json().id}/activate`, f.finance, { reason: 'Next version reviewed' }, 0);
    expect(adjacentActive.statusCode, adjacentActive.body).toBe(200);
    const list = await app.inject({ url: '/api/v1/admin/tax-policies?limit=100', headers: f.finance });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.find((row: { id: string }) => row.id === created.json().id)?.status).toBe('ACTIVE');
  });
});
