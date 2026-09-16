import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { contract } from '../src/shared/contracts.js';

function fixture(databaseReady = true, production = false) {
  const map = new Map<string, string>();
  const redis = {
    get: async (key: string) => map.get(key) ?? null,
    set: async (key: string, value: string) => { map.set(key, value); return 'OK'; },
    del: async (key: string) => Number(map.delete(key)), ping: async () => 'PONG',
    rateLimit: (...args: any[]) => args.at(-1)(null, [1, 60_000]),
    rateLimitRead: (...args: any[]) => args.at(-1)(null, [0, 0]),
  };
  const base = { DATABASE_URL: 'mysql://test:test@127.0.0.1/marketplace_test', REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters', LOG_LEVEL: 'silent' };
  const config = loadConfig(production ? {
    ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', TRUST_PROXY: 'true',
    APP_ORIGINS: 'https://shop.example.test', PUBLIC_APP_URL: 'https://shop.example.test', PUBLIC_API_URL: 'https://shop.example.test/api/v1',
    AUTH_TOKEN_SECRET: 'independent-auth-token-secret-with-32-characters', DATA_ENCRYPTION_KEY: 'independent-data-encryption-key-with-32-characters',
  } : { ...base, NODE_ENV: 'test' });
  return { db: {}, redis, config, checkDatabase: async () => { if (!databaseReady) throw new Error('database offline'); }, close: vi.fn() } as unknown as Services;
}

describe('application integration and HTTP boundary', () => {
  it('boots all routes and separates liveness from readiness', async () => {
    const app = await buildApp(fixture(false), { logger: false });
    try {
      const live = await app.inject('/health/live');
      expect(live.statusCode).toBe(200);
      expect(live.headers['x-request-id']).toMatch(/^[\da-f-]{36}$/);
      expect((await app.inject('/health/ready')).statusCode).toBe(503);
      expect((await app.inject('/docs/json')).statusCode).toBe(200);
      const expected = new Set<string>();
      for (const item of Object.values(contract.paths) as any[]) for (const definition of Object.values(item) as any[]) {
        if (definition?.operationId) expected.add(definition.operationId);
      }
      const implemented = (app as any).implementedOperations as Set<string>;
      expect([...expected].filter(id => !implemented.has(id))).toEqual([]);
      expect([...implemented].filter(id => !expected.has(id)).sort()).toEqual([
        'confirmProductMediaUpload', 'createProductMediaUploadUrl', 'downloadDocumentContent',
      ]);
      expect(expected.size).toBe(123);
    } finally { await app.close(); }
  });
  it('enforces pre-session CSRF, trusted origin and strict bodies before business code', async () => {
    const app = await buildApp(fixture(), { logger: false });
    try {
      const csrf = await app.inject('/api/v1/auth/csrf');
      expect(csrf.statusCode, csrf.body).toBe(200);
      const cookie = String(csrf.headers['set-cookie']).split(';')[0]!;
      const payload = { name: 'Buyer', email: 'buyer@example.test', password: 'long-test-password', extra: 'rejected' };
      const validHeaders = { cookie, origin: 'http://localhost:3000', 'x-csrf-token': csrf.json().csrf_token };
      const invalidBody = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: validHeaders, payload });
      expect(invalidBody.statusCode, invalidBody.body).toBe(400);
      expect(invalidBody.json().error.code).toBe('VALIDATION_ERROR');
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { ...validHeaders, origin: 'https://evil.test' }, payload })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { ...validHeaders, 'x-csrf-token': 'wrong' }, payload })).statusCode).toBe(403);
      const providerWebhook = await app.inject({ method: 'POST', url: '/api/v1/webhooks/midtrans', payload: {
        order_id: 'test', transaction_id: 'test', transaction_status: 'pending', status_code: '200', gross_amount: '1.00', signature_key: '0'.repeat(128),
      } });
      expect(providerWebhook.statusCode).toBe(503);
      const missingVersion = await app.inject({ method: 'PUT', url: '/api/v1/vendor/stores/10000000-0000-4000-8000-000000000001/products/10000000-0000-4000-8000-000000000002', headers: validHeaders, payload: {} });
      expect(missingVersion.statusCode).toBe(428);
    } finally { await app.close(); }
  });
  it('rejects plain HTTP API traffic and emits HSTS behind the production proxy', async () => {
    const app = await buildApp(fixture(true, true), { logger: false });
    try {
      const plain = await app.inject('/api/v1/auth/csrf');
      expect(plain.statusCode).toBe(426);
      expect(plain.json().error.code).toBe('HTTPS_REQUIRED');
      const secure = await app.inject({ url: '/api/v1/auth/csrf', headers: { 'x-forwarded-proto': 'https' } });
      expect(secure.statusCode, secure.body).toBe(200);
      expect(secure.headers['strict-transport-security']).toContain('max-age=31536000');
    } finally { await app.close(); }
  });
});
