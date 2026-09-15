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
import { settlementRoutes, finalizeRefund } from '../src/modules/settlement/index.js';
import { registerSessionHooks, requireCsrf } from '../src/modules/auth/session.js';
import { randomToken, tokenHash } from '../src/modules/auth/tokens.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('refund and payout settlement against InnoDB', () => {
  let database: ReturnType<typeof createDatabase>, app: FastifyInstance;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Dedicated _test database required.');
    database = createDatabase({ databaseUrl });
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.decorate('services', { db: database.db, config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'settlement-test-secret-not-for-production' }),
      redis: { get: async (key: string) => sessions.get(key) ?? null, set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; }, del: async (key: string) => sessions.delete(key) ? 1 : 0 }, checkDatabase: database.ping, close: async () => {},
    } as unknown as Services);
    app.setErrorHandler((error, _request, reply) => {
      const err = error as Error & { validation?: unknown; cause?: { code?: string; message?: string }; code?: string };
      reply.code(error instanceof AppError ? error.statusCode : err.validation ? 400 : (err.cause?.code ?? err.code) === 'ER_DUP_ENTRY' ? 409 : 500).send({ message: err.message, cause: err.cause?.message });
    });
    await app.register(cookie); registerSessionHooks(app);
    app.addHook('preValidation', async request => { if (request.method === 'POST') requireCsrf(request); });
    await app.register(settlementRoutes, { prefix: '/api/v1' }); await app.ready();
  });
  afterAll(async () => { if (app) await app.close(); if (database) await database.close(); });

  async function fixture() {
    const ids = Object.fromEntries(['finance','checker','buyer','legal','store','bank','category','tax','product','sku','shippingProvider','paymentProvider','shipping','group','order','item','attempt','receipt','payable','refundProof','payoutProof'].map(key => [key, randomUUID()])) as Record<string, string>;
    const past = new Date(Date.now() - 86400000), future = new Date(Date.now() + 86400000), hash = 'unusable-settlement-test-password';
    await database.db.transaction(async tx => {
      await tx.insert(t.users).values([ids.finance!, ids.checker!].map(id => ({ id, name: 'Finance Test', emailNormalized: `${id}@example.test`, passwordHash: hash, emailVerifiedAt: past })));
      await tx.insert(t.adminGrants).values([{ userId: ids.finance!, roleCode: 'FINANCE' }, { userId: ids.finance!, roleCode: 'FINANCE_APPROVER' }, { userId: ids.checker!, roleCode: 'FINANCE_APPROVER' }]);
      await tx.insert(t.buyerAccounts).values({ id: ids.buyer!, managerUserId: ids.finance!, kind: 'INDIVIDUAL' });
      await tx.insert(t.legalEntities).values({ id: ids.legal!, createdBy: ids.finance!, kind: 'INDIVIDUAL', legalName: 'Settlement Test', status: 'VERIFIED' });
      await tx.insert(t.stores).values({ id: ids.store!, legalEntityId: ids.legal!, slug: ids.store!, name: 'Settlement Test', contactPhone: '+628000000', status: 'ACTIVE' });
      await tx.insert(t.bankAccounts).values({ id: ids.bank!, legalEntityId: ids.legal!, bankCode: 'TEST', accountName: 'Settlement Test', accountNumberCiphertext: 'encrypted-test-value', accountFingerprint: ids.bank!, status: 'VERIFIED', verifiedBy: ids.checker!, verifiedAt: past });
      await tx.insert(t.categories).values({ id: ids.category!, slug: ids.category!, name: 'Test' });
      await tx.insert(t.taxClasses).values({ id: ids.tax!, code: ids.tax!, name: 'Test', status: 'ACTIVE' });
      await tx.insert(t.products).values({ id: ids.product!, storeId: ids.store!, categoryId: ids.category!, taxClassId: ids.tax!, name: 'Test', description: 'Test', slug: ids.product! });
      await tx.insert(t.skus).values({ id: ids.sku!, productId: ids.product!, storeId: ids.store!, skuCode: ids.sku!, unitLabel: 'pcs', unitPriceGross: 10000, weightG: 1, lengthCm: '1', widthCm: '1', heightCm: '1' });
      await tx.insert(t.providerAccounts).values([
        { id: ids.shippingProvider!, provider: 'BITESHIP', environment: 'SANDBOX', merchantReference: ids.shippingProvider!, secretReference: 'env:TEST', capabilities: {} },
        { id: ids.paymentProvider!, provider: 'MIDTRANS', environment: 'SANDBOX', merchantReference: ids.paymentProvider!, secretReference: 'env:TEST', capabilities: { refund_channels: ['qris'], manual_refund_channels: ['bank_transfer'] } },
      ]);
      await tx.insert(t.shippingQuotes).values({ id: ids.shipping!, buyerAccountId: ids.buyer!, storeId: ids.store!, providerAccountId: ids.shippingProvider!, inputHash: 'a'.repeat(64), courierCode: 'TEST', serviceCode: 'TEST', finalAmount: 1000, originSnapshot: {}, destinationSnapshot: {}, packageSnapshot: {}, priceBreakdown: {}, fetchedAt: past, validUntil: future });
      await tx.insert(t.checkoutGroups).values({ id: ids.group!, buyerAccountId: ids.buyer!, createdBy: ids.finance!, orderNumber: ids.group!, recipientSnapshot: {}, itemsGross: 10000, shippingTotal: 1000, buyerFeeTotal: 0, platformDiscount: 0, grandTotal: 11000, orderState: 'COMPLETED', reservationExpiresAt: past, pricingSnapshot: {} });
      await tx.insert(t.vendorOrders).values({ id: ids.order!, checkoutGroupId: ids.group!, storeId: ids.store!, shippingQuoteId: ids.shipping!, orderNumber: ids.order!, itemsNet: 9000, itemsVat: 1000, itemsGross: 10000, shippingAmount: 1000, buyerFee: 0, platformDiscount: 0, buyerTotal: 11000, fulfillmentStatus: 'COMPLETED', commissionAmount: 200, commissionVat: 22, sellerWithholding: 0, sellerTaxSnapshot: {}, originSnapshot: {}, completedAt: past, disputeDeadline: past });
      await tx.insert(t.orderItems).values({ id: ids.item!, vendorOrderId: ids.order!, storeId: ids.store!, skuId: ids.sku!, quantity: 1, unitPriceGross: 10000, lineNet: 9000, lineVat: 1000, lineGross: 10000, vendorDiscount: 0, commissionAmount: 200, commissionVat: 22, sellerWithholding: 0, productSnapshot: {}, taxSnapshot: {}, feeSnapshot: {} });
      await tx.insert(t.paymentAttempts).values({ id: ids.attempt!, checkoutGroupId: ids.group!, providerAccountId: ids.paymentProvider!, providerOrderId: ids.attempt!, expectedAmount: 11000, currency: 'IDR', channel: 'qris', state: 'TERMINAL', terminalVerifiedAt: past });
      await tx.insert(t.paymentReceipts).values({ id: ids.receipt!, paymentAttemptId: ids.attempt!, checkoutGroupId: ids.group!, providerAccountId: ids.paymentProvider!, providerTransactionId: ids.receipt!, amount: 11000, receivedAt: past, applicationStatus: 'APPLIED', providerFundsAvailableAt: past });
      await tx.insert(t.paymentAllocations).values({ paymentReceiptId: ids.receipt!, checkoutGroupId: ids.group!, vendorOrderId: ids.order!, amount: 11000 });
      await tx.insert(t.vendorPayables).values({ id: ids.payable!, vendorOrderId: ids.order!, accruedAmount: 9778, adjustmentAmount: 0, reservedPayoutAmount: 0, paidAmount: 0, eligibility: 'ELIGIBLE', eligibleAt: past });
      await tx.insert(t.documents).values([
        { id: ids.refundProof!, legalEntityId: ids.legal!, vendorOrderId: ids.order!, uploadedBy: ids.finance!, documentType: 'REFUND_PROOF', objectKey: `test/${ids.refundProof}`, sha256: 'a'.repeat(64), mimeType: 'application/pdf', verificationStatus: 'VERIFIED', verifiedBy: ids.checker!, metadata: {} },
        { id: ids.payoutProof!, legalEntityId: ids.legal!, uploadedBy: ids.finance!, documentType: 'PAYOUT_PROOF', objectKey: `test/${ids.payoutProof}`, sha256: 'b'.repeat(64), mimeType: 'application/pdf', verificationStatus: 'VERIFIED', verifiedBy: ids.checker!, metadata: {} },
      ]);
    });
    const headers = (userId: string) => {
      const token = randomToken(), csrfToken = randomToken();
      sessions.set(`marketplace:session:${tokenHash(token)}`, JSON.stringify({ userId, passwordVersion: tokenHash(hash), csrfToken, expiresAt: Date.now() + 3600000, mfaVerifiedAt: Date.now() }));
      return { cookie: `marketplace_session=${token}`, 'x-csrf-token': csrfToken };
    };
    return { ids, finance: headers(ids.finance!), checker: headers(ids.checker!) };
  }

  it('serializes concurrent refund requests and preserves UNKNOWN capacity', async () => {
    const f = await fixture();
    const request = () => app.inject({ method: 'POST', url: '/api/v1/admin/refunds', headers: { ...f.finance, 'idempotency-key': randomUUID() }, payload: { payment_receipt_id: f.ids.receipt, reason: 'Partial refund request', lines: [{ vendor_order_id: f.ids.order, order_item_id: f.ids.item, component: 'ITEM', amount: 7000 }] } });
    const results = await Promise.all([request(), request()]);
    expect(results.map(result => result.statusCode).sort(), results.map(result => result.body).join('\n')).toEqual([201, 409]);
    const refund = results.find(result => result.statusCode === 201)!.json();
    const approved = await app.inject({ method: 'POST', url: `/api/v1/admin/refunds/${refund.id}/approve`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Approve verified refund' } });
    expect(approved.statusCode, approved.body).toBe(202);
    await database.db.transaction(tx => finalizeRefund(tx, refund.id, 'UNKNOWN', { channel: 'API', requestId: randomUUID(), reason: 'Provider status remains ambiguous' }));
    const blocked = await request(); expect(blocked.statusCode, blocked.body).toBe(409);
    const manual = await app.inject({ method: 'POST', url: `/api/v1/admin/refunds/${refund.id}/manual-result`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"2"' }, payload: { state: 'SUCCEEDED', proof_document_id: f.ids.refundProof, external_reference: randomUUID(), reason: 'Attempt manual override' } });
    expect(manual.statusCode, manual.body).toBe(409);
    await database.db.transaction(tx => finalizeRefund(tx, refund.id, 'SUCCEEDED', { channel: 'API', providerRefundId: `provider-${refund.id}`, requestId: randomUUID(), reason: 'Provider refund verified' }));
    const [payable] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.ids.payable!));
    expect(payable!.adjustmentAmount).toBe(-6845);
    const journals = await database.db.select().from(t.journalEntries).where(eq(t.journalEntries.refundId, refund.id));
    expect(journals).toHaveLength(1); expect(journals[0]!.status).toBe('POSTED');
    await database.db.transaction(tx => finalizeRefund(tx, refund.id, 'SUCCEEDED', { channel: 'API', providerRefundId: `provider-${refund.id}`, requestId: randomUUID(), reason: 'Repeated provider callback' }));
    expect(await database.db.select().from(t.journalEntries).where(eq(t.journalEntries.refundId, refund.id))).toHaveLength(1);
  });

  it('reserves payout funds, requires a second approver, retains UNKNOWN and posts a verified payment once', async () => {
    const f = await fixture(), key = randomUUID();
    const request = { method: 'POST' as const, url: '/api/v1/admin/payouts', headers: { ...f.finance, 'idempotency-key': key }, payload: { store_id: f.ids.store, bank_account_id: f.ids.bank, lines: [{ vendor_payable_id: f.ids.payable, amount: 5000 }] } };
    const created = await app.inject(request); expect(created.statusCode, created.body).toBe(201);
    const payout = created.json(), base = `/api/v1/admin/payouts/${payout.id}`;
    const retry = await app.inject(request); expect(retry.statusCode, retry.body).toBe(201); expect(retry.json().id).toBe(payout.id);
    const self = await app.inject({ method: 'POST', url: `${base}/approve`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Self approval attempt' } });
    expect(self.statusCode, self.body).toBe(403);
    const approve = await app.inject({ method: 'POST', url: `${base}/approve`, headers: { ...f.checker, 'idempotency-key': randomUUID(), 'if-match': '"0"' }, payload: { reason: 'Second checker verified account' } });
    expect(approve.statusCode, approve.body).toBe(200);
    const started = await app.inject({ method: 'POST', url: `${base}/start`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"1"' }, payload: { reason: 'No previous transfer found' } });
    expect(started.statusCode, started.body).toBe(200);
    const unknown = await app.inject({ method: 'POST', url: `${base}/result`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"2"' }, payload: { state: 'UNKNOWN', reason: 'Bank response uncertain' } });
    expect(unknown.statusCode, unknown.body).toBe(200);
    const [reserved] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.ids.payable!));
    expect(reserved!.reservedPayoutAmount).toBe(5000); expect(reserved!.paidAmount).toBe(0);
    const missingProof = await app.inject({ method: 'POST', url: `${base}/result`, headers: { ...f.finance, 'idempotency-key': randomUUID(), 'if-match': '"3"' }, payload: { state: 'FAILED', reason: 'Timeout is not confirmed failure' } });
    expect(missingProof.statusCode, missingProof.body).toBe(422);
    const paidKey = randomUUID();
    const paidRequest = { method: 'POST' as const, url: `${base}/result`, headers: { ...f.finance, 'idempotency-key': paidKey, 'if-match': '"3"' }, payload: { state: 'PAID', proof_document_id: f.ids.payoutProof, transfer_reference: randomUUID(), reason: 'Bank evidence independently verified' } };
    const paid = await app.inject(paidRequest); expect(paid.statusCode, paid.body).toBe(200);
    expect((await app.inject(paidRequest)).statusCode).toBe(200);
    const [completed] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.id, f.ids.payable!));
    expect(completed).toMatchObject({ reservedPayoutAmount: 0, paidAmount: 5000 });
    const journals = await database.db.select().from(t.journalEntries).where(eq(t.journalEntries.payoutId, payout.id)); expect(journals).toHaveLength(1);
    const audit = await app.inject({ method: 'GET', url: '/api/v1/admin/audit-logs', headers: f.finance });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json().items.every((row: any) => row.row_version === 0)).toBe(true);
  });

  it('blocks payout when any refund is pending and rejects cross-order refund lines', async () => {
    const f = await fixture(), other = await fixture();
    const mismatch = await app.inject({ method: 'POST', url: '/api/v1/admin/refunds', headers: { ...f.finance, 'idempotency-key': randomUUID() }, payload: { payment_receipt_id: f.ids.receipt, reason: 'Wrong order test', lines: [{ component: 'ITEM', vendor_order_id: other.ids.order, order_item_id: other.ids.item, amount: 100 }] } });
    expect(mismatch.statusCode, mismatch.body).toBe(404);
    const refund = await app.inject({ method: 'POST', url: '/api/v1/admin/refunds', headers: { ...f.finance, 'idempotency-key': randomUUID() }, payload: { payment_receipt_id: f.ids.receipt, reason: 'Refund blocks payout', lines: [{ component: 'ITEM', vendor_order_id: f.ids.order, order_item_id: f.ids.item, amount: 100 }] } });
    expect(refund.statusCode, refund.body).toBe(201);
    const payout = await app.inject({ method: 'POST', url: '/api/v1/admin/payouts', headers: { ...f.finance, 'idempotency-key': randomUUID() }, payload: { store_id: f.ids.store, bank_account_id: f.ids.bank, lines: [{ vendor_payable_id: f.ids.payable, amount: 1000 }] } });
    expect(payout.statusCode, payout.body).toBe(409);
    const stored = await database.db.select().from(t.refunds).where(and(eq(t.refunds.paymentReceiptId, f.ids.receipt!), eq(t.refunds.state, 'REQUESTED'))); expect(stored).toHaveLength(1);
  });
});
