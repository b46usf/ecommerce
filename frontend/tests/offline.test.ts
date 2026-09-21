import { describe, expect, it, vi } from 'vitest';
import { createMarketplaceApi, unwrap } from '../app/api/client';
import { createOfflineTransport, type StorageLike } from '../app/api/offline';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('offline marketplace transport', () => {
  it('seeds 18 local products and filters them while the backend is unavailable', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn(async () => { throw new TypeError('backend unavailable'); }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage, isOnline: () => true });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });

    const all = unwrap(await api.GET('/products', { params: { query: { limit: 100 } } }));
    const filtered = unwrap(await api.GET('/products', { params: { query: { q: 'kopi', limit: 20 } } }));
    const categories = unwrap(await api.GET('/categories', { params: { query: { limit: 100 } } }));

    expect(all.items).toHaveLength(18);
    expect(filtered.items.map(item => item.name)).toEqual(['Kopi Arabika Nusantara 250 g']);
    expect(categories.items).toHaveLength(6);
    expect(all.items[0]?.images[0]?.url).toBe('/demo-products/01-buku-tulis.svg');
    expect(storage.values.get('niaga:offline:v1')).toContain('Buku Tulis Premium');
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'seed' });
  });

  it('uses the last successful public response before falling back to seed data', async () => {
    let backendAvailable = true;
    const networkCategory = { id: crypto.randomUUID(), created_at: new Date().toISOString(), row_version: 2, name: 'Dari Backend', slug: 'backend' };
    const fetcher = vi.fn(async () => {
      if (!backendAvailable) throw new TypeError('backend unavailable');
      return json({ items: [networkCategory], next_cursor: null });
    }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => true });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });

    expect(unwrap(await api.GET('/categories', { params: { query: { limit: 100 } } })).items[0]?.name).toBe('Dari Backend');
    backendAvailable = false;
    const cached = await api.GET('/categories', { params: { query: { limit: 100 } } });
    expect(unwrap(cached).items[0]?.name).toBe('Dari Backend');
    expect(cached.response.headers.get('x-niaga-data-source')).toBe('cache');
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'cache' });
  });

  it('uses the local seed when a running backend reports a database 503', async () => {
    const fetcher = vi.fn(async () => json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' } }, 503)) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => true });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });
    const products = unwrap(await api.GET('/products', { params: { query: { limit: 18 } } }));
    expect(products.items).toHaveLength(18);
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'seed' });
  });

  it('returns an empty notification list without an unhandled offline error', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('backend unavailable'); }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => true });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });

    const notifications = unwrap(await api.GET('/me/notifications', { params: { query: { limit: 30 } } }));

    expect(notifications).toEqual({ items: [], next_cursor: null });
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'seed' });
  });

  it('logs out locally and queues the server logout while offline', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('backend unavailable'); }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => true });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });

    const result = await api.POST('/auth/logout');

    expect(result.response.status).toBe(204);
    expect(result.error).toBeUndefined();
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'seed', pendingMutations: 1 });
  });

  it('supports offline profile, cart, and address CRUD with versioned queued mutations', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('backend unavailable'); }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => false });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline });
    const accountId = '10000000-0000-4000-8000-000000000005';
    const skuId = '40000000-0000-4000-8000-000000000002';

    const profile = unwrap(await api.PATCH('/me', {
      params: { header: { 'If-Match': '"0"' } }, body: { name: 'Pembeli Offline Diperbarui', phone: '081234567890' },
    }));
    expect(profile).toMatchObject({ name: 'Pembeli Offline Diperbarui', phone: '081234567890', row_version: 1 });

    const added = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/cart/items', {
      params: { path: { buyerAccountId: accountId }, header: { 'If-Match': '"0"', 'Idempotency-Key': crypto.randomUUID() } },
      body: { sku_id: skuId, quantity: 2 },
    }));
    const itemId = added.items[0]!.id;
    const updated = unwrap(await api.PATCH('/buyer-accounts/{buyerAccountId}/cart/items/{cartItemId}', {
      params: { path: { buyerAccountId: accountId, cartItemId: itemId }, header: { 'If-Match': '"1"' } },
      body: { quantity: 4 },
    }));
    expect(updated.items[0]).toMatchObject({ id: itemId, quantity: 4 });
    const emptied = unwrap(await api.DELETE('/buyer-accounts/{buyerAccountId}/cart/items/{cartItemId}', {
      params: { path: { buyerAccountId: accountId, cartItemId: itemId }, header: { 'If-Match': '"2"' } },
    }));
    expect(emptied.items).toEqual([]);

    const addressBody = { label: 'Rumah', recipient_name: 'Pembeli Offline', phone: '081234567890',
      street: 'Jalan Niaga 1', province: 'DKI Jakarta', city: 'Jakarta', district: 'Menteng', postal_code: '10310', is_default: true };
    const address = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/addresses', {
      params: { path: { buyerAccountId: accountId }, header: { 'Idempotency-Key': crypto.randomUUID() } }, body: addressBody,
    }));
    const changedAddress = unwrap(await api.PUT('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', {
      params: { path: { buyerAccountId: accountId, addressId: address.id }, header: { 'If-Match': '"0"' } },
      body: { ...addressBody, label: 'Kantor' },
    }));
    expect(changedAddress).toMatchObject({ id: address.id, label: 'Kantor', row_version: 1 });
    const removedAddress = await api.DELETE('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', {
      params: { path: { buyerAccountId: accountId, addressId: address.id }, header: { 'If-Match': '"1"' } },
    });
    expect(removedAddress.response.status).toBe(204);
    expect(unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/addresses', {
      params: { path: { buyerAccountId: accountId }, query: { limit: 100 } },
    })).items).toEqual([]);
    expect(offline.status()).toMatchObject({ backendAvailable: false, source: 'seed', pendingMutations: 7 });
  });

  it('stores an offline cart mutation and re-signs it when the backend returns', async () => {
    let backendAvailable = false;
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (!backendAvailable) throw new TypeError('backend unavailable');
      if (request.url.endsWith('/auth/csrf')) return json({ csrf_token: 'online-csrf-token' });
      return json({ buyer_account_id: '10000000-0000-4000-8000-000000000005', row_version: 1, items: [] });
    }) as typeof fetch;
    let sequence = 0;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => true,
      randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
    const api = createMarketplaceApi({ baseUrl: 'http://shop.test/api/v1', fetch: fetcher, offline,
      createIdempotencyKey: () => 'offline-idempotency-key' });

    const cart = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/cart/items', {
      params: { path: { buyerAccountId: '10000000-0000-4000-8000-000000000005' },
        header: { 'If-Match': '"0"', 'Idempotency-Key': 'offline-cart-add' } },
      body: { sku_id: '40000000-0000-4000-8000-000000000002', quantity: 2 },
    }));
    expect(cart.items).toHaveLength(1);
    expect(offline.status().pendingMutations).toBe(1);

    backendAvailable = true;
    const status = await api.syncOffline();
    const replay = requests.filter(request => request.method === 'POST' && request.url.includes('/cart/items')).at(-1);
    expect(status).toMatchObject({ backendAvailable: true, source: 'network', pendingMutations: 0 });
    expect(replay?.headers.get('idempotency-key')).toBe('offline-cart-add');
    expect(replay?.headers.get('x-csrf-token')).toBe('online-csrf-token');
    expect(replay?.headers.get('x-request-signature')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('does not queue unsupported financial or file operations', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('backend unavailable'); }) as typeof fetch;
    const offline = createOfflineTransport({ fetch: fetcher, storage: new MemoryStorage(), isOnline: () => false });
    const result = await offline.fetch(new Request('http://shop.test/api/v1/buyer-accounts/account/checkout/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(result.status).toBe(503);
    expect(offline.status().pendingMutations).toBe(0);
  });
});
