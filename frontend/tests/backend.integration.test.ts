import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../backend/src/app';
import { loadConfig } from '../../backend/src/config';
import { createDatabase } from '../../backend/src/database/index';
import type { Services } from '../../backend/src/services';
import { createMarketplaceApi, unwrap, versionHeaders } from '../app/api/client';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('Nuxt API client against the Fastify HTTP boundary', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let baseUrl: string;
  const sessions = new Map<string, string>();
  const counters = new Map<string, number>();

  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Use a dedicated database ending in _test.');
    database = createDatabase({ databaseUrl });
    const redis = {
      get: async (key: string) => sessions.get(key) ?? null,
      set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; },
      del: async (key: string) => Number(sessions.delete(key)),
      ping: async () => 'PONG',
      eval: async (_script: string, _keys: number, key: string) => {
        const value = (counters.get(key) ?? 0) + 1;
        counters.set(key, value);
        return value;
      },
      rateLimit: (...args: unknown[]) => (args.at(-1) as (error: null, result: number[]) => void)(null, [1, 60_000]),
      rateLimitRead: (...args: unknown[]) => (args.at(-1) as (error: null, result: number[]) => void)(null, [0, 0]),
    };
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'frontend-integration-secret-with-more-than-thirty-two-characters',
      APP_ORIGINS: 'http://localhost:3000', PUBLIC_APP_URL: 'http://localhost:3000',
      PUBLIC_API_URL: 'http://127.0.0.1:3001', LOG_LEVEL: 'silent',
    });
    const services = {
      db: database.db, redis, config, checkDatabase: database.ping, close: async () => {},
    } as unknown as Services;
    app = await buildApp(services, { logger: false });
    baseUrl = `${await app.listen({ host: '127.0.0.1', port: 0 })}/api/v1`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
  });

  it('registers, rotates the browser session on login, reads the profile, and logs out with renewed CSRF', async () => {
    let cookie = '';
    const visited: string[] = [];
    const browserFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(request.headers);
      if (cookie) headers.set('Cookie', cookie);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) headers.set('Origin', 'http://localhost:3000');
      const forwarded = new Request(request, { headers });
      visited.push(`${forwarded.method} ${new URL(forwarded.url).pathname}`);
      const response = await fetch(forwarded);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = /Max-Age=0/i.test(setCookie) ? '' : setCookie.split(';')[0] ?? '';
      return response;
    };
    const api = createMarketplaceApi({ baseUrl, fetch: browserFetch });
    const email = `${randomUUID()}@example.test`;
    const password = `Frontend-${randomUUID()}`;

    const registration = unwrap(await api.POST('/auth/register', { body: { name: 'Frontend Buyer', email, password } }));
    expect(registration.message).toContain('berhasil dibuat');

    const login = unwrap(await api.POST('/auth/login', { body: { email, password } }));
    expect(login).toMatchObject({ email, name: 'Frontend Buyer' });
    expect(cookie).toMatch(/^marketplace_session=/);

    const me = unwrap(await api.GET('/me', { cache: 'no-store' }));
    expect(me.id).toBe(login.id);

    const updatedProfile = unwrap(await api.PATCH('/me', {
      params: { header: versionHeaders(me.row_version) },
      body: { name: 'Frontend Buyer Updated', phone: '081234567890' },
    }));
    expect(updatedProfile).toMatchObject({ name: 'Frontend Buyer Updated', phone: '081234567890', row_version: me.row_version + 1 });

    const accounts = unwrap(await api.GET('/me/buyer-accounts', { params: { query: { limit: 100 } }, cache: 'no-store' }));
    const buyerAccountId = accounts.items[0]!.id;
    const addressBody = { label: 'Rumah', recipient_name: 'Frontend Buyer', phone: '081234567890', street: 'Jalan Integrasi 1',
      province: 'DKI Jakarta', city: 'Jakarta', district: 'Menteng', postal_code: '10310', is_default: true };
    const address = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/addresses', {
      params: { path: { buyerAccountId }, header: { 'Idempotency-Key': randomUUID() } }, body: addressBody,
    }));
    expect(address).toMatchObject({ label: 'Rumah', row_version: 0 });

    const updatedAddress = unwrap(await api.PUT('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', {
      params: { path: { buyerAccountId, addressId: address.id }, header: versionHeaders(address.row_version) },
      body: { ...addressBody, label: 'Kantor' },
    }));
    expect(updatedAddress).toMatchObject({ id: address.id, label: 'Kantor', row_version: 1 });
    expect(unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/addresses', {
      params: { path: { buyerAccountId }, query: { limit: 100 } }, cache: 'no-store',
    })).items.some(item => item.id === address.id)).toBe(true);

    const removedAddress = await api.DELETE('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', {
      params: { path: { buyerAccountId, addressId: address.id }, header: versionHeaders(updatedAddress.row_version) },
    });
    expect(removedAddress.response.status).toBe(204);
    expect(removedAddress.error).toBeUndefined();
    expect(unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/addresses', {
      params: { path: { buyerAccountId }, query: { limit: 100 } }, cache: 'no-store',
    })).items.some(item => item.id === address.id)).toBe(false);

    const logout = await api.POST('/auth/logout');
    expect(logout.response.status).toBe(204);
    expect(cookie).toBe('');

    const afterLogout = await api.GET('/me', { cache: 'no-store' });
    expect(afterLogout.response.status).toBe(401);
    expect(afterLogout.error).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(visited.filter(item => item.endsWith('/auth/csrf'))).toHaveLength(2);
  });
});
