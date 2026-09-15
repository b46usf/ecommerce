import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { analyticsEvent, canonicalJson, createMarketplaceApi, MarketplaceApiError, signMutationRequest, unwrap, versionHeaders } from '../app/api/client';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('marketplace browser API client', () => {
  it('maps only approved operations to privacy-safe analytics names', () => {
    expect(analyticsEvent('POST', '/buyer-accounts/{buyerAccountId}/checkout/confirm')).toBe('order_created');
    expect(analyticsEvent('POST', '/documents')).toBeUndefined();
  });

  it('gets CSRF before mutation, sends browser credentials, and preserves a caller idempotency key', async () => {
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/auth/csrf')) return json({ csrf_token: 'csrf-1' });
      return json({ message: 'created' }, { status: 201 });
    }) as typeof fetch;
    const api = createMarketplaceApi({ baseUrl: 'http://api.test/api/v1/', fetch: fetcher, createIdempotencyKey: () => 'generated-key-1234' });

    await api.POST('/auth/register', {
      headers: { 'Idempotency-Key': 'stable-retry-key-1' },
      body: { name: 'Buyer', email: 'buyer@example.test', password: 'long-test-password' },
    });

    expect(requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /api/v1/auth/csrf', 'POST /api/v1/auth/register',
    ]);
    expect(requests[1]?.headers.get('x-csrf-token')).toBe('csrf-1');
    expect(requests[1]?.headers.get('idempotency-key')).toBe('stable-retry-key-1');
    expect(requests[1]?.headers.get('x-request-timestamp')).toMatch(/^\d{13}$/);
    expect(requests[1]?.headers.get('x-request-nonce')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(requests[1]?.headers.get('x-request-signature')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requests[1]?.credentials).toBe('include');
  });

  it('signs the canonical path, query, and JSON body with browser crypto', async () => {
    const timestamp = 1_800_000_000_000;
    const token = 'csrf-signing-token';
    const request = new Request('https://shop.test/api/v1/items?z=2&a=1', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ z: 2, a: { y: 1, x: 0 } }),
    });
    await signMutationRequest(request, token, timestamp);
    const nonce = request.headers.get('x-request-nonce')!;
    const bodyHash = createHash('sha256').update(canonicalJson({ z: 2, a: { y: 1, x: 0 } })).digest('base64url');
    const payload = ['v1', String(timestamp), nonce, 'POST', '/api/v1/items', 'a=1&z=2', bodyHash].join('\n');
    expect(request.headers.get('x-request-signature')).toBe(createHmac('sha256', token).update(payload).digest('base64url'));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('refreshes CSRF after login rotates the HttpOnly session', async () => {
    let csrfNumber = 0;
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/auth/csrf')) return json({ csrf_token: `csrf-${++csrfNumber}` });
      if (request.url.endsWith('/auth/login')) return json({ id: crypto.randomUUID(), name: 'Buyer', email: 'buyer@example.test', email_verified: true, admin_roles: [] });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const api = createMarketplaceApi({ baseUrl: 'http://api.test/api/v1', fetch: fetcher, createIdempotencyKey: () => crypto.randomUUID() });

    await api.POST('/auth/login', { body: { email: 'buyer@example.test', password: 'long-test-password' } });
    await api.POST('/auth/logout');

    const csrfCalls = requests.filter(request => request.url.endsWith('/auth/csrf'));
    expect(csrfCalls).toHaveLength(2);
    expect(requests.at(-1)?.headers.get('x-csrf-token')).toBe('csrf-2');
  });

  it('normalizes API errors and formats optimistic locking headers', () => {
    const body = { error: { code: 'STALE_VERSION', message: 'Data berubah.', request_id: 'request-1' } };
    const response = json(body, { status: 412 });
    expect(() => unwrap({ error: body, response })).toThrowError(MarketplaceApiError);
    try { unwrap({ error: body, response }); } catch (error) {
      expect(error).toMatchObject({ status: 412, code: 'STALE_VERSION', requestId: 'request-1' });
    }
    expect(versionHeaders(7)).toEqual({ 'If-Match': '"7"' });
    expect(() => versionHeaders(-1)).toThrow(TypeError);
  });
});
