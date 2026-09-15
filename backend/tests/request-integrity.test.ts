import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { requestSignaturePayload, verifyRequestIntegrity } from '../src/shared/request-integrity.js';

const csrfToken = 'csrf-session-token-for-integrity-tests';

function signedRequest(options: {
  body?: unknown
  timestamp?: number
  nonce?: string
  signature?: string
  nodeEnv?: 'test' | 'production'
  redisSet?: ReturnType<typeof vi.fn>
} = {}): FastifyRequest {
  const timestamp = String(options.timestamp ?? Date.now());
  const nonce = options.nonce ?? 'abcdefghijklmnopqrstuv';
  const body = options.body ?? { quantity: 2, sku: 'SKU-1' };
  const payload = requestSignaturePayload({
    timestamp, nonce, method: 'POST', pathname: '/api/v1/cart/items', query: 'a=1&b=2', body,
  });
  const signature = options.signature ?? createHmac('sha256', csrfToken).update(payload).digest('base64url');
  return {
    method: 'POST', url: '/api/v1/cart/items?b=2&a=1', body,
    headers: {
      'x-request-timestamp': timestamp,
      'x-request-nonce': nonce,
      'x-request-signature': signature,
    },
    authSession: { csrfToken },
    isMultipart: () => false,
    server: { services: {
      config: { nodeEnv: options.nodeEnv ?? 'production' },
      redis: { set: options.redisSet ?? vi.fn().mockResolvedValue('OK') },
    } },
  } as unknown as FastifyRequest;
}

describe('browser request integrity', () => {
  it('accepts a valid signature and reserves its nonce', async () => {
    const redisSet = vi.fn().mockResolvedValue('OK');
    await expect(verifyRequestIntegrity(signedRequest({ redisSet }))).resolves.toBeUndefined();
    expect(redisSet).toHaveBeenCalledWith(expect.stringMatching(/^marketplace:request-nonce:/), '1', 'EX', 300, 'NX');
  });

  it('rejects body tampering, expired timestamps, and nonce replay', async () => {
    const original = signedRequest();
    original.body = { quantity: 3, sku: 'SKU-1' };
    await expect(verifyRequestIntegrity(original)).rejects.toMatchObject({ code: 'REQUEST_SIGNATURE_INVALID', statusCode: 400 });
    await expect(verifyRequestIntegrity(signedRequest({ timestamp: Date.now() - 301_000 }))).rejects.toMatchObject({ code: 'REQUEST_SIGNATURE_EXPIRED' });
    await expect(verifyRequestIntegrity(signedRequest({ redisSet: vi.fn().mockResolvedValue(null) }))).rejects.toMatchObject({ code: 'REQUEST_REPLAYED', statusCode: 409 });
  });

  it('requires signatures in production and permits unsigned local test clients', async () => {
    const production = signedRequest();
    production.headers = {};
    await expect(verifyRequestIntegrity(production)).rejects.toMatchObject({ code: 'REQUEST_SIGNATURE_REQUIRED' });
    const local = signedRequest({ nodeEnv: 'test' });
    local.headers = {};
    await expect(verifyRequestIntegrity(local)).resolves.toBeUndefined();
  });
});
