import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import * as t from '../../database/schema.js';
import { providerAccount } from '../../integrations/providers.js';
import { encryptSensitive } from '../../shared/crypto.js';
import { routeSchema } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { one, operation, present, version } from '../../shared/operations.js';
import { paymentMethodLimits, rupiah, validSignature } from './policy.js';
import { enqueuePayment, paymentAttemptDetail } from './service.js';

function availableMethods(account: typeof t.providerAccounts.$inferSelect, amount: number) {
  const capabilities = account.capabilities as Record<string, unknown>;
  const methods = paymentMethodLimits(capabilities, Array.isArray(capabilities.channels) ? capabilities.channels as string[] : []);
  return methods.filter(method => amount >= method.minimum_amount && amount <= method.maximum_amount);
}

export async function paymentsRoutes(app: FastifyInstance) {
  operation(app, 'listPaymentMethods', async ctx => {
    const group = await one(ctx.db, t.checkoutGroups, ctx.params.orderGroupId, eq(t.checkoutGroups.buyerAccountId, ctx.params.buyerAccountId));
    if (group.orderState !== 'AWAITING_PAYMENT' || group.reservationExpiresAt <= new Date()) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'Pesanan tidak dapat dibuatkan pembayaran.');
    const account = await providerAccount(ctx.db, app.services.config, 'MIDTRANS');
    return { items: availableMethods(account, group.grandTotal), next_cursor: null };
  });

  operation(app, 'createPaymentSession', async ctx => {
    const group = await one(ctx.db, t.checkoutGroups, ctx.params.orderGroupId,
      eq(t.checkoutGroups.buyerAccountId, ctx.params.buyerAccountId), true);
    if (group.orderState !== 'AWAITING_PAYMENT' || group.reservationExpiresAt.getTime() - Date.now() < 300_000) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'Waktu reservasi pesanan tidak cukup untuk sesi pembayaran.');
    const account = await providerAccount(ctx.db, app.services.config, 'MIDTRANS');
    const methods = availableMethods(account, group.grandTotal);
    if (!methods.length) throw new AppError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Tidak ada metode pembayaran aktif untuk nominal ini.');
    const channel = ctx.body.channel ?? null;
    if (channel && !methods.some(method => method.code === channel)) throw new AppError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Metode pembayaran tidak aktif untuk nominal ini.');
    const [existing] = await ctx.db.select().from(t.paymentAttempts).where(and(eq(t.paymentAttempts.checkoutGroupId, group.id), isNull(t.paymentAttempts.terminalVerifiedAt))).limit(1).for('update');
    if (existing) {
      const [event] = await ctx.db.select().from(t.outboxEvents).where(eq(t.outboxEvents.eventKey, `payment-create:${existing.id}`)).limit(1);
      if (!event) throw new AppError(409, 'PAYMENT_REVIEW_REQUIRED', 'Upaya pembayaran belum terminal dan memerlukan rekonsiliasi.');
      return { id: event.id, state: event.state === 'DONE' ? 'SUCCEEDED' : event.state === 'DEAD' ? 'FAILED' : 'QUEUED', status_url: `/api/v1/operations/${event.id}`, result_type: 'payment_attempt', result_id: existing.id };
    }
    const id = randomUUID();
    await ctx.db.insert(t.paymentAttempts).values({ id, checkoutGroupId: group.id, providerAccountId: account.id,
      providerOrderId: `payment-${id}`, expectedAmount: group.grandTotal, channel, state: 'CREATING', expiresAt: group.reservationExpiresAt });
    return enqueuePayment(ctx.db, 'PAYMENT_CREATE', id,
      { paymentAttemptId: id, userId: ctx.user.id, requestId: ctx.request.id }, `payment-create:${id}`);
  });

  operation(app, 'getPaymentAttempt', ctx => paymentAttemptDetail(ctx.db, ctx.params.paymentAttemptId,
    ctx.params.buyerAccountId, app.services.config.dataEncryptionKey));

  operation(app, 'cancelPaymentAttempt', async ctx => {
    const attempt = await one(ctx.db, t.paymentAttempts, ctx.params.paymentAttemptId, undefined, true);
    await one(ctx.db, t.checkoutGroups, attempt.checkoutGroupId, eq(t.checkoutGroups.buyerAccountId, ctx.params.buyerAccountId), true);
    version(ctx.request, attempt);
    if (attempt.terminalVerifiedAt) throw new AppError(409, 'PAYMENT_ALREADY_TERMINAL', 'Upaya pembayaran sudah terminal.');
    await ctx.db.update(t.paymentAttempts).set({ state: 'CANCEL_REQUESTED', rowVersion: attempt.rowVersion + 1 }).where(eq(t.paymentAttempts.id, attempt.id));
    return enqueuePayment(ctx.db, 'PAYMENT_CANCEL', attempt.id,
      { paymentAttemptId: attempt.id, userId: ctx.user.id, requestId: ctx.request.id },
      `payment-cancel:${attempt.id}:${ctx.request.headers['idempotency-key']}`);
  });

  operation(app, 'cancelOrderGroup', async ctx => {
    const group = await one(ctx.db, t.checkoutGroups, ctx.params.orderGroupId,
      eq(t.checkoutGroups.buyerAccountId, ctx.params.buyerAccountId), true);
    version(ctx.request, group);
    if (group.orderState !== 'AWAITING_PAYMENT') throw new AppError(409, 'ORDER_NOT_CANCELLABLE', 'Hanya pesanan yang belum dibayar dapat dibatalkan.');
    await ctx.db.update(t.checkoutGroups).set({ orderState: 'CANCEL_REQUESTED', rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
    const [attempt] = await ctx.db.select().from(t.paymentAttempts).where(and(eq(t.paymentAttempts.checkoutGroupId, group.id), isNull(t.paymentAttempts.terminalVerifiedAt))).limit(1).for('update');
    if (attempt) {
      await ctx.db.update(t.paymentAttempts).set({ state: 'CANCEL_REQUESTED', rowVersion: attempt.rowVersion + 1 }).where(eq(t.paymentAttempts.id, attempt.id));
      return enqueuePayment(ctx.db, 'PAYMENT_CANCEL', attempt.id,
        { paymentAttemptId: attempt.id, orderGroupId: group.id, userId: ctx.user.id, requestId: ctx.request.id },
        `order-cancel:${group.id}`);
    }
    return enqueuePayment(ctx.db, 'ORDER_EXPIRE', group.id,
      { orderGroupId: group.id, userId: ctx.user.id, requestId: ctx.request.id }, `order-cancel:${group.id}`);
  });

  operation(app, 'reconcilePayment', async ctx => {
    const attempt = await one(ctx.db, t.paymentAttempts, ctx.params.paymentAttemptId, undefined, true);
    return enqueuePayment(ctx.db, 'PAYMENT_RECONCILE', attempt.id,
      { paymentAttemptId: attempt.id, userId: ctx.user.id, requestId: ctx.request.id },
      `payment-reconcile:${attempt.id}:${ctx.request.headers['idempotency-key']}`);
  });

  operation(app, 'startReconciliation', async ctx => {
    const start = new Date(ctx.body.period_start), end = new Date(ctx.body.period_end);
    if (end <= start || end.getTime() - start.getTime() > 31 * 86_400_000) throw new AppError(422, 'INVALID_RECONCILIATION_PERIOD', 'Periode harus positif dan maksimal 31 hari.');
    const account = await one(ctx.db, t.providerAccounts, ctx.body.provider_account_id, eq(t.providerAccounts.status, 'ACTIVE'));
    if (account.provider !== 'MIDTRANS' || account.environment !== app.services.config.providerEnvironment) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Rekonsiliasi hanya memakai akun Midtrans aktif pada environment ini.');
    if (ctx.body.source_document_id) {
      const document = await one(ctx.db, t.documents, ctx.body.source_document_id);
      if (document.verificationStatus !== 'VERIFIED') throw new AppError(422, 'SOURCE_DOCUMENT_UNVERIFIED', 'Dokumen sumber harus terverifikasi.');
    }
    const id = randomUUID();
    await ctx.db.insert(t.reconciliationRuns).values({ id, providerAccountId: account.id, periodStart: start, periodEnd: end,
      sourceDocumentId: ctx.body.source_document_id ?? null, state: 'RUNNING' });
    return enqueuePayment(ctx.db, 'RECONCILIATION_RUN', id,
      { reconciliationId: id, userId: ctx.user.id, requestId: ctx.request.id }, `reconciliation:${id}`);
  });

  operation(app, 'getReconciliation', async ctx => {
    const run = await one(ctx.db, t.reconciliationRuns, ctx.params.reconciliationId);
    const items = await ctx.db.select().from(t.reconciliationItems).where(eq(t.reconciliationItems.runId, run.id)).orderBy(asc(t.reconciliationItems.id));
    return present('Reconciliation', { ...run, items });
  });

  app.post('/webhooks/midtrans', { schema: routeSchema('receiveMidtransWebhook') }, async (request, reply) => {
    const body = request.body as Record<string, any>;
    const account = await providerAccount(app.services.db, app.services.config, 'MIDTRANS');
    if (!validSignature(body as any, app.services.config.midtransServerKey!)) throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Signature webhook tidak valid.');
    if (body.merchant_id && body.merchant_id !== account.merchantReference) throw new AppError(403, 'WEBHOOK_MERCHANT_MISMATCH', 'Merchant webhook tidak cocok.');
    const [attempt] = await app.services.db.select().from(t.paymentAttempts).where(and(eq(t.paymentAttempts.providerAccountId, account.id), eq(t.paymentAttempts.providerOrderId, body.order_id))).limit(1);
    if (!attempt || rupiah(body.gross_amount) !== attempt.expectedAmount) throw new AppError(409, 'WEBHOOK_TRANSACTION_MISMATCH', 'Transaksi webhook tidak cocok.');
    const group = await one(app.services.db, t.checkoutGroups, attempt.checkoutGroupId);
    const dedupe = createHash('sha256').update(body.order_id + body.transaction_id + body.transaction_status + body.status_code + body.gross_amount).digest('hex');
    await app.services.db.transaction(async tx => {
      const [known] = await tx.select().from(t.paymentEvents).where(and(eq(t.paymentEvents.providerAccountId, account.id), eq(t.paymentEvents.dedupeKey, `webhook:${dedupe}`))).limit(1);
      if (known) return;
      const inboxId = randomUUID(), outboxId = randomUUID();
      await tx.insert(t.paymentEvents).values({ id: inboxId, providerAccountId: account.id, paymentAttemptId: attempt.id,
        dedupeKey: `webhook:${dedupe}`, source: 'WEBHOOK', payloadReference: `outbox:${outboxId}`,
        verificationStatus: 'VERIFIED', processingStatus: 'RECEIVED' });
      await tx.insert(t.outboxEvents).values({ id: outboxId, eventKey: `payment-webhook:${dedupe}`, aggregateType: 'PAYMENT', aggregateId: attempt.id,
        eventType: 'PAYMENT_RECONCILE', payload: { paymentAttemptId: attempt.id, paymentEventId: inboxId, userId: group.createdBy,
          requestId: request.id, encryptedPayload: encryptSensitive(JSON.stringify(body), app.services.config.dataEncryptionKey, 'payment-provider-payload') } });
    });
    return reply.code(200).send({ message: 'Webhook diterima.' });
  });
}

export { handlePaymentEvent } from './service.js';
