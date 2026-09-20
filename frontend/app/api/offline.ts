import type { components } from './schema';

type Address = components['schemas']['Address'];
type BuyerAccount = components['schemas']['BuyerAccount'];
type Cart = components['schemas']['Cart'];
type Category = components['schemas']['Category'];
type Product = components['schemas']['Product'];
type Store = components['schemas']['Store'];
type User = components['schemas']['User'];

export const offlineStatusEvent = 'niaga:offline-status';
const storageKey = 'niaga:offline:v1';
const apiPrefix = '/api/v1';
const seedDate = '2026-09-13T00:00:00.000Z';
const storeId = '20000000-0000-4000-8000-000000000002';
const buyerAccountId = '10000000-0000-4000-8000-000000000005';
const buyerUserId = '10000000-0000-4000-8000-000000000002';
const taxClassId = '30000000-0000-4000-8000-000000000002';

export type OfflineDataSource = 'network' | 'cache' | 'seed';

export interface OfflineStatus {
  backendAvailable: boolean;
  source: OfflineDataSource;
  pendingMutations: number;
  lastSyncedAt?: string;
}

export interface QueuedMutation {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  queuedAt: string;
  localEntity?: { type: 'cart-item' | 'address'; id: string; skuId?: string };
}

interface CachedResponse {
  body: string;
  status: number;
  cachedAt: string;
}

interface OfflineState {
  version: 1;
  seededAt: string;
  lastSyncedAt?: string;
  user: User;
  buyerAccount: BuyerAccount;
  store: Store;
  categories: Category[];
  products: Product[];
  cart: Cart;
  addresses: Address[];
  cache: Record<string, CachedResponse>;
  queue: QueuedMutation[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OfflineTransport {
  fetch: typeof globalThis.fetch;
  status(): OfflineStatus;
  sync(send: (mutation: QueuedMutation) => Promise<Response>): Promise<OfflineStatus>;
}

interface OfflineTransportOptions {
  fetch: typeof globalThis.fetch;
  storage?: StorageLike;
  now?: () => Date;
  randomUUID?: () => string;
  notify?: (status: OfflineStatus) => void;
  isOnline?: () => boolean;
}

const categorySeed = [
  ['30000000-0000-4000-8000-000000000001', 'perlengkapan-sekolah', 'Perlengkapan Sekolah'],
  ['30000000-0000-4000-8000-000000000003', 'elektronik', 'Elektronik'],
  ['30000000-0000-4000-8000-000000000004', 'rumah-tangga', 'Rumah Tangga'],
  ['30000000-0000-4000-8000-000000000005', 'fashion', 'Fashion'],
  ['30000000-0000-4000-8000-000000000006', 'kesehatan', 'Kesehatan'],
  ['30000000-0000-4000-8000-000000000007', 'makanan-minuman', 'Makanan & Minuman'],
] as const;

const productSeed = [
  ['Buku Tulis Premium 10 Pack', 'buku-tulis-premium-10-pack', 0, 'SCH-BOOK-001', 'pak', 45_000, 120, 900, 22, 16, 6, '01-buku-tulis.svg', 'Biru', 'Buku tulis premium dengan kertas halus untuk kebutuhan sekolah dan kantor.'],
  ['Set Alat Tulis Lengkap 12 Pcs', 'set-alat-tulis-lengkap', 0, 'SCH-STAT-002', 'set', 32_500, 85, 350, 24, 12, 4, '02-alat-tulis.svg', 'Kuning', 'Satu set alat tulis praktis berisi perlengkapan belajar harian.'],
  ['Tas Ransel Sekolah Ergonomis', 'tas-ransel-sekolah-ergonomis', 0, 'SCH-BAG-003', 'buah', 189_000, 42, 700, 42, 30, 16, '03-tas-sekolah.svg', 'Navy', 'Ransel ringan dengan bantalan punggung dan kompartemen laptop.'],
  ['Headset Bluetooth Stereo', 'headset-bluetooth-stereo', 1, 'ELC-HDST-004', 'unit', 249_000, 64, 280, 20, 18, 8, '04-headset.svg', 'Hitam', 'Headset nirkabel dengan suara jernih dan baterai tahan lama.'],
  ['Keyboard Wireless Ringkas', 'keyboard-wireless-ringkas', 1, 'ELC-KEY-005', 'unit', 279_000, 37, 620, 36, 15, 4, '05-keyboard.svg', 'Putih', 'Keyboard ringkas untuk bekerja nyaman di meja rumah maupun kantor.'],
  ['Power Bank 10000 mAh', 'power-bank-10000-mah', 1, 'ELC-PWR-006', 'unit', 199_000, 76, 240, 14, 7, 3, '06-power-bank.svg', 'Biru', 'Pengisi daya portabel dua port dengan indikator kapasitas baterai.'],
  ['Botol Minum Stainless 750 ml', 'botol-minum-stainless-750ml', 2, 'HOM-BTL-007', 'buah', 115_000, 98, 390, 28, 8, 8, '07-botol-minum.svg', 'Hijau', 'Botol stainless tahan lama untuk minuman dingin dan hangat.'],
  ['Lampu Meja LED Fleksibel', 'lampu-meja-led-fleksibel', 2, 'HOM-LMP-008', 'unit', 149_000, 53, 550, 32, 16, 12, '08-lampu-meja.svg', 'Putih', 'Lampu meja hemat energi dengan tiga tingkat kecerahan.'],
  ['Kotak Penyimpanan Serbaguna', 'kotak-penyimpanan-serbaguna', 2, 'HOM-BOX-009', 'set', 89_000, 71, 1100, 38, 28, 22, '09-kotak-penyimpanan.svg', 'Krem', 'Kotak penyimpanan bertutup untuk menjaga rumah tetap rapi.'],
  ['Tote Bag Kanvas Premium', 'tote-bag-kanvas-premium', 3, 'FSH-TOTE-010', 'buah', 79_000, 110, 210, 38, 34, 4, '10-tote-bag.svg', 'Natural', 'Tas kanvas tebal dengan ruang luas untuk aktivitas sehari-hari.'],
  ['Jaket Hoodie Unisex', 'jaket-hoodie-unisex', 3, 'FSH-HOOD-011', 'buah', 229_000, 48, 650, 35, 28, 8, '11-hoodie.svg', 'Abu-abu', 'Hoodie unisex berbahan lembut dengan potongan modern.'],
  ['Sepatu Sneakers Harian', 'sepatu-sneakers-harian', 3, 'FSH-SHOE-012', 'pasang', 329_000, 34, 950, 34, 22, 13, '12-sneakers.svg', 'Putih', 'Sneakers ringan dengan sol empuk untuk kegiatan sehari-hari.'],
  ['Sabun Cair Natural 500 ml', 'sabun-cair-natural-500ml', 4, 'HLT-SOAP-013', 'botol', 58_000, 140, 560, 20, 8, 8, '13-sabun-cair.svg', 'Hijau', 'Sabun cair beraroma segar untuk membersihkan tangan sehari-hari.'],
  ['Sunscreen SPF 50 PA++++', 'sunscreen-spf-50', 4, 'HLT-SUN-014', 'tube', 98_000, 92, 90, 14, 5, 4, '14-sunscreen.svg', 'Oranye', 'Tabir surya ringan untuk membantu melindungi kulit saat beraktivitas.'],
  ['Masker Medis 3 Ply 50 Pcs', 'masker-medis-3-ply-50-pcs', 4, 'HLT-MASK-015', 'kotak', 42_000, 160, 260, 20, 11, 9, '15-masker-medis.svg', 'Biru', 'Masker medis tiga lapis dengan earloop lembut dalam kemasan higienis.'],
  ['Kopi Arabika Nusantara 250 g', 'kopi-arabika-nusantara-250g', 5, 'FNB-COF-016', 'pak', 85_000, 66, 280, 22, 13, 7, '16-kopi-arabika.svg', 'Cokelat', 'Biji kopi arabika pilihan dengan karakter rasa seimbang.'],
  ['Granola Madu Kacang 300 g', 'granola-madu-kacang-300g', 5, 'FNB-GRA-017', 'pak', 72_000, 83, 330, 24, 16, 7, '17-granola.svg', 'Emas', 'Granola renyah dengan madu dan kacang untuk sarapan praktis.'],
  ['Teh Hijau Melati 25 Kantong', 'teh-hijau-melati-25-kantong', 5, 'FNB-TEA-018', 'kotak', 38_000, 125, 160, 16, 9, 8, '18-teh-hijau.svg', 'Hijau', 'Teh hijau beraroma melati dalam kantong seduh praktis.'],
] as const;

function sequenceId(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export function createOfflineSeed(): OfflineState {
  const categories: Category[] = categorySeed.map(([id, slug, name]) => ({
    id, slug, name, parent_id: null, attribute_schema: {}, created_at: seedDate, row_version: 0,
  }));
  const products: Product[] = productSeed.map((item, offset) => {
    const [name, slug, categoryIndex, skuCode, unit, price, stock, weight, length, width, height, image, color, description] = item;
    const sequence = offset + 1;
    const productId = sequenceId('40000000', sequence);
    const skuId = sequence === 1 ? '40000000-0000-4000-8000-000000000002' : sequenceId('41000000', sequence);
    return {
      id: productId, created_at: seedDate, row_version: 0, name, slug,
      description: `<p>${description}</p>`, category_id: categories[categoryIndex]!.id,
      tax_class_id: taxClassId, store_id: storeId, status: 'ACTIVE',
      attributes: { brand: 'Niaga Pilihan', color, condition: 'Baru', offline_demo: true },
      skus: [{ id: skuId, created_at: seedDate, row_version: 0, sku_code: skuCode,
        variant_attributes: { color }, unit_label: unit, unit_price_gross: price,
        weight_g: weight, length_cm: length, width_cm: width, height_cm: height,
        available_quantity: stock, status: 'ACTIVE' }],
      images: [{ id: sequenceId('43000000', sequence), created_at: seedDate, row_version: 0,
        url: `/demo-products/${image}`, alt_text: `Ilustrasi ${name}`, sort_order: 0 }],
    };
  });
  return {
    version: 1, seededAt: seedDate,
    user: { id: buyerUserId, row_version: 0, name: 'Pembeli Demo Offline', email: 'buyer@example.test',
      phone: null, avatar_url: null, email_verified: true, admin_roles: [] },
    buyerAccount: { id: buyerAccountId, created_at: seedDate, row_version: 0,
      kind: 'INDIVIDUAL', organization_name: null, manager_user_id: buyerUserId },
    store: { id: storeId, created_at: seedDate, row_version: 0, name: 'Toko Demo', slug: 'toko-demo', status: 'ACTIVE' },
    categories, products, cart: { buyer_account_id: buyerAccountId, row_version: 0, items: [] },
    addresses: [], cache: {}, queue: [],
  };
}

function response(body: unknown, status = 200, source: Exclude<OfflineDataSource, 'network'> = 'seed') {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'x-niaga-data-source': source, 'cache-control': 'no-store' },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return response({ error: { code, message, request_id: `offline-${Date.now()}` } }, status);
}

function cacheKey(url: URL) {
  const query = new URLSearchParams(url.searchParams); query.sort();
  return `${url.pathname}${query.size ? `?${query}` : ''}`;
}

function routePath(url: URL) {
  const index = url.pathname.indexOf(apiPrefix);
  return index >= 0 ? url.pathname.slice(index + apiPrefix.length) || '/' : url.pathname;
}

function isCacheable(path: string) {
  return path === '/categories' || path === '/products' || path.startsWith('/products/')
    || path.startsWith('/stores/') || path.startsWith('/policies/');
}

function isQueueable(path: string, contentType: string) {
  return !contentType.startsWith('multipart/form-data') && (
    path === '/me' || /^\/buyer-accounts\/[^/]+\/cart\/items(?:\/[^/]+)?$/.test(path)
    || /^\/buyer-accounts\/[^/]+\/addresses(?:\/[^/]+)?$/.test(path)
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createOfflineTransport(options: OfflineTransportOptions): OfflineTransport {
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);
  let state = createOfflineSeed();
  let currentStatus: OfflineStatus = { backendAvailable: true, source: 'network', pendingMutations: 0 };

  if (options.storage) {
    try {
      const stored = options.storage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as Partial<OfflineState> : undefined;
      if (parsed?.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.queue)) state = parsed as OfflineState;
      else options.storage.setItem(storageKey, JSON.stringify(state));
    } catch { /* private browsing or a full quota keeps the in-memory fallback available */ }
  }

  const persist = () => {
    try { options.storage?.setItem(storageKey, JSON.stringify(state)); }
    catch { /* continue with the in-memory copy when persistent storage is unavailable */ }
  };
  const publish = (backendAvailable: boolean, source: OfflineDataSource) => {
    currentStatus = { backendAvailable, source, pendingMutations: state.queue.length, lastSyncedAt: state.lastSyncedAt };
    options.notify?.({ ...currentStatus });
  };

  function listProducts(url: URL) {
    const needle = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('id');
    const categoryId = url.searchParams.get('category_id');
    const requestedStore = url.searchParams.get('store_id');
    const minimum = Number(url.searchParams.get('min_price') ?? 0);
    const maximum = Number(url.searchParams.get('max_price') ?? Number.MAX_SAFE_INTEGER);
    const sort = url.searchParams.get('sort');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 20)));
    const items = state.products.filter(product => {
      const price = product.skus[0]?.unit_price_gross ?? 0;
      return (!needle || product.name.toLocaleLowerCase('id').includes(needle) || product.description?.toLocaleLowerCase('id').includes(needle))
        && (!categoryId || product.category_id === categoryId) && (!requestedStore || product.store_id === requestedStore)
        && price >= minimum && price <= maximum;
    });
    if (sort === 'price_asc') items.sort((a, b) => a.skus[0]!.unit_price_gross - b.skus[0]!.unit_price_gross);
    if (sort === 'price_desc') items.sort((a, b) => b.skus[0]!.unit_price_gross - a.skus[0]!.unit_price_gross);
    if (sort === 'newest') items.reverse();
    return { items: items.slice(0, limit), next_cursor: null };
  }

  function cartItem(skuId: string, quantity: number) {
    const product = state.products.find(item => item.skus.some(sku => sku.id === skuId));
    const sku = product?.skus.find(item => item.id === skuId);
    if (!product || !sku) return undefined;
    return {
      id: randomUUID(), created_at: now().toISOString(), row_version: 0, sku_id: sku.id, quote_line_id: null,
      quantity, unit_price_gross: sku.unit_price_gross, store_id: product.store_id, product_id: product.id,
      product_name: product.name, sku_code: sku.sku_code, variant_attributes: sku.variant_attributes ?? {},
      available_quantity: sku.available_quantity, product_status: product.status, sku_status: sku.status,
      store_name: state.store.name, image_url: product.images[0]?.url ?? null,
    } as Cart['items'][number];
  }

  async function localResponse(request: Request, path: string): Promise<Response | undefined> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET') {
      if (path === '/auth/csrf') return response({ csrf_token: 'offline-local-csrf-token-2026' });
      if (path === '/me') return response(state.user);
      if (path === '/me/buyer-accounts') return response({ items: [state.buyerAccount], next_cursor: null });
      if (path === '/categories') return response({ items: state.categories, next_cursor: null });
      if (path === '/products') return response(listProducts(url));
      if (path.startsWith('/products/')) {
        const product = state.products.find(item => item.id === decodeURIComponent(path.slice('/products/'.length)));
        return product ? response(product) : errorResponse(404, 'PRODUCT_NOT_FOUND', 'Produk offline tidak ditemukan.');
      }
      if (path.startsWith('/stores/')) return decodeURIComponent(path.slice('/stores/'.length)) === state.store.id
        ? response(state.store) : errorResponse(404, 'STORE_NOT_FOUND', 'Toko offline tidak ditemukan.');
      if (path === '/vendor/stores') return response({ items: [state.store], next_cursor: null });
      if (/^\/vendor\/stores\/[^/]+\/products$/.test(path)) return response(listProducts(url));
      if (/^\/buyer-accounts\/[^/]+\/cart$/.test(path)) return response(state.cart);
      if (/^\/buyer-accounts\/[^/]+\/addresses$/.test(path)) return response({ items: state.addresses, next_cursor: null });
      return undefined;
    }

    let body: Record<string, unknown> = {};
    try { body = await request.clone().json() as Record<string, unknown>; } catch { /* body is optional */ }
    if (method === 'PATCH' && path === '/me') {
      state.user = { ...state.user, ...body, row_version: state.user.row_version + 1 } as User;
      persist(); return response(state.user);
    }
    const cartMatch = path.match(/^\/buyer-accounts\/[^/]+\/cart\/items(?:\/([^/]+))?$/);
    if (cartMatch) {
      if (method === 'POST') {
        const skuId = String(body.sku_id ?? ''); const quantity = Number(body.quantity ?? 0);
        const existing = state.cart.items.find(item => item.sku_id === skuId);
        if (existing) existing.quantity += quantity;
        else { const item = cartItem(skuId, quantity); if (!item) return errorResponse(422, 'SKU_NOT_FOUND', 'SKU offline tidak ditemukan.'); state.cart.items.push(item); }
      } else {
        const id = decodeURIComponent(cartMatch[1] ?? ''); const item = state.cart.items.find(value => value.id === id);
        if (!item) return errorResponse(404, 'CART_ITEM_NOT_FOUND', 'Item keranjang offline tidak ditemukan.');
        if (method === 'PATCH') item.quantity = Number(body.quantity ?? item.quantity);
        else if (method === 'DELETE') state.cart.items = state.cart.items.filter(value => value.id !== id);
        else return undefined;
      }
      state.cart.row_version += 1; persist(); return response(state.cart);
    }
    const addressMatch = path.match(/^\/buyer-accounts\/[^/]+\/addresses(?:\/([^/]+))?$/);
    if (addressMatch) {
      if (method === 'POST') {
        const address = { ...body, id: randomUUID(), created_at: now().toISOString(), row_version: 0 } as Address;
        state.addresses.push(address); persist(); return response(address, 201);
      }
      const id = decodeURIComponent(addressMatch[1] ?? ''); const index = state.addresses.findIndex(value => value.id === id);
      if (index < 0) return errorResponse(404, 'ADDRESS_NOT_FOUND', 'Alamat offline tidak ditemukan.');
      if (method === 'PUT') {
        state.addresses[index] = { ...state.addresses[index]!, ...body, row_version: state.addresses[index]!.row_version + 1 } as Address;
        persist(); return response(state.addresses[index]);
      }
      if (method === 'DELETE') { state.addresses.splice(index, 1); persist(); return response(undefined, 204); }
    }
    return undefined;
  }

  async function queue(request: Request, path: string, local: Response) {
    if (!isQueueable(path, request.headers.get('content-type') ?? '')) return;
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'idempotency-key', 'if-match']) {
      const value = request.headers.get(name); if (value) headers[name] = value;
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().text();
    let localEntity: QueuedMutation['localEntity'];
    if (request.method === 'POST') {
      try {
        const localBody = await local.clone().json() as Address | Cart;
        if (/\/cart\/items$/.test(path) && 'items' in localBody) {
          const skuId = String(body ? (JSON.parse(body) as { sku_id?: unknown }).sku_id ?? '' : '');
          const item = localBody.items.find(value => value.sku_id === skuId);
          if (item) localEntity = { type: 'cart-item', id: item.id, skuId };
        } else if (/\/addresses$/.test(path) && 'id' in localBody) localEntity = { type: 'address', id: localBody.id };
      } catch { /* mapping is optional; the mutation remains replayable */ }
    }
    state.queue.push({ id: randomUUID(), url: request.url, method: request.method, headers, body: body || undefined, queuedAt: now().toISOString(), localEntity });
    persist();
  }

  const offlineFetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = routePath(url);
    if (isOnline()) {
      try {
        const network = await options.fetch(request.clone());
        if (network.status < 500) {
          if (request.method === 'GET' && network.ok && isCacheable(path)) {
            const body = await network.clone().text();
            state.cache[cacheKey(url)] = { body, status: network.status, cachedAt: now().toISOString() };
            persist();
          }
          publish(true, 'network');
          return network;
        }
      } catch { /* use cache or seed below */ }
    }

    if (request.method === 'GET') {
      const cached = state.cache[cacheKey(url)];
      if (cached) { publish(false, 'cache'); return new Response(cached.body, { status: cached.status, headers: { 'content-type': 'application/json', 'x-niaga-data-source': 'cache' } }); }
    }
    const local = await localResponse(request, path);
    if (local) {
      if (request.method !== 'GET') await queue(request, path, local);
      publish(false, local.headers.get('x-niaga-data-source') === 'cache' ? 'cache' : 'seed');
      return local;
    }
    publish(false, 'seed');
    return errorResponse(503, 'OFFLINE_OPERATION_UNAVAILABLE', 'Fitur ini memerlukan koneksi backend. Data lokal tetap aman dan dapat dicoba kembali setelah tersambung.');
  };

  return {
    fetch: offlineFetch,
    status: () => ({ ...currentStatus, pendingMutations: state.queue.length, lastSyncedAt: state.lastSyncedAt }),
    async sync(send) {
      if (!isOnline() || !state.queue.length) { publish(isOnline() && currentStatus.backendAvailable, currentStatus.source); return { ...currentStatus }; }
      for (const mutation of [...state.queue]) {
        try {
          const synced = await send(mutation);
          if (synced.ok) {
            try {
              const syncedBody = synced.status === 204 ? undefined : await synced.clone().json() as Address | Cart | User;
              if (syncedBody && 'buyer_account_id' in syncedBody) {
                if (mutation.localEntity?.type === 'cart-item') {
                  const replacement = syncedBody.items.find(item => item.sku_id === mutation.localEntity?.skuId);
                  if (replacement) {
                    for (const queued of state.queue) queued.url = queued.url.replace(encodeURIComponent(mutation.localEntity.id), encodeURIComponent(replacement.id));
                  }
                }
                state.cart = syncedBody;
              } else if (syncedBody && mutation.localEntity?.type === 'address' && 'postal_code' in syncedBody) {
                const index = state.addresses.findIndex(item => item.id === mutation.localEntity?.id);
                if (index >= 0) state.addresses[index] = syncedBody;
                for (const queued of state.queue) queued.url = queued.url.replace(encodeURIComponent(mutation.localEntity.id), encodeURIComponent(syncedBody.id));
              } else if (syncedBody && 'email_verified' in syncedBody) state.user = syncedBody;
            } catch { /* a successful empty response still completes the queued action */ }
            state.queue = state.queue.filter(item => item.id !== mutation.id);
            state.lastSyncedAt = now().toISOString();
            persist(); publish(true, 'network');
          } else if (synced.status === 401 || synced.status === 403 || synced.status === 412 || synced.status >= 500) break;
        } catch { publish(false, currentStatus.source === 'network' ? 'seed' : currentStatus.source); break; }
      }
      return { ...currentStatus, pendingMutations: state.queue.length, lastSyncedAt: state.lastSyncedAt };
    },
  };
}

export function browserOfflineNotifier(status: OfflineStatus) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(offlineStatusEvent, { detail: status }));
}
