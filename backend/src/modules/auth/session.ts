import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { adminGrants, storeMembers, users } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { randomToken, secureEqual, tokenHash } from './tokens.js';

export type AuthUser = typeof users.$inferSelect;
export interface AuthSession {
  csrfToken: string;
  expiresAt: number;
  userId?: string;
  passwordVersion?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthSession | null;
    authSessionKey: string | null;
    currentUser: AuthUser | null;
  }
}

const sessionKey = (token: string): string => `marketplace:session:${tokenHash(token)}`;

function isSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<AuthSession>;
  return typeof item.csrfToken === 'string' && /^[\w-]{43}$/.test(item.csrfToken)
    && typeof item.expiresAt === 'number' && item.expiresAt > Date.now()
    && ((item.userId === undefined && item.passwordVersion === undefined)
      || (typeof item.userId === 'string' && typeof item.passwordVersion === 'string'));
}

/** Root must invoke after @fastify/cookie's parser, including for public pre-login routes. */
export async function loadSession(request: FastifyRequest): Promise<void> {
  request.authSession = null;
  request.authSessionKey = null;
  request.currentUser = null;
  const { redis, config } = request.server.services;
  const token = request.cookies[config.sessionCookieName];
  if (!token || !/^[\w-]{43}$/.test(token)) return;
  const key = sessionKey(token);
  const raw = await redis.get(key);
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!isSession(parsed)) return;
  request.authSession = parsed;
  request.authSessionKey = key;
}

export function registerSessionHooks(app: FastifyInstance): void {
  app.decorateRequest('authSession', null);
  app.decorateRequest('authSessionKey', null);
  app.decorateRequest('currentUser', null);
  app.addHook('onRequest', loadSession);
}

export function requireCsrf(request: FastifyRequest): void {
  const csrf = request.headers['x-csrf-token'];
  if (!request.authSession || typeof csrf !== 'string'
    || !secureEqual(request.authSession.csrfToken, csrf)) {
    throw new AppError(403, 'CSRF_INVALID', 'Ambil token CSRF yang valid sebelum mengirim perubahan.');
  }
}

export async function startSession(
  request: FastifyRequest, reply: FastifyReply, user?: AuthUser,
): Promise<AuthSession> {
  const { redis, config } = request.server.services;
  const ttl = user ? config.sessionTtlSeconds : config.preSessionTtlSeconds;
  const token = randomToken();
  const session: AuthSession = {
    csrfToken: randomToken(), expiresAt: Date.now() + ttl * 1000,
    ...(user ? { userId: user.id, passwordVersion: tokenHash(user.passwordHash) } : {}),
  };
  const key = sessionKey(token);
  // Persist the replacement before removing the old session, so Redis failures never issue a cookie.
  await redis.set(key, JSON.stringify(session), 'EX', ttl);
  if (request.authSessionKey) await redis.del(request.authSessionKey);
  request.authSession = session;
  request.authSessionKey = key;
  request.currentUser = user ?? null;
  reply.setCookie(config.sessionCookieName, token, {
    path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', maxAge: ttl,
  });
  return session;
}

export async function endSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.authSessionKey) await request.server.services.redis.del(request.authSessionKey);
  request.authSession = null;
  request.authSessionKey = null;
  request.currentUser = null;
  reply.clearCookie(request.server.services.config.sessionCookieName, {
    path: '/', httpOnly: true, secure: request.server.services.config.cookieSecure, sameSite: 'lax',
  });
}

export async function requireUser(request: FastifyRequest): Promise<AuthUser> {
  if (request.currentUser) return request.currentUser;
  const session = request.authSession;
  if (!session?.userId || !session.passwordVersion) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Silakan masuk untuk melanjutkan.');
  }
  const [user] = await request.server.services.db.select().from(users)
    .where(and(eq(users.id, session.userId), eq(users.status, 'ACTIVE'))).limit(1);
  if (!user || !secureEqual(tokenHash(user.passwordHash), session.passwordVersion)) {
    if (request.authSessionKey) await request.server.services.redis.del(request.authSessionKey);
    request.authSession = null;
    throw new AppError(401, 'SESSION_EXPIRED', 'Sesi tidak berlaku. Silakan masuk kembali.');
  }
  request.currentUser = user;
  return user;
}

export async function requireStoreRole(
  request: FastifyRequest, storeId: string, roles: readonly string[],
): Promise<AuthUser> {
  const user = await requireUser(request);
  const [membership] = await request.server.services.db.select().from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, user.id), isNull(storeMembers.revokedAt)))
    .limit(1);
  if (!membership || !roles.includes(membership.roleCode)) {
    throw new AppError(403, 'STORE_ACCESS_DENIED', 'Anda tidak memiliki izin untuk tindakan pada toko ini.');
  }
  return user;
}

export async function getAdminRoles(request: FastifyRequest, userId: string): Promise<string[]> {
  const grants = await request.server.services.db.select({ role: adminGrants.roleCode }).from(adminGrants)
    .where(and(eq(adminGrants.userId, userId), isNull(adminGrants.revokedAt)));
  return grants.map((grant) => grant.role);
}

export async function requireAdminRole(request: FastifyRequest, roles: readonly string[]): Promise<AuthUser> {
  const user = await requireUser(request);
  const grants = await getAdminRoles(request, user.id);
  if (!grants.some((role) => role === 'SUPERADMIN' || roles.includes(role))) {
    throw new AppError(403, 'ADMIN_ACCESS_DENIED', 'Tindakan ini memerlukan izin administrator.');
  }
  return user;
}

export async function publicUser(request: FastifyRequest, user: AuthUser) {
  return {
    id: user.id, name: user.name, email: user.emailNormalized,
    email_verified: user.emailVerifiedAt !== null,
    admin_roles: await getAdminRoles(request, user.id),
  };
}
