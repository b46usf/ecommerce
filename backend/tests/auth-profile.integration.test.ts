import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { hash, verify } from 'argon2'
import { eq } from 'drizzle-orm'
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

  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Integration database name must end in _test.')
    database = createDatabase({ databaseUrl })
    config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'profile-integration-session-secret-32-characters',
      AUTH_TOKEN_SECRET: 'profile-integration-auth-token-secret-32-characters',
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
      reply.code(status).send({ error: { code: error instanceof AppError ? error.code : duplicate ? 'RESOURCE_CONFLICT' : 'REQUEST_ERROR', message: error.message, request_id: request.id } })
    })
    await app.register(cookie)
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
  })

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
})
