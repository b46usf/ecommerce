import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, describe, expect, it } from 'vitest';
import type { Services } from '../src/services.js';
import { loadConfig } from '../src/config.js';
import {
  registerSessionHooks, requireCsrf, requireUser, startSession, type AuthUser,
} from '../src/modules/auth/session.js';
import { createEmailToken, randomToken, tokenHash } from '../src/modules/auth/tokens.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function fixture() {
  const app = Fastify();
  apps.push(app);
  const storage = new Map<string, string>();
  const now = new Date();
  let user: AuthUser = {
    id: '10000000-0000-4000-8000-000000000001', emailNormalized: 'user@example.test', name: 'User',
    passwordHash: 'encoded-password-before-reset', phone: null, avatarObjectKey: null, status: 'ACTIVE', emailVerifiedAt: now,
    createdAt: now, updatedAt: now, rowVersion: 0,
  };
  const redis = {
    get: async (key: string) => storage.get(key) ?? null,
    set: async (key: string, value: string) => { storage.set(key, value); return 'OK'; },
    del: async (key: string) => storage.delete(key) ? 1 : 0,
  };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => user.status === 'ACTIVE' ? [user] : [] }) }) }),
  };
  app.decorate('services', {
    redis, db, config: loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'mysql://app:example@127.0.0.1/test',
      REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'test-secret-with-at-least-thirty-two-characters',
      COOKIE_SECURE: 'true',
    }), checkDatabase: async () => {}, close: async () => {},
  } as unknown as Services);
  await app.register(cookie);
  registerSessionHooks(app);
  app.addHook('preValidation', async request => {
    if (request.method === 'POST') requireCsrf(request);
  });
  app.get('/csrf', async (request, reply) => {
    return request.authSession ?? await startSession(request, reply);
  });
  app.post('/rotate', async (request, reply) => startSession(request, reply, user));
  app.post('/mutate', async () => ({ ok: true }));
  app.get('/protected', async request => ({ id: (await requireUser(request)).id }));
  return {
    app, storage,
    resetPassword: () => { user = { ...user, passwordHash: 'encoded-password-after-reset' }; },
    disableUser: () => { user = { ...user, status: 'DISABLED' }; },
  };
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('Expected a session cookie');
  return value.split(';')[0]!;
}

describe('session and CSRF security boundary', () => {
  it('requires the token bound to the current pre-session and sets secure HttpOnly cookies', async () => {
    const { app, storage } = await fixture();
    const first = await app.inject('/csrf');
    const second = await app.inject('/csrf');
    expect(first.headers['set-cookie']).toContain('HttpOnly');
    expect(first.headers['set-cookie']).toContain('Secure');
    expect(first.headers['set-cookie']).toContain('SameSite=Lax');
    const missing = await app.inject({ method: 'POST', url: '/mutate' });
    expect(missing.statusCode).toBe(403);
    const mismatch = await app.inject({ method: 'POST', url: '/mutate', headers: {
      cookie: cookieHeader(second), 'x-csrf-token': first.json().csrfToken,
    } });
    expect(mismatch.statusCode).toBe(403);
    const valid = await app.inject({ method: 'POST', url: '/mutate', headers: {
      cookie: cookieHeader(first), 'x-csrf-token': first.json().csrfToken,
    } });
    expect(valid.statusCode).toBe(200);
    const rawCookieToken = cookieHeader(first).split('=')[1]!;
    expect([...storage.keys()].some(key => key.includes(rawCookieToken))).toBe(false);
  });

  it('rotates session and CSRF after authentication and invalidates the pre-session', async () => {
    const { app } = await fixture();
    const pre = await app.inject('/csrf');
    const login = await app.inject({ method: 'POST', url: '/rotate', headers: {
      cookie: cookieHeader(pre), 'x-csrf-token': pre.json().csrfToken,
    } });
    expect(login.statusCode).toBe(200);
    expect(cookieHeader(login)).not.toBe(cookieHeader(pre));
    expect(login.json().csrfToken).not.toBe(pre.json().csrfToken);
    const oldMutation = await app.inject({ method: 'POST', url: '/mutate', headers: {
      cookie: cookieHeader(pre), 'x-csrf-token': pre.json().csrfToken,
    } });
    expect(oldMutation.statusCode).toBe(403);
    const authenticated = await app.inject({ url: '/protected', headers: { cookie: cookieHeader(login) } });
    expect(authenticated.statusCode).toBe(200);
    const staleCsrf = await app.inject({ method: 'POST', url: '/mutate', headers: {
      cookie: cookieHeader(login), 'x-csrf-token': pre.json().csrfToken,
    } });
    expect(staleCsrf.statusCode).toBe(403);
  });

  it.each(['password reset', 'account disabled'] as const)('rejects all previous sessions after %s', async reason => {
    const { app, resetPassword, disableUser } = await fixture();
    const pre = await app.inject('/csrf');
    const login = await app.inject({ method: 'POST', url: '/rotate', headers: {
      cookie: cookieHeader(pre), 'x-csrf-token': pre.json().csrfToken,
    } });
    if (reason === 'password reset') resetPassword(); else disableUser();
    const response = await app.inject({ url: '/protected', headers: { cookie: cookieHeader(login) } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects expired session data even if Redis still contains the key', async () => {
    const { app, storage } = await fixture();
    const pre = await app.inject('/csrf');
    for (const [key, value] of storage) storage.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: 0 }));
    const response = await app.inject({ method: 'POST', url: '/mutate', headers: {
      cookie: cookieHeader(pre), 'x-csrf-token': pre.json().csrfToken,
    } });
    expect(response.statusCode).toBe(403);
  });
});

describe('email bearer tokens', () => {
  it('binds reconstruction to token ID, purpose, and server secret', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const secret = randomToken();
    const token = createEmailToken(id, 'VERIFY_EMAIL', secret);
    expect(createEmailToken(id, 'VERIFY_EMAIL', secret)).toBe(token);
    expect(createEmailToken(id, 'RESET_PASSWORD', secret)).not.toBe(token);
    expect(createEmailToken(id, 'VERIFY_EMAIL', randomToken())).not.toBe(token);
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).not.toContain(id);
  });
});
