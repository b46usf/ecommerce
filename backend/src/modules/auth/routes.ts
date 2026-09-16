import { randomUUID } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { auditLogs, authTokens, buyerAccounts, organizations, outboxEvents, users } from '../../database/schema.js';
import { routeSchema } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { assertVersion, expectedVersion } from '../catalog/policy.js';
import { createEmailToken, randomToken, tokenHash, type EmailTokenPurpose } from './tokens.js';
import { endSession, publicUser, requireUser, startSession } from './session.js';
import { cursorScope, decodeCursor, encodeCursor } from '../catalog/policy.js';
import { scanDocument } from '../documents/security.js';
import { maximumAvatarImageBytes, prepareAvatarImage } from '../media/image.js';
import { deleteMediaObject, writeMediaObject } from '../media/storage.js';

type Database = FastifyInstance['services']['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const passwordOptions = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const limited = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

type ProfileUpdateBody = { name?: string; email?: string; phone?: string | null };
type PasswordChangeBody = { current_password: string; new_password: string };

// Unknown accounts still perform a full Argon2 verification to reduce enumeration by timing.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hash(randomToken(), passwordOptions);
  return dummyHash;
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (value.length > 254) throw new AppError(422, 'VALIDATION_ERROR', 'Alamat email terlalu panjang.');
  return value;
}

function normalizePhone(phone: string | null | undefined): string | null | undefined {
  if (phone === undefined || phone === null) return phone;
  const value = phone.trim();
  const digits = value.replace(/\D/g, '');
  if (!value || !/^\+?[-0-9 .()]+$/.test(value) || digits.length < 7 || digits.length > 15) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Nomor telepon harus berisi 7 sampai 15 digit yang valid.');
  }
  return value;
}

function duplicateEntry(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
    if ('code' in cause && cause.code === 'ER_DUP_ENTRY') return true;
    cause = 'cause' in cause ? cause.cause : undefined;
  }
  return false;
}

/** Redis counter is atomic and bounded even for attacker-controlled email input. */
async function accountRateLimit(request: FastifyRequest, email: string, operation: string, maximum: number): Promise<boolean> {
  const key = `marketplace:auth-limit:${operation}:${tokenHash(email)}`;
  const result = await request.server.services.redis.eval(
    'local n = redis.call("INCR", KEYS[1]); if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]); end; return n',
    1, key, 900,
  );
  return Number(result) <= maximum;
}

async function queueEmailToken(
  tx: Transaction, app: FastifyInstance, userId: string, purpose: EmailTokenPurpose,
): Promise<void> {
  const tokenId = randomUUID();
  const token = createEmailToken(tokenId, purpose, app.services.config.authTokenSecret);
  const ttl = purpose === 'VERIFY_EMAIL' ? 86_400 : app.services.config.authTokenTtlSeconds;
  await tx.insert(authTokens).values({
    id: tokenId, userId, purpose, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + ttl * 1000),
  });
  await tx.insert(outboxEvents).values({
    id: randomUUID(), eventKey: `auth-email:${tokenId}`, aggregateType: 'USER', aggregateId: userId,
    eventType: 'AUTH_EMAIL_REQUESTED', payload: { tokenId, userId, purpose },
  });
}

async function consumeEmailToken(
  tx: Transaction, token: string, purpose: EmailTokenPurpose,
): Promise<typeof authTokens.$inferSelect> {
  const digest = tokenHash(token);
  const [candidate] = await tx.select({ userId: authTokens.userId }).from(authTokens)
    .where(and(eq(authTokens.tokenHash, digest), eq(authTokens.purpose, purpose))).limit(1);
  if (!candidate) throw new AppError(422, 'TOKEN_INVALID', 'Token tidak berlaku atau sudah kedaluwarsa.');
  // Lock the user first for every token action, preventing two reset tokens from deadlocking
  // when the winning transaction revokes the other outstanding tokens.
  await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).limit(1).for('update');
  const [record] = await tx.select().from(authTokens)
    .where(and(eq(authTokens.tokenHash, digest), eq(authTokens.purpose, purpose),
      isNull(authTokens.consumedAt), isNull(authTokens.revokedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1).for('update');
  if (!record) throw new AppError(422, 'TOKEN_INVALID', 'Token tidak berlaku atau sudah kedaluwarsa.');
  await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, record.id));
  return record;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  await getDummyHash();
  app.get('/auth/csrf', { schema: routeSchema('getCsrf') }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const session = request.authSession ?? await startSession(request, reply);
    return { csrf_token: session.csrfToken };
  });

  app.post<{ Body: { name: string; email: string; password: string } }>('/auth/register', {
    schema: routeSchema('register'), config: limited,
  }, async (request, reply) => {
    const { password } = request.body;
    const name = request.body.name.trim();
    if (!name) throw new AppError(422, 'VALIDATION_ERROR', 'Nama tidak boleh kosong.');
    const email = normalizeEmail(request.body.email);
    const passwordHash = await hash(password, passwordOptions);
    try {
      await app.services.db.transaction(async (tx) => {
        const id = randomUUID();
        await tx.insert(users).values({ id, name, emailNormalized: email, passwordHash, status: 'ACTIVE' });
        await tx.insert(buyerAccounts).values({ id: randomUUID(), managerUserId: id, kind: 'INDIVIDUAL', status: 'ACTIVE' });
        await queueEmailToken(tx, app, id, 'VERIFY_EMAIL');
      });
    } catch (error) {
      if (duplicateEntry(error)) throw new AppError(409, 'EMAIL_EXISTS', 'Alamat email sudah terdaftar.');
      throw error;
    }
    return reply.code(201).send({ message: 'Akun berhasil dibuat. Email verifikasi telah dijadwalkan.' });
  });

  app.post<{ Body: { email: string; password: string } }>('/auth/login', {
    schema: routeSchema('login'), config: limited,
  }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);
    if (!await accountRateLimit(request, email, 'login', 20)) {
      throw new AppError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan masuk. Coba kembali nanti.');
    }
    const [user] = await app.services.db.select().from(users).where(eq(users.emailNormalized, email)).limit(1);
    const encodedPassword = user?.passwordHash ?? await getDummyHash();
    const valid = await verify(encodedPassword, request.body.password);
    if (!user || !valid || user.status !== 'ACTIVE') {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password tidak valid.');
    }
    await startSession(request, reply, user);
    reply.header('Cache-Control', 'private, no-store');
    return publicUser(request, user);
  });

  app.post<{ Body: { token: string } }>('/auth/verify-email', {
    schema: routeSchema('verifyEmail'), config: limited,
  }, async (request) => {
    await app.services.db.transaction(async (tx) => {
      const token = await consumeEmailToken(tx, request.body.token, 'VERIFY_EMAIL');
      const [user] = await tx.select().from(users).where(eq(users.id, token.userId)).limit(1).for('update');
      if (!user || user.status !== 'ACTIVE') throw new AppError(422, 'TOKEN_INVALID', 'Token tidak berlaku.');
      if (!user.emailVerifiedAt) await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    });
    return { message: 'Alamat email berhasil diverifikasi.' };
  });

  app.post<{ Body: { email: string } }>('/auth/forgot-password', {
    schema: routeSchema('forgotPassword'), config: limited,
  }, async (request) => {
    const email = normalizeEmail(request.body.email);
    // The same response is used for unknown, disabled, and account-throttled addresses.
    if (await accountRateLimit(request, email, 'forgot-password', 3)) {
      const [user] = await app.services.db.select().from(users)
        .where(and(eq(users.emailNormalized, email), eq(users.status, 'ACTIVE'))).limit(1);
      if (user) await app.services.db.transaction(async (tx) => {
        await queueEmailToken(tx, app, user.id, 'RESET_PASSWORD');
      });
    }
    return { message: 'Jika email terdaftar, petunjuk pemulihan password akan dikirim.' };
  });

  app.post<{ Body: { token: string; password: string } }>('/auth/reset-password', {
    schema: routeSchema('resetPassword'), config: limited,
  }, async (request, reply) => {
    const passwordHash = await hash(request.body.password, passwordOptions);
    await app.services.db.transaction(async (tx) => {
      const token = await consumeEmailToken(tx, request.body.token, 'RESET_PASSWORD');
      const [user] = await tx.select().from(users).where(eq(users.id, token.userId)).limit(1).for('update');
      if (!user || user.status !== 'ACTIVE') throw new AppError(422, 'TOKEN_INVALID', 'Token tidak berlaku.');
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await tx.update(authTokens).set({ revokedAt: new Date() }).where(and(
        eq(authTokens.userId, user.id), eq(authTokens.purpose, 'RESET_PASSWORD'),
        isNull(authTokens.consumedAt), isNull(authTokens.revokedAt),
      ));
    });
    // Existing sessions now fail their password fingerprint check; clear this browser's cookie too.
    await endSession(request, reply);
    return { message: 'Password berhasil diperbarui. Silakan masuk kembali.' };
  });

  app.post('/auth/logout', { schema: routeSchema('logout') }, async (request, reply) => {
    await requireUser(request);
    await endSession(request, reply);
    return reply.code(204).send();
  });

  app.get('/me', { schema: routeSchema('getMe') }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return publicUser(request, await requireUser(request));
  });

  app.patch<{ Body: ProfileUpdateBody; Headers: { 'if-match': string } }>('/me', {
    schema: routeSchema('updateMe'),
  }, async (request, reply) => {
    const actor = await requireUser(request);
    const name = request.body.name === undefined ? undefined : request.body.name.trim();
    if (name !== undefined && !name) throw new AppError(422, 'VALIDATION_ERROR', 'Nama tidak boleh kosong.');
    const email = request.body.email === undefined ? undefined : normalizeEmail(request.body.email);
    const phone = normalizePhone(request.body.phone);
    const expected = expectedVersion(request.headers['if-match']);
    let updated: typeof users.$inferSelect;
    try {
      updated = await app.services.db.transaction(async (tx) => {
        const [row] = await tx.select().from(users).where(eq(users.id, actor.id)).limit(1).for('update');
        if (!row || row.status !== 'ACTIVE') throw new AppError(401, 'AUTH_REQUIRED', 'Silakan masuk untuk melanjutkan.');
        assertVersion(row.rowVersion, expected);
        const emailChanged = email !== undefined && email !== row.emailNormalized;
        const changes = {
          ...(name !== undefined && name !== row.name ? { name } : {}),
          ...(emailChanged ? { emailNormalized: email, emailVerifiedAt: null } : {}),
          ...(phone !== undefined && phone !== row.phone ? { phone } : {}),
        };
        const changedFields = [
          ...(changes.name !== undefined ? ['name'] : []),
          ...(changes.emailNormalized !== undefined ? ['email'] : []),
          ...(Object.prototype.hasOwnProperty.call(changes, 'phone') ? ['phone'] : []),
        ];
        if (!changedFields.length) return row;
        const rowVersion = row.rowVersion + 1;
        await tx.update(users).set({ ...changes, rowVersion }).where(eq(users.id, row.id));
        if (emailChanged) {
          await tx.update(authTokens).set({ revokedAt: new Date(), rowVersion: sql`${authTokens.rowVersion} + 1` }).where(and(
            eq(authTokens.userId, row.id), eq(authTokens.purpose, 'VERIFY_EMAIL'),
            isNull(authTokens.consumedAt), isNull(authTokens.revokedAt),
          ));
          await queueEmailToken(tx, app, row.id, 'VERIFY_EMAIL');
        }
        await tx.insert(auditLogs).values({
          actorId: row.id, entityType: 'USER', entityId: row.id, action: 'PROFILE_UPDATED',
          changesRedacted: { fields: changedFields, email_verification_reset: emailChanged, before_version: row.rowVersion, after_version: rowVersion },
          correlationId: request.id,
        });
        return { ...row, ...changes, rowVersion };
      });
    } catch (cause) {
      if (duplicateEntry(cause)) throw new AppError(409, 'EMAIL_EXISTS', 'Alamat email sudah digunakan akun lain.');
      throw cause;
    }
    request.currentUser = updated;
    reply.header('Cache-Control', 'private, no-store').header('ETag', `"${updated.rowVersion}"`);
    return publicUser(request, updated);
  });

  app.put<{ Headers: { 'if-match': string } }>('/me/avatar', {
    schema: routeSchema('updateMyAvatar'), bodyLimit: maximumAvatarImageBytes + 16_384,
  }, async (request, reply) => {
    const actor = await requireUser(request);
    if (!request.isMultipart()) throw new AppError(422, 'INVALID_AVATAR_UPLOAD', 'Kirim foto sebagai multipart/form-data.');
    let file: { bytes: Buffer; mime: string } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: maximumAvatarImageBytes } })) {
      if (part.type !== 'file' || part.fieldname !== 'file' || file) {
        throw new AppError(422, 'INVALID_AVATAR_UPLOAD', 'Unggah tepat satu file foto profil.');
      }
      file = { bytes: await part.toBuffer(), mime: part.mimetype };
    }
    if (!file) throw new AppError(422, 'INVALID_AVATAR_UPLOAD', 'File foto profil wajib diisi.');
    await scanDocument(file.bytes, app.services.config);
    const prepared = await prepareAvatarImage(file.bytes, file.mime);
    const objectKey = `profiles/${actor.id}/${randomUUID()}.webp`;
    const expected = expectedVersion(request.headers['if-match']);
    await writeMediaObject(app.services.config, objectKey, prepared.bytes, 'image/webp');
    let result: { updated: typeof users.$inferSelect; previousKey: string | null };
    try {
      result = await app.services.db.transaction(async tx => {
        const [row] = await tx.select().from(users).where(eq(users.id, actor.id)).limit(1).for('update');
        if (!row || row.status !== 'ACTIVE') throw new AppError(401, 'AUTH_REQUIRED', 'Silakan masuk untuk melanjutkan.');
        assertVersion(row.rowVersion, expected);
        const rowVersion = row.rowVersion + 1;
        await tx.update(users).set({ avatarObjectKey: objectKey, rowVersion, updatedAt: new Date() }).where(eq(users.id, row.id));
        await tx.insert(auditLogs).values({ actorId: row.id, entityType: 'USER', entityId: row.id, action: 'AVATAR_UPDATED', correlationId: request.id,
          changesRedacted: { checksum: prepared.checksum, before_version: row.rowVersion, after_version: rowVersion } });
        return { updated: { ...row, avatarObjectKey: objectKey, rowVersion, updatedAt: new Date() }, previousKey: row.avatarObjectKey };
      });
    } catch (cause) {
      await deleteMediaObject(app.services.config, objectKey).catch(() => undefined);
      throw cause;
    }
    if (result.previousKey?.startsWith(`profiles/${actor.id}/`)) {
      await deleteMediaObject(app.services.config, result.previousKey).catch(() => request.log.error({ event: 'avatar_cleanup_failed' }, 'Avatar cleanup failed'));
    }
    request.currentUser = result.updated;
    reply.header('ETag', `"${result.updated.rowVersion}"`);
    return publicUser(request, result.updated);
  });

  app.delete<{ Headers: { 'if-match': string } }>('/me/avatar', {
    schema: routeSchema('deleteMyAvatar'),
  }, async (request, reply) => {
    const actor = await requireUser(request);
    const expected = expectedVersion(request.headers['if-match']);
    const result = await app.services.db.transaction(async tx => {
      const [row] = await tx.select().from(users).where(eq(users.id, actor.id)).limit(1).for('update');
      if (!row || row.status !== 'ACTIVE') throw new AppError(401, 'AUTH_REQUIRED', 'Silakan masuk untuk melanjutkan.');
      assertVersion(row.rowVersion, expected);
      if (!row.avatarObjectKey) return { updated: row, previousKey: null };
      const rowVersion = row.rowVersion + 1;
      await tx.update(users).set({ avatarObjectKey: null, rowVersion, updatedAt: new Date() }).where(eq(users.id, row.id));
      await tx.insert(auditLogs).values({ actorId: row.id, entityType: 'USER', entityId: row.id, action: 'AVATAR_DELETED', correlationId: request.id,
        changesRedacted: { before_version: row.rowVersion, after_version: rowVersion } });
      return { updated: { ...row, avatarObjectKey: null, rowVersion, updatedAt: new Date() }, previousKey: row.avatarObjectKey };
    });
    if (result.previousKey?.startsWith(`profiles/${actor.id}/`)) {
      await deleteMediaObject(app.services.config, result.previousKey).catch(() => request.log.error({ event: 'avatar_cleanup_failed' }, 'Avatar cleanup failed'));
    }
    request.currentUser = result.updated;
    reply.header('ETag', `"${result.updated.rowVersion}"`);
    return publicUser(request, result.updated);
  });

  app.put<{ Body: PasswordChangeBody }>('/me/password', {
    schema: routeSchema('updateMyPassword'), config: limited,
  }, async (request, reply) => {
    const actor = await requireUser(request);
    if (!await accountRateLimit(request, actor.emailNormalized, 'change-password', 5)) {
      throw new AppError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan perubahan password. Coba kembali nanti.');
    }
    if (!await verify(actor.passwordHash, request.body.current_password)) {
      throw new AppError(422, 'CURRENT_PASSWORD_INVALID', 'Password saat ini tidak sesuai.');
    }
    if (request.body.current_password === request.body.new_password) {
      throw new AppError(422, 'PASSWORD_UNCHANGED', 'Password baru harus berbeda dari password saat ini.');
    }
    const passwordHash = await hash(request.body.new_password, passwordOptions);
    await app.services.db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, actor.id)).limit(1).for('update');
      if (!row || row.status !== 'ACTIVE' || row.passwordHash !== actor.passwordHash) {
        throw new AppError(409, 'ACCOUNT_CHANGED', 'Data keamanan akun telah berubah. Silakan masuk kembali.');
      }
      await tx.update(users).set({ passwordHash, rowVersion: row.rowVersion + 1 }).where(eq(users.id, row.id));
      await tx.update(authTokens).set({ revokedAt: new Date(), rowVersion: sql`${authTokens.rowVersion} + 1` }).where(and(
        eq(authTokens.userId, row.id), eq(authTokens.purpose, 'RESET_PASSWORD'),
        isNull(authTokens.consumedAt), isNull(authTokens.revokedAt),
      ));
      await tx.insert(auditLogs).values({
        actorId: row.id, entityType: 'USER', entityId: row.id, action: 'PASSWORD_CHANGED',
        changesRedacted: { sessions_invalidated: true, before_version: row.rowVersion, after_version: row.rowVersion + 1 },
        correlationId: request.id,
      });
    });
    await endSession(request, reply);
    return reply.code(204).send();
  });

  app.get<{ Querystring: { cursor?: string; limit?: number } }>('/me/buyer-accounts', {
    schema: routeSchema('listBuyerAccounts'),
  }, async (request, reply) => {
    const user = await requireUser(request);
    reply.header('Cache-Control', 'private, no-store');
    const scope = cursorScope({ operation: 'listBuyerAccounts', userId: user.id });
    const cursor = decodeCursor(request.query.cursor, scope);
    const limit = request.query.limit ?? 20;
    const rows = await app.services.db.select({ account: buyerAccounts, organizationName: organizations.name })
      .from(buyerAccounts).leftJoin(organizations, eq(organizations.id, buyerAccounts.organizationId))
      .where(and(eq(buyerAccounts.managerUserId, user.id), eq(buyerAccounts.status, 'ACTIVE'),
        cursor ? gt(buyerAccounts.id, cursor.id) : undefined))
      .orderBy(asc(buyerAccounts.id)).limit(limit + 1);
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: selected.map(({ account, organizationName }) => ({
        id: account.id, created_at: account.createdAt.toISOString(), row_version: account.rowVersion,
        kind: account.kind, organization_name: organizationName, manager_user_id: account.managerUserId,
      })),
      next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.account.id, value: last.account.id }) : null,
    };
  });
}
