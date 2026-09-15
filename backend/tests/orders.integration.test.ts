import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/index.js';
import * as t from '../src/database/schema.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { AppError } from '../src/shared/errors.js';
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js';
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js';
import { registerOrders } from '../src/modules/orders/index.js';
import { registerCases } from '../src/modules/cases/index.js';
import { ensureAccount, postJournalInTransaction } from '../src/modules/ledger/service.js';
import { deferredCommission } from '../src/modules/orders/service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('order/case transitions and read-model isolation', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const sessions = new Map<string, string>();
  const passwordHash = 'order-integration-hash';
  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Use dedicated _test database.');
    database = createDatabase({ databaseUrl });
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.decorate('services', { db: database.db,
      config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'orders-test-at-least-thirty-two-characters' }),
      redis: { get: async (key: string) => sessions.get(key) ?? null, del: async (key: string) => sessions.delete(key) ? 1 : 0 },
    } as unknown as Services);
    app.setErrorHandler((error, _request, reply) => {
      const err = error as Error & { validation?: unknown; cause?: { code?: string } };
      reply.code(error instanceof AppError ? error.statusCode : err.validation ? 400 : err.cause?.code === 'ER_DUP_ENTRY' ? 409 : 500)
        .send({ error: error instanceof Error ? error.message : 'unknown' });
    });
    await app.register(cookie);
    registerSessionHooks(app);
    app.addHook('preValidation', async request => { if (request.method === 'POST') requireCsrf(request); });
    await app.register(async api => { await registerOrders(api); await registerCases(api); }, { prefix: '/api/v1' });
    await app.ready();
  }, 30_000);
  afterAll(async () => { if (app) await app.close(); if (database) await database.close(); });

  function auth(userId: string) {
    const token = randomToken(), csrfToken = randomToken();
    sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({ userId, passwordVersion: tokenHash(passwordHash),
      csrfToken, expiresAt: Date.now() + 300_000 }));
    return { cookie: `marketplace_session=${token}`, 'x-csrf-token': csrfToken };
  }

  async function fixture(funds: 'unknown' | 'available' | 'future' = 'unknown') {
    const id = { buyer: randomUUID(), vendor: randomUUID(), admin: randomUUID(), outsider: randomUUID(), account: randomUUID(), otherAccount: randomUUID(),
      legal: randomUUID(), store: randomUUID(), category: randomUUID(), tax: randomUUID(), product: randomUUID(), sku: randomUUID(),
      provider: randomUUID(), shippingProvider: randomUUID(), quote: randomUUID(), group: randomUUID(), order: randomUUID(), item: randomUUID(),
      attempt: randomUUID(), receipt: randomUUID(), shipment: randomUUID(), payable: randomUUID() };
    const now = new Date(), future = new Date(Date.now() + 3_600_000), past = new Date(Date.now() - 60_000);
    await database.db.transaction(async tx => {
      await tx.insert(t.users).values([id.buyer, id.vendor, id.admin, id.outsider].map(user => ({ id: user, name: user, emailNormalized: `${user}@orders.test`, passwordHash })));
      await tx.insert(t.adminGrants).values({ userId: id.admin, roleCode: 'OPERATIONS' });
      await tx.insert(t.buyerAccounts).values([{ id: id.account, managerUserId: id.buyer, kind: 'INDIVIDUAL' }, { id: id.otherAccount, managerUserId: id.outsider, kind: 'INDIVIDUAL' }]);
      await tx.insert(t.legalEntities).values({ id: id.legal, createdBy: id.vendor, kind: 'INDIVIDUAL', legalName: 'Vendor legal' });
      await tx.insert(t.stores).values({ id: id.store, legalEntityId: id.legal, name: 'Vendor Store', slug: id.store, contactPhone: '081234567890', status: 'ACTIVE' });
      await tx.insert(t.storeMembers).values({ userId: id.vendor, storeId: id.store, roleCode: 'OWNER' });
      await tx.insert(t.categories).values({ id: id.category, name: 'Category', slug: id.category });
      await tx.insert(t.taxClasses).values({ id: id.tax, code: id.tax, name: 'Tax class', status: 'ACTIVE' });
      await tx.insert(t.products).values({ id: id.product, storeId: id.store, categoryId: id.category, taxClassId: id.tax, name: 'Pencil', description: 'Pencil', slug: id.product });
      await tx.insert(t.skus).values({ id: id.sku, productId: id.product, storeId: id.store, skuCode: id.sku, unitLabel: 'pcs', unitPriceGross: 10000,
        weightG: 100, lengthCm: '10.00', widthCm: '5.00', heightCm: '2.00' });
      await tx.insert(t.providerAccounts).values([
        { id: id.provider, provider: 'MIDTRANS', environment: 'SANDBOX', merchantReference: id.provider, secretReference: 'unused-test-reference', capabilities: {} },
        { id: id.shippingProvider, provider: 'BITESHIP', environment: 'SANDBOX', merchantReference: id.shippingProvider, secretReference: 'unused-test-reference', capabilities: {} },
      ]);
      const recipient = { label: 'Home', recipient_name: 'Buyer', phone: '081234567891', street: 'Jl. Test', province: 'Jakarta', city: 'Jakarta', district: 'Test', postal_code: '12345' };
      await tx.insert(t.shippingQuotes).values({ id: id.quote, buyerAccountId: id.account, storeId: id.store, providerAccountId: id.shippingProvider,
        inputHash: '0'.repeat(64), courierCode: 'jne', serviceCode: 'reg', finalAmount: 1000,
        originSnapshot: {}, destinationSnapshot: recipient, packageSnapshot: {}, priceBreakdown: {}, fetchedAt: now, validUntil: future });
      await tx.insert(t.checkoutGroups).values({ id: id.group, buyerAccountId: id.account, createdBy: id.buyer, orderNumber: id.group,
        recipientSnapshot: recipient, itemsGross: 10000, shippingTotal: 1000, buyerFeeTotal: 0, platformDiscount: 0, grandTotal: 11000,
        orderState: 'ACTIVE', reservationExpiresAt: future, pricingSnapshot: {} });
      await tx.insert(t.vendorOrders).values({ id: id.order, checkoutGroupId: id.group, storeId: id.store, shippingQuoteId: id.quote, orderNumber: id.order,
        itemsNet: 10000, itemsVat: 0, itemsGross: 10000, shippingAmount: 1000, buyerFee: 0, platformDiscount: 0, buyerTotal: 11000,
        fulfillmentStatus: 'DELIVERED', commissionAmount: 200, commissionVat: 0, sellerWithholding: 0, sellerTaxSnapshot: {}, originSnapshot: {}, disputeDeadline: future });
      await tx.insert(t.orderItems).values({ id: id.item, vendorOrderId: id.order, storeId: id.store, skuId: id.sku, quantity: 1,
        unitPriceGross: 10000, lineNet: 10000, lineVat: 0, lineGross: 10000, vendorDiscount: 0,
        commissionAmount: 200, commissionVat: 0, sellerWithholding: 0, productSnapshot: { name: 'Snapshot pencil', sku_code: 'PENCIL-001' }, taxSnapshot: {}, feeSnapshot: {} });
      await tx.insert(t.paymentAttempts).values({ id: id.attempt, checkoutGroupId: id.group, providerAccountId: id.provider,
        providerOrderId: id.attempt, expectedAmount: 11000, state: 'TERMINAL', terminalVerifiedAt: now });
      await tx.insert(t.paymentReceipts).values({ id: id.receipt, paymentAttemptId: id.attempt, checkoutGroupId: id.group, providerAccountId: id.provider,
        providerTransactionId: id.receipt, amount: 11000, receivedAt: now, applicationStatus: 'APPLIED',
        providerFundsAvailableAt: funds === 'unknown' ? null : funds === 'available' ? past : future });
      await tx.insert(t.shipments).values({ id: id.shipment, vendorOrderId: id.order, providerAccountId: id.shippingProvider, bookingReference: id.shipment,
        state: 'DELIVERED', courierCode: 'jne', serviceCode: 'reg', packageSnapshot: {}, quotedAmount: 1000, actualAmount: 1000, deliveredAt: now });
      await tx.insert(t.vendorPayables).values({ id: id.payable, vendorOrderId: id.order, accruedAmount: 9800, eligibility: 'BLOCKED' });
      const clearing = await ensureAccount(tx, 'PROVIDER_CLEARING', 'ASSET');
      const deferred = await ensureAccount(tx, 'DEFERRED_COMMISSION', 'LIABILITY');
      const payable = await ensureAccount(tx, `VENDOR_PAYABLE:${id.store}`, 'LIABILITY', id.store);
      const shipping = await ensureAccount(tx, 'SHIPPING_PAYABLE', 'LIABILITY');
      await postJournalInTransaction(tx, { eventKey: `test-order-payment:${id.receipt}`, description: 'Test settled payment', paymentReceiptId: id.receipt,
        lines: [{ accountId: clearing, debit: 11000n, credit: 0n }, { accountId: deferred, vendorOrderId: id.order, debit: 0n, credit: 200n },
          { accountId: payable, vendorOrderId: id.order, debit: 0n, credit: 9800n }, { accountId: shipping, vendorOrderId: id.order, debit: 0n, credit: 1000n }] });
    });
    return { id, buyer: auth(id.buyer), vendor: auth(id.vendor), admin: auth(id.admin), outsider: auth(id.outsider) };
  }

  it('keeps buyer summaries free of vendor finance and enforces nested order/shipment tenant access', async () => {
    const f = await fixture();
    const own = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.account}/orders/${f.id.group}`, headers: f.buyer });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ payment_status: 'PAID', recipient: { recipient_name: 'Buyer', city: 'Jakarta' },
      totals: { grand_total: 11000, items_net: 10000, items_vat: 0 } });
    expect(own.json().vendor_orders[0]).not.toHaveProperty('commission_amount');
    expect(own.json().vendor_orders[0].items[0].product_name).toBe('Snapshot pencil');
    const vendor = await app.inject({ url: `/api/v1/vendor/stores/${f.id.store}/orders/${f.id.order}`, headers: f.vendor });
    expect(vendor.statusCode, vendor.body).toBe(200);
    expect(vendor.json()).toMatchObject({ payable_amount: 9800, commission_amount: 200, recipient: { recipient_name: 'Buyer' } });
    const otherOrder = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.otherAccount}/orders/${f.id.group}`, headers: f.outsider });
    expect(otherOrder.statusCode).toBe(404);
    const otherShipment = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.otherAccount}/shipments/${f.id.shipment}`, headers: f.outsider });
    expect(otherShipment.statusCode).toBe(404);
  });

  it('blocks completion during a dispute, resolves it with audit, then recognizes commission once on receipt', async () => {
    const f = await fixture();
    const opened = await app.inject({ method: 'POST', url: `/api/v1/buyer-accounts/${f.id.account}/vendor-orders/${f.id.order}/cases`,
      headers: { ...f.buyer, 'idempotency-key': randomUUID() }, payload: { kind: 'DISPUTE', reason: 'Contents need inspection' } });
    expect(opened.statusCode, opened.body).toBe(201);
    const receiptUrl = `/api/v1/buyer-accounts/${f.id.account}/vendor-orders/${f.id.order}/receive`;
    const blocked = await app.inject({ method: 'POST', url: receiptUrl, headers: { ...f.buyer, 'idempotency-key': randomUUID(), 'if-match': '"1"' } });
    expect(blocked.statusCode, blocked.body).toBe(409);
    const forbiddenCase = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.otherAccount}/cases/${opened.json().id}`, headers: f.outsider });
    expect(forbiddenCase.statusCode).toBe(404);
    const resolution = await app.inject({ method: 'POST', url: `/api/v1/admin/cases/${opened.json().id}/resolve`,
      headers: { ...f.admin, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Inspection confirms contents accepted' } });
    expect(resolution.statusCode, resolution.body).toBe(200);
    const request = { method: 'POST' as const, url: receiptUrl, headers: { ...f.buyer, 'idempotency-key': randomUUID(), 'if-match': '"2"' } };
    const confirmed = await app.inject(request);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().fulfillment_status).toBe('COMPLETED');
    expect(confirmed.json()).not.toHaveProperty('commission_amount');
    const replay = await app.inject(request);
    expect(replay.json()).toEqual(confirmed.json());
    expect(await deferredCommission(database.db, f.id.order)).toBe(0n);
    const journals = await database.db.select().from(t.journalEntries).where(eq(t.journalEntries.eventKey, `commission-recognized:${f.id.order}`));
    expect(journals).toHaveLength(1);
    const [payable] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.id.payable));
    expect(payable?.eligibility).toBe('BLOCKED');
    const audits = await database.db.select().from(t.auditLogs).where(and(eq(t.auditLogs.entityId, f.id.order), eq(t.auditLogs.action, 'COMPLETE')));
    expect(audits).toHaveLength(1);
    expect(await database.db.select().from(t.payouts).where(eq(t.payouts.storeId, f.id.store))).toHaveLength(0);
  });

  it('requires admin dispute deadline expiry and marks funds available only after provider settlement', async () => {
    const f = await fixture('available');
    const url = `/api/v1/admin/vendor-orders/${f.id.order}/complete`;
    const pending = await app.inject({ method: 'POST', url, headers: { ...f.admin, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Delivery inspected' } });
    expect(pending.statusCode, pending.body).toBe(409);
    await database.db.update(t.vendorOrders).set({ disputeDeadline: new Date(Date.now() - 1000) }).where(eq(t.vendorOrders.id, f.id.order));
    const done = await app.inject({ method: 'POST', url, headers: { ...f.admin, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Delivery inspected after complaint deadline' } });
    expect(done.statusCode, done.body).toBe(200);
    const [payable] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.id.payable));
    expect(payable?.eligibility).toBe('ELIGIBLE');
    expect(payable?.eligibleAt).toBeInstanceOf(Date);
  });

  it('keeps future provider funds and pending refunds blocked and scopes refund history to the buyer', async () => {
    const f = await fixture('future');
    const refundId = randomUUID();
    await database.db.insert(t.refunds).values({ id: refundId, paymentReceiptId: f.id.receipt, reference: refundId, amount: 100, state: 'UNKNOWN', reason: 'Refund under reconciliation' });
    await database.db.insert(t.refundLines).values({ refundId, vendorOrderId: f.id.order, orderItemId: f.id.item, component: 'ITEM', amount: 100, quantity: 1,
      taxReversalSnapshot: {}, feeReversalSnapshot: {} });
    const url = `/api/v1/buyer-accounts/${f.id.account}/vendor-orders/${f.id.order}/receive`;
    const blocked = await app.inject({ method: 'POST', url, headers: { ...f.buyer, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(blocked.statusCode, blocked.body).toBe(409);
    const own = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.account}/refunds`, headers: f.buyer });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().items[0]).toMatchObject({ id: refundId, lines: [{ component: 'ITEM', amount: 100 }] });
    const other = await app.inject({ url: `/api/v1/buyer-accounts/${f.id.otherAccount}/refunds`, headers: f.outsider });
    expect(other.json().items).toHaveLength(0);
    await database.db.update(t.refunds).set({ state: 'FAILED' }).where(eq(t.refunds.id, refundId));
    const completed = await app.inject({ method: 'POST', url, headers: { ...f.buyer, 'idempotency-key': randomUUID(), 'if-match': '"0"' } });
    expect(completed.statusCode, completed.body).toBe(200);
    const [payable] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.id.payable));
    expect(payable?.eligibility).toBe('BLOCKED');
  });
});
