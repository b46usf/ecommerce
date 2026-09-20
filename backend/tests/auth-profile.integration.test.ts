import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { hash, verify } from 'argon2'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/index.js'
import { auditLogs, authTokens, users } from '../src/database/schema.js'
import { loadConfig } from '../src/config.js'
import type { Services } from '../src/services.js'
import { AppError } from '../src/shared/errors.js'
import { authRoutes } from '../src/modules/auth/routes.js'
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js'
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const integration = databaseUrl ? describe : describe.skip

integration('account profile and password endpoints', () => {
  let database: ReturnType<typeof createDatabase>
  let app: FastifyInstance
  const sessions = new Map<string, string>()
  const counters = new Map<string, number>()
  let config: ReturnType<typeof loadConfig>
  let scanner: Server
  const scannerSockets = new Set<Socket>()
  let mediaDirectory: string

  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Integration database name must end in _test.')
    mediaDirectory = await mkdtemp(join(tmpdir(), 'marketplace-profile-media-'))
    scanner = createServer(socket => {
      scannerSockets.add(socket)
      socket.once('close', () => scannerSockets.delete(socket))
      let received = Buffer.alloc(0)
      socket.on('data', chunk => {
        received = Buffer.concat([received, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
        if (received.length >= 4 && received.subarray(-4).equals(Buffer.alloc(4))) socket.end('stream: OK\0')
      })
    })
    await new Promise<void>((resolve, reject) => {
      scanner.once('error', reject)
      scanner.listen(0, '127.0.0.1', resolve)
    })
    const scannerAddress = scanner.address()
    if (!scannerAddress || typeof scannerAddress === 'string') throw new Error('Fake scanner did not bind to TCP.')
    database = createDatabase({ databaseUrl })
    config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'profile-integration-session-secret-32-characters',
      AUTH_TOKEN_SECRET: 'profile-integration-auth-token-secret-32-characters',
      CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(scannerAddress.port), CLAMAV_TIMEOUT_MS: '1000',
      LOCAL_MEDIA_DIR: mediaDirectory, S3_PUBLIC_BASE_URL: 'http://media.test',
    })
    app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array' } } })
    app.decorate('services', {
      db: database.db, config,
      redis: {
        get: async (key: string) => sessions.get(key) ?? null,
        set: async (key: string, value: string) => { sessions.set(key, value); return 'OK' },
        del: async (key: string) => sessions.delete(key) ? 1 : 0,
        eval: async (_script: string, _keys: number, key: string) => {
          const value = (counters.get(key) ?? 0) + 1
          counters.set(key, value)
          return value
        },
      },
      checkDatabase: database.ping, close: async () => {},
    } as unknown as Services)
    app.setErrorHandler((error, request, reply) => {
      const err = error as Error & { code?: string; cause?: { code?: string }; validation?: unknown }
      const duplicate = (err.cause?.code ?? err.code) === 'ER_DUP_ENTRY'
      const status = error instanceof AppError ? error.statusCode : err.validation ? 400 : duplicate ? 409 : 500
      reply.code(status).send({ error: { code: error instanceof AppError ? error.code : duplicate ? 'RESOURCE_CONFLICT' : 'REQUEST_ERROR', message: err.message, request_id: request.id } })
    })
    await app.register(cookie)
    await app.register(multipart)
    registerSessionHooks(app)
    app.addHook('preValidation', async request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) requireCsrf(request)
    })
    await app.register(authRoutes, { prefix: '/api/v1' })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    if (app) await app.close()
    if (database) await database.close()
    if (scanner) {
      for (const socket of scannerSockets) socket.destroy()
      await new Promise<void>(resolve => scanner.close(() => resolve()))
    }
    if (mediaDirectory) await rm(mediaDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }, 30_000)

  async function fixture() {
    const userId = randomUUID()
    const otherUserId = randomUUID()
    const currentPassword = 'CurrentPassword!2026'
    const passwordHash = await hash(currentPassword)
    await database.db.insert(users).values([
      { id: userId, emailNormalized: `${userId}@profile.test`, name: 'Profile Before', passwordHash, emailVerifiedAt: new Date() },
      { id: otherUserId, emailNormalized: `${otherUserId}@profile.test`, name: 'Other Profile', passwordHash },
    ])
    const token = randomToken()
    const csrfToken = randomToken()
    sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({
      userId, passwordVersion: tokenHash(passwordHash), csrfToken, expiresAt: Date.now() + 60_000,
    }))
    return {
      userId, otherUserId, currentPassword, passwordHash,
      headers: { cookie: `${config.sessionCookieName}=${token}`, 'x-csrf-token': csrfToken },
    }
  }

  it('updates profile with optimistic concurrency and re-verifies a changed email', async () => {
    const data = await fixture()
    const email = `${randomUUID()}@profile.test`
    const response = await app.inject({
      method: 'PATCH', url: '/api/v1/me', headers: { ...data.headers, 'if-match': '"0"' },
      payload: { name: '  Profile Updated  ', email: email.toUpperCase(), phone: '+62 812-3456-7890' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('"1"')
    expect(response.json()).toMatchObject({ row_version: 1, name: 'Profile Updated', email, phone: '+62 812-3456-7890', email_verified: false })
    expect(await database.db.select().from(authTokens).where(eq(authTokens.userId, data.userId))).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'VERIFY_EMAIL' })]))
    expect(await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, data.userId))).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'PROFILE_UPDATED' })]))

    const stale = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: { ...data.headers, 'if-match': '"0"' }, payload: { name: 'Stale write' } })
    expect(stale.statusCode).toBe(412)
    const duplicate = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: { ...data.headers, 'if-match': '"1"' }, payload: { email: `${data.otherUserId}@profile.test` } })
    expect(duplicate.statusCode).toBe(409)
  })

  it('validates the current password, changes it, and invalidates the session', async () => {
    const data = await fixture()
    const wrong = await app.inject({ method: 'PUT', url: '/api/v1/me/password', headers: data.headers, payload: { current_password: 'WrongPassword!2026', new_password: 'NewPassword!2027' } })
    expect(wrong.statusCode).toBe(422)

    const changed = await app.inject({ method: 'PUT', url: '/api/v1/me/password', headers: data.headers, payload: { current_password: data.currentPassword, new_password: 'NewPassword!2027' } })
    expect(changed.statusCode).toBe(204)
    expect(changed.headers['set-cookie']).toContain('Max-Age=0')
    const [stored] = await database.db.select().from(users).where(eq(users.id, data.userId)).limit(1)
    expect(stored?.rowVersion).toBe(1)
    expect(await verify(stored!.passwordHash, 'NewPassword!2027')).toBe(true)
    expect(await verify(stored!.passwordHash, data.currentPassword)).toBe(false)
    const expired = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: data.headers.cookie } })
    expect(expired.statusCode).toBe(401)
    expect(await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, data.userId))).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'PASSWORD_CHANGED' })]))
  }, 30_000)

  it('removes a profile photo with version checks and audit history', async () => {
    const data = await fixture()
    const objectKey = `profiles/${data.userId}/old.webp`
    await database.db.update(users).set({ avatarObjectKey: objectKey }).where(eq(users.id, data.userId))
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me/avatar', headers: { ...data.headers, 'if-match': '"0"' } })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers.etag).toBe('"1"')
    expect(response.json()).toMatchObject({ avatar_url: null, row_version: 1 })
    const [stored] = await database.db.select().from(users).where(eq(users.id, data.userId)).limit(1)
    expect(stored?.avatarObjectKey).toBeNull()
    expect(await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, data.userId)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'AVATAR_DELETED' })]))
  })

  it('uploads, normalizes, persists, and exposes a profile photo', async () => {
    const data = await fixture()
    const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#1473e6' } }).png().toBuffer()
    const boundary = `----marketplace-${randomUUID()}`
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`),
      source,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'PUT', url: '/api/v1/me/avatar',
      headers: { ...data.headers, 'if-match': '"0"', 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers.etag).toBe('"1"')
    const body = response.json() as { avatar_url: string; row_version: number }
    expect(body).toMatchObject({ row_version: 1 })
    expect(body.avatar_url).toMatch(new RegExp(`^http://media\\.test/profiles/${data.userId}/[0-9a-f-]+\\.webp$`))

    const [stored] = await database.db.select().from(users).where(eq(users.id, data.userId)).limit(1)
    expect(stored?.avatarObjectKey).toMatch(new RegExp(`^profiles/${data.userId}/[0-9a-f-]+\\.webp$`))
    const storedBytes = await readFile(join(mediaDirectory, stored!.avatarObjectKey!))
    const metadata = await sharp(storedBytes).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512 })
    expect(await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, data.userId)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'AVATAR_UPDATED' })]))
  })
})
