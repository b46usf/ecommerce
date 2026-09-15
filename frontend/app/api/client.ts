import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sessionRotatingPaths = new Set(['/auth/login', '/auth/logout', '/auth/reset-password']);
const analyticsEvents: Record<string, string> = {
  'GET /products': 'search_submitted', 'GET /products/{productId}': 'product_viewed',
  'POST /buyer-accounts/{buyerAccountId}/cart/items': 'add_to_cart',
  'POST /buyer-accounts/{buyerAccountId}/quote-requests': 'quote_requested',
  'POST /buyer-accounts/{buyerAccountId}/quote-versions/{quoteVersionId}/accept': 'quote_accepted',
  'POST /buyer-accounts/{buyerAccountId}/shipping-rates': 'shipping_rates_loaded',
  'POST /buyer-accounts/{buyerAccountId}/checkout/preview': 'checkout_previewed',
  'POST /buyer-accounts/{buyerAccountId}/checkout/confirm': 'order_created',
  'POST /buyer-accounts/{buyerAccountId}/order-groups/{orderGroupId}/payment-sessions': 'payment_session_opened',
  'POST /vendor/stores/{storeId}/orders/{vendorOrderId}/ready-to-ship': 'shipment_booked',
  'POST /buyer-accounts/{buyerAccountId}/vendor-orders/{vendorOrderId}/received': 'order_received',
  'POST /buyer-accounts/{buyerAccountId}/vendor-orders/{vendorOrderId}/cases': 'case_opened',
};

export function analyticsEvent(method: string, schemaPath: string): string | undefined {
  return analyticsEvents[`${method.toUpperCase()} ${schemaPath}`];
}

export interface MarketplaceApiOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  createIdempotencyKey?: () => string;
}

export class MarketplaceApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, requestId?: string, details?: unknown) {
    super(message);
    this.name = 'MarketplaceApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export function errorFromResponse(response: Response, body: unknown): MarketplaceApiError {
  const envelope = body && typeof body === 'object' && 'error' in body
    ? (body as { error?: { code?: unknown; message?: unknown; request_id?: unknown; details?: unknown } }).error
    : undefined;
  const requestId = typeof envelope?.request_id === 'string'
    ? envelope.request_id
    : response.headers.get('x-request-id') ?? undefined;
  return new MarketplaceApiError(
    response.status,
    typeof envelope?.code === 'string' ? envelope.code : 'REQUEST_ERROR',
    typeof envelope?.message === 'string' ? envelope.message : `Permintaan gagal (${response.status}).`,
    requestId,
    envelope?.details,
  );
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined) throw errorFromResponse(result.response, result.error);
  return result.data as T;
}

export function versionHeaders(rowVersion: number): { 'If-Match': string } {
  if (!Number.isSafeInteger(rowVersion) || rowVersion < 0) throw new TypeError('rowVersion harus berupa integer non-negatif.');
  return { 'If-Match': `"${rowVersion}"` };
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function signMutationRequest(request: Request, csrfToken: string, timestamp = Date.now()): Promise<Request> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.startsWith('multipart/form-data')) return request;
  const text = await request.clone().text();
  const body = text ? JSON.parse(text) as unknown : undefined;
  const bodyHash = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(body))));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = base64url(nonceBytes);
  const url = new URL(request.url);
  const query = new URLSearchParams(url.searchParams); query.sort();
  const payload = ['v1', String(timestamp), nonce, request.method.toUpperCase(), url.pathname, query.toString(), bodyHash].join('\n');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(csrfToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  request.headers.set('X-Request-Timestamp', String(timestamp));
  request.headers.set('X-Request-Nonce', nonce);
  request.headers.set('X-Request-Signature', signature);
  return request;
}

export function createMarketplaceApi(options: MarketplaceApiOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;
  const createIdempotencyKey = options.createIdempotencyKey ?? (() => crypto.randomUUID());
  let csrfToken: string | undefined;
  let csrfRequest: Promise<string> | undefined;

  const refreshCsrf = async (force = false): Promise<string> => {
    if (!force && csrfToken) return csrfToken;
    if (!force && csrfRequest) return csrfRequest;
    csrfRequest = (async () => {
      const response = await fetcher(`${baseUrl}/auth/csrf`, {
        method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      let body: unknown;
      try { body = await response.json(); } catch { body = undefined; }
      if (!response.ok) throw errorFromResponse(response, body);
      const token = body && typeof body === 'object' && 'csrf_token' in body
        ? (body as { csrf_token?: unknown }).csrf_token
        : undefined;
      if (typeof token !== 'string' || !token) throw new MarketplaceApiError(response.status, 'INVALID_CSRF_RESPONSE', 'Respons CSRF backend tidak valid.');
      csrfToken = token;
      return token;
    })();
    try { return await csrfRequest; } finally { csrfRequest = undefined; }
  };

  const middleware: Middleware = {
    async onRequest({ request }) {
      if (mutationMethods.has(request.method.toUpperCase())) {
        const token = await refreshCsrf();
        request.headers.set('X-CSRF-Token', token);
        if (!request.headers.has('Idempotency-Key')) request.headers.set('Idempotency-Key', createIdempotencyKey());
        await signMutationRequest(request, token);
      }
      return request;
    },
    async onResponse({ request, response, schemaPath }) {
      if (response.status === 401 || response.status === 403 || (response.ok && sessionRotatingPaths.has(schemaPath))) {
        csrfToken = undefined;
      }
      const event = response.ok ? analyticsEvent(request.method, schemaPath) : undefined;
      if (event && typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        globalThis.dispatchEvent(new CustomEvent('niaga:analytics', { detail: { event, status: response.status } }));
      }
      return response;
    },
  };

  const client = createClient<paths>({ baseUrl, fetch: fetcher, credentials: 'include' });
  client.use(middleware);
  return Object.assign(client, {
    refreshCsrf,
    clearCsrf: () => { csrfToken = undefined; },
  });
}

export type MarketplaceApi = ReturnType<typeof createMarketplaceApi>;
