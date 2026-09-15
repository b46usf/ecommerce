import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { AppError } from './errors.js'
import { canonicalJson } from './idempotency.js'

const signatureWindowSeconds = 300
const signatureHeaders = ['x-request-timestamp', 'x-request-nonce', 'x-request-signature'] as const

function canonicalQuery(searchParams: URLSearchParams): string {
  const copy = new URLSearchParams(searchParams)
  copy.sort()
  return copy.toString()
}

export function requestSignaturePayload(input: {
  timestamp: string
  nonce: string
  method: string
  pathname: string
  query: string
  body: unknown
}): string {
  const bodyHash = createHash('sha256').update(canonicalJson(input.body)).digest('base64url')
  return ['v1', input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, input.query, bodyHash].join('\n')
}

function equalSignature(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'base64url')
  const right = Buffer.from(expected, 'base64url')
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
}

/**
 * Verifies integrity and freshness for browser JSON mutations. TLS supplies confidentiality;
 * this signature binds the CSRF session, route, query, and canonical body while the nonce blocks replay.
 */
export async function verifyRequestIntegrity(request: FastifyRequest): Promise<void> {
  if (request.isMultipart()) return
  const values = signatureHeaders.map(name => request.headers[name])
  const missing = values.some(value => typeof value !== 'string')
  if (missing) {
    if (request.server.services.config.nodeEnv === 'production') {
      throw new AppError(400, 'REQUEST_SIGNATURE_REQUIRED', 'Tanda tangan request wajib dikirim.')
    }
    return
  }
  const [timestamp, nonce, signature] = values as [string, string, string]
  if (!/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{22,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw new AppError(400, 'REQUEST_SIGNATURE_INVALID', 'Format tanda tangan request tidak valid.')
  }
  const skew = Math.abs(Date.now() - Number(timestamp))
  if (!Number.isFinite(skew) || skew > signatureWindowSeconds * 1000) {
    throw new AppError(400, 'REQUEST_SIGNATURE_EXPIRED', 'Tanda tangan request sudah kedaluwarsa.')
  }
  const session = request.authSession
  if (!session) throw new AppError(403, 'CSRF_INVALID', 'Sesi CSRF tidak tersedia.')
  const url = new URL(request.url, 'http://localhost')
  const payload = requestSignaturePayload({
    timestamp, nonce, method: request.method, pathname: url.pathname,
    query: canonicalQuery(url.searchParams), body: request.body,
  })
  const expected = createHmac('sha256', session.csrfToken).update(payload).digest('base64url')
  if (!equalSignature(signature, expected)) {
    throw new AppError(400, 'REQUEST_SIGNATURE_INVALID', 'Integritas request tidak dapat diverifikasi.')
  }
  const replayKey = `marketplace:request-nonce:${createHash('sha256').update(`${session.csrfToken}:${nonce}`).digest('hex')}`
  const stored = await request.server.services.redis.set(replayKey, '1', 'EX', signatureWindowSeconds, 'NX')
  if (stored !== 'OK') throw new AppError(409, 'REQUEST_REPLAYED', 'Request dengan nonce ini sudah diproses.')
}
