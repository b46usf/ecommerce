import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/index.js';
import { addresses, auditLogs, buyerAccounts, categories, idempotencyKeys, inventoryBalances, inventoryMovements, legalEntities,
  productMedia, products, storeMembers, stores, taxClasses, users } from '../src/database/schema.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { AppError } from '../src/shared/errors.js';
import { catalogRoutes } from '../src/modules/catalog/index.js';
import { inventoryRoutes } from '../src/modules/inventory/index.js';
import { cartRoutes } from '../src/modules/cart/index.js';
import { rfqRoutes } from '../src/modules/rfq/index.js';
import { mediaRoutes } from '../src/modules/media/index.js';
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js';
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('catalog and inventory against MySQL-compatible InnoDB', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const sessions = new Map<string, string>();

  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Integration database name must end in _test.');
    database = createDatabase({ databaseUrl });
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'catalog-integration-session-secret-32-characters' });
    app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array' } } });
    app.decorate('services', { db: database.db, config,
      redis: { get: async (key: string) => sessions.get(key) ?? null,
        set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; },
        del: async (key: string) => sessions.delete(key) ? 1 : 0 },
      checkDatabase: database.ping, close: async () => {},
    } as unknown as Services);
    app.setErrorHandler((error, _request, reply) => {
      const err = error as Error & { code?: string; cause?: { code?: string }; validation?: unknown };
      const duplicate = (err.cause?.code ?? err.code) === 'ER_DUP_ENTRY';
      reply.code(error instanceof AppError ? error.statusCode : err.validation ? 400 : duplicate ? 409 : 500)
        .send({ message: error instanceof Error ? error.message : 'Unknown failure' });
    });
    await app.register(cookie);
    registerSessionHooks(app);
    app.addHook('preValidation', async request => {
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) requireCsrf(request);
    });
    await app.register(async api => { await catalogRoutes(api); await inventoryRoutes(api); await cartRoutes(api); await rfqRoutes(api); await mediaRoutes(api); }, { prefix: '/api/v1' });
    await app.ready();
  }, 30_000);

  afterAll(async () => { if (app) await app.close(); if (database) await database.close(); });

  async function fixture() {
    const actorId = randomUUID(), otherId = randomUUID(), storeId = randomUUID(), otherStoreId = randomUUID();
    const legalId = randomUUID(), otherLegalId = randomUUID(), categoryId = randomUUID(), taxId = randomUUID();
    const passwordHash = 'integration-password-hash';
    await database.db.insert(users).values([
      { id: actorId, emailNormalized: `${actorId}@example.test`, name: 'Vendor A', passwordHash },
      { id: otherId, emailNormalized: `${otherId}@example.test`, name: 'Vendor B', passwordHash },
    ]);
    await database.db.insert(buyerAccounts).values({ id: actorId, managerUserId: actorId, kind: 'INDIVIDUAL' });
    await database.db.insert(legalEntities).values([
      { id: legalId, createdBy: actorId, kind: 'INDIVIDUAL', legalName: 'Vendor A', status: 'VERIFIED' },
      { id: otherLegalId, createdBy: otherId, kind: 'INDIVIDUAL', legalName: 'Vendor B', status: 'VERIFIED' },
    ]);
    await database.db.insert(stores).values([
      { id: storeId, legalEntityId: legalId, name: 'Store A', slug: `store-${storeId}`, contactPhone: '081234567890', status: 'ACTIVE' },
      { id: otherStoreId, legalEntityId: otherLegalId, name: 'Store B', slug: `store-${otherStoreId}`, contactPhone: '081234567891', status: 'ACTIVE' },
    ]);
    await database.db.insert(storeMembers).values([
      { storeId, userId: actorId, roleCode: 'OWNER' }, { storeId: otherStoreId, userId: otherId, roleCode: 'OWNER' },
    ]);
    await database.db.insert(categories).values({ id: categoryId, name: 'School stationery', slug: `category-${categoryId}`,
      attributeSchema: { type: 'object', properties: { color: { type: 'string' } }, additionalProperties: false } });
    await database.db.insert(taxClasses).values({ id: taxId, code: `T${taxId}`, name: 'Integration class', status: 'ACTIVE' });
    const token = randomToken(), csrfToken = randomToken();
    sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({ userId: actorId,
      passwordVersion: tokenHash(passwordHash), csrfToken, expiresAt: Date.now() + 60_000 }));
    const headers = { cookie: `marketplace_session=${token}`, 'x-csrf-token': csrfToken };
    const productBody = { name: 'Notebook example', description: '<p>Notebook</p>', slug: `notebook-${randomUUID()}`,
      category_id: categoryId, tax_class_id: taxId, attributes: { color: 'blue' } };
    const create = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${storeId}/products`,
      headers: { ...headers, 'idempotency-key': randomUUID() }, payload: productBody });
    expect(create.statusCode, create.body).toBe(201);
    const product = create.json();
    const skuBody = { sku_code: `SKU-${randomUUID()}`, unit_label: 'pcs', unit_price_gross: 15000,
      weight_g: 100, length_cm: 20, width_cm: 10, height_cm: 2 };
    const skuResponse = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${storeId}/products/${product.id}/skus`,
      headers: { ...headers, 'idempotency-key': randomUUID() }, payload: skuBody });
    expect(skuResponse.statusCode, skuResponse.body).toBe(201);
    const sku = skuResponse.json();
    await database.db.update(inventoryBalances).set({ onHand: 10, reserved: 7 }).where(eq(inventoryBalances.skuId, sku.id));
    const inventoryUrl = `/api/v1/vendor/stores/${storeId}/skus/${sku.id}/stock-adjustments`;
    return { actorId, buyerAccountId: actorId, storeId, otherStoreId, headers, product, productBody, sku, skuBody, inventoryUrl };
  }

  it('validates exact request fields and category attributes and sanitizes persisted rich text', async () => {
    const f = await fixture();
    const url = `/api/v1/vendor/stores/${f.storeId}/products`;
    const extra = await app.inject({ method: 'POST', url, headers: { ...f.headers, 'idempotency-key': randomUUID() },
      payload: { ...f.productBody, unexpected: true } });
    expect(extra.statusCode, extra.body).toBe(400);
    const attributes = await app.inject({ method: 'POST', url, headers: { ...f.headers, 'idempotency-key': randomUUID() },
      payload: { ...f.productBody, attributes: { color: 1 } } });
    expect(attributes.statusCode, attributes.body).toBe(422);
    const changed = await app.inject({ method: 'PUT', url: `${url}/${f.product.id}`, headers: { ...f.headers, 'if-match': '"1"' },
      payload: { ...f.productBody, description: '<p onclick="evil()">Fine</p><script>alert(1)</script>' } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().description).toBe('<p>Fine</p>');
    expect(changed.headers.etag).toBe('"2"');
    const [stored] = await database.db.select().from(products).where(eq(products.id, f.product.id));
    expect(stored?.description).toBe('<p>Fine</p>');
  });

  it('checks membership and nested resource ownership for vendor writes', async () => {
    const f = await fixture();
    const forbidden = await app.inject({ method: 'PUT', url: `/api/v1/vendor/stores/${f.otherStoreId}/products/${f.product.id}`,
      headers: { ...f.headers, 'if-match': '"1"' }, payload: f.productBody });
    expect(forbidden.statusCode).toBe(403);
    const missing = await app.inject({ method: 'PUT', url: `/api/v1/vendor/stores/${f.storeId}/products/${randomUUID()}`,
      headers: { ...f.headers, 'if-match': '"0"' }, payload: f.productBody });
    expect(missing.statusCode).toBe(404);
    const noCsrf = await app.inject({ method: 'POST', url: f.inventoryUrl,
      headers: { cookie: f.headers.cookie, 'if-match': '"0"', 'idempotency-key': randomUUID() }, payload: { on_hand_delta: 1, reason: 'Restock' } });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('serializes concurrent stock edits and records exactly one movement plus audit', async () => {
    const f = await fixture();
    const responses = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: f.inventoryUrl,
      headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': randomUUID() }, payload: { on_hand_delta: -2, reason: 'Count correction' } })));
    expect(responses.map(response => response.statusCode).sort(), responses.map(response => response.body).join('\n')).toEqual([200, 412]);
    const [balance] = await database.db.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, f.sku.id));
    expect(balance).toMatchObject({ onHand: 8, reserved: 7, rowVersion: 1 });
    const movements = await database.db.select().from(inventoryMovements).where(eq(inventoryMovements.inventoryId, balance!.id));
    expect(movements).toHaveLength(1);
    const audits = await database.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, balance!.id), eq(auditLogs.action, 'ADJUST_STOCK')));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.reason).toBe('Count correction');
  });

  it('replays concurrent identical keys, rejects changed payload, and rechecks revoked access', async () => {
    const f = await fixture();
    const key = randomUUID();
    const mutation = { method: 'POST' as const, url: f.inventoryUrl, headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': key },
      payload: { on_hand_delta: 5, reason: 'Restock verified' } };
    const [first, second] = await Promise.all([app.inject(mutation), app.inject(mutation)]);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(first.json()).toEqual(second.json());
    expect(first.json()).toMatchObject({ on_hand: 15, reserved: 7, row_version: 1 });
    const changed = await app.inject({ ...mutation, payload: { ...mutation.payload, on_hand_delta: 6 } });
    expect(changed.statusCode, changed.body).toBe(409);
    await database.db.update(storeMembers).set({ revokedAt: new Date() }).where(and(eq(storeMembers.storeId, f.storeId), eq(storeMembers.userId, f.actorId)));
    const revoked = await app.inject(mutation);
    expect(revoked.statusCode).toBe(403);
  });

  it('rolls back stock and idempotency when the permanent movement reference conflicts', async () => {
    const f = await fixture();
    const [balance] = await database.db.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, f.sku.id));
    const key = randomUUID();
    const eventKey = `stock-adjustment:${createHash('sha256').update(JSON.stringify([f.actorId, f.storeId, f.sku.id, key])).digest('hex')}`;
    await database.db.insert(inventoryMovements).values({ inventoryId: balance!.id, actorId: f.actorId,
      onHandDelta: 1, reservedDelta: 0, reason: 'ADJUST', eventKey });
    const response = await app.inject({ method: 'POST', url: f.inventoryUrl,
      headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': key }, payload: { on_hand_delta: 2, reason: 'Count adjustment' } });
    expect(response.statusCode, response.body).toBe(409);
    const [after] = await database.db.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, f.sku.id));
    expect(after).toMatchObject({ onHand: 10, reserved: 7, rowVersion: 0 });
    const replayRows = await database.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.actorId, f.actorId), eq(idempotencyKeys.key, key)));
    expect(replayRows).toHaveLength(0);
  });

  it('serves only active public products and live stock while enforcing publish preconditions', async () => {
    const f = await fixture();
    const hidden = await app.inject(`/api/v1/products/${f.product.id}`);
    expect(hidden.statusCode).toBe(404);
    const publish = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${f.storeId}/products/${f.product.id}/publish`,
      headers: { ...f.headers, 'if-match': '"1"', 'idempotency-key': randomUUID() } });
    expect(publish.statusCode, publish.body).toBe(422);
    await database.db.update(products).set({ status: 'ACTIVE' }).where(eq(products.id, f.product.id));
    const visible = await app.inject(`/api/v1/products/${f.product.id}`);
    expect(visible.statusCode, visible.body).toBe(200);
    expect(visible.json().skus[0].available_quantity).toBe(3);
    const search = await app.inject(`/api/v1/products?store_id=${f.storeId}&sort=price_asc&limit=1`);
    expect(search.statusCode, search.body).toBe(200);
    expect(search.json().items.map((item: { id: string }) => item.id)).toEqual([f.product.id]);
    await database.db.update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, f.storeId));
    expect((await app.inject(`/api/v1/products/${f.product.id}`)).statusCode).toBe(404);
  });

  it('returns the complete storefront snapshot needed by the multi-vendor cart UI', async () => {
    const f = await fixture();
    await database.db.update(products).set({ status: 'ACTIVE' }).where(eq(products.id, f.product.id));
    const empty = await app.inject({ method: 'GET', url: `/api/v1/buyer-accounts/${f.buyerAccountId}/cart`, headers: f.headers });
    expect(empty.statusCode, empty.body).toBe(200);
    const added = await app.inject({ method: 'POST', url: `/api/v1/buyer-accounts/${f.buyerAccountId}/cart/items`,
      headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': randomUUID() }, payload: { sku_id: f.sku.id, quantity: 2 } });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json().items[0]).toMatchObject({ product_id: f.product.id, product_name: 'Notebook example',
      sku_code: f.sku.sku_code, available_quantity: 3, product_status: 'ACTIVE', sku_status: 'ACTIVE',
      store_name: 'Store A', image_url: null, quantity: 2, unit_price_gross: 15000 });
    expect(added.json()).not.toHaveProperty('items.0.createdAt');
    expect(added.json().items[0].created_at).toBeTypeOf('string');
  });

  it('preserves product snapshots through the buyer RFQ offer and cart handoff', async () => {
    const f = await fixture();
    await database.db.update(products).set({ status: 'ACTIVE' }).where(eq(products.id, f.product.id));
    const addressId = randomUUID();
    await database.db.insert(addresses).values({ id: addressId, buyerAccountId: f.buyerAccountId, label: 'Kantor',
      recipientName: 'Frontend Buyer', phone: '081234567890', street: 'Jl. Integrasi', province: 'DKI Jakarta',
      city: 'Jakarta', district: 'Menteng', postalCode: '10310', areaId: 'IDNP6IDNC148IDND1184' });
    const created = await app.inject({ method: 'POST', url: `/api/v1/buyer-accounts/${f.buyerAccountId}/quote-requests`,
      headers: { ...f.headers, 'idempotency-key': randomUUID() },
      payload: { store_id: f.storeId, address_id: addressId, notes: 'Harga untuk pembelian rutin', items: [{ sku_id: f.sku.id, quantity: 2 }] } });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().items[0]).toMatchObject({ sku_id: f.sku.id, quantity: 2,
      product_name: 'Notebook example', sku_code: f.sku.sku_code });

    const offered = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${f.storeId}/quote-requests/${created.json().id}/offers`,
      headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': randomUUID() },
      payload: { expires_at: new Date(Date.now() + 86_400_000).toISOString(), items: [{ sku_id: f.sku.id, quantity: 2, unit_price_gross: 12_500 }] } });
    expect(offered.statusCode, offered.body).toBe(201);
    expect(offered.json().items[0]).toMatchObject({ sku_id: f.sku.id, quantity: 2, unit_price_gross: 12_500,
      product_name: 'Notebook example', sku_code: f.sku.sku_code });

    const accepted = await app.inject({ method: 'POST', url: `/api/v1/buyer-accounts/${f.buyerAccountId}/quote-versions/${offered.json().id}/accept`,
      headers: { ...f.headers, 'if-match': '"0"', 'idempotency-key': randomUUID() } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const cart = await app.inject({ method: 'GET', url: `/api/v1/buyer-accounts/${f.buyerAccountId}/cart`, headers: f.headers });
    expect(cart.statusCode, cart.body).toBe(200);
    expect(cart.json().items[0]).toMatchObject({ product_name: 'Notebook example', quantity: 2,
      unit_price_gross: 12_500, quote_line_id: offered.json().items[0].id });
  });

  it('continues price and newest keyset cursors without duplication and rejects cross-query reuse', async () => {
    const f = await fixture();
    const second = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${f.storeId}/products`,
      headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { ...f.productBody, slug: `second-${randomUUID()}` } });
    expect(second.statusCode, second.body).toBe(201);
    const secondSku = await app.inject({ method: 'POST', url: `/api/v1/vendor/stores/${f.storeId}/products/${second.json().id}/skus`,
      headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { ...f.skuBody, sku_code: randomUUID(), unit_price_gross: 25000 } });
    expect(secondSku.statusCode, secondSku.body).toBe(201);
    await database.db.update(products).set({ status: 'ACTIVE' }).where(eq(products.storeId, f.storeId));
    for (const sort of ['price_asc', 'price_desc', 'newest']) {
      const url = `/api/v1/products?store_id=${f.storeId}&sort=${sort}&limit=1`;
      const firstPage = await app.inject(url);
      expect(firstPage.statusCode, firstPage.body).toBe(200);
      expect(firstPage.json().next_cursor).toBeTypeOf('string');
      const secondPage = await app.inject(`${url}&cursor=${firstPage.json().next_cursor}`);
      expect(secondPage.statusCode, secondPage.body).toBe(200);
      expect(secondPage.json().items).toHaveLength(1);
      expect(secondPage.json().next_cursor).toBeNull();
      expect(secondPage.json().items[0].id).not.toBe(firstPage.json().items[0].id);
      if (sort === 'price_asc') expect(firstPage.json().items[0].id).toBe(f.product.id);
      if (sort === 'price_desc') expect(firstPage.json().items[0].id).toBe(second.json().id);
      const wrongScope = await app.inject(`${url}&min_price=100&cursor=${firstPage.json().next_cursor}`);
      expect(wrongScope.statusCode).toBe(400);
    }
    const relevance = await app.inject(`/api/v1/products?store_id=${f.storeId}&q=Notebook&sort=relevance`);
    expect(relevance.statusCode, relevance.body).toBe(200);
    expect(relevance.json().items).toHaveLength(2);
    const relevanceWithoutKeyword = await app.inject(`/api/v1/products?store_id=${f.storeId}&sort=relevance`);
    expect(relevanceWithoutKeyword.statusCode, relevanceWithoutKeyword.body).toBe(200);
    expect(relevanceWithoutKeyword.json().items).toHaveLength(2);
  });

  it('updates and removes product image metadata with optimistic concurrency', async () => {
    const f = await fixture();
    const mediaId = randomUUID();
    await database.db.insert(productMedia).values({ id: mediaId, productId: f.product.id, objectKey: 'fixtures/product.webp', altText: 'Foto lama', sortOrder: 0 });
    const updated = await app.inject({
      method: 'PATCH', url: `/api/v1/vendor/stores/${f.storeId}/products/${f.product.id}/media/${mediaId}`,
      headers: { ...f.headers, 'if-match': '"0"' }, payload: { alt_text: 'Foto produk terbaru' },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.headers.etag).toBe('"1"');
    expect(updated.json()).toMatchObject({ id: mediaId, row_version: 1, alt_text: 'Foto produk terbaru' });
    const stale = await app.inject({
      method: 'PATCH', url: `/api/v1/vendor/stores/${f.storeId}/products/${f.product.id}/media/${mediaId}`,
      headers: { ...f.headers, 'if-match': '"0"' }, payload: { alt_text: 'Versi stale' },
    });
    expect(stale.statusCode).toBe(412);
    const removed = await app.inject({
      method: 'DELETE', url: `/api/v1/vendor/stores/${f.storeId}/products/${f.product.id}/media/${mediaId}`,
      headers: { ...f.headers, 'if-match': '"1"' },
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await database.db.select().from(productMedia).where(eq(productMedia.id, mediaId))).toHaveLength(0);
  });
});
