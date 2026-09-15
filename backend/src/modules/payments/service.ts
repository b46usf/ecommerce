import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DatabaseExecutor, DatabaseTransaction } from '../../database/index.js';
import * as t from '../../database/schema.js';
import type { Services } from '../../services.js';
import { encryptSensitive, decryptSensitive } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { one } from '../../shared/operations.js';
import { providerAccount, ProviderError, providerRequest } from '../../integrations/providers.js';
import { ensureAccount, postJournalInTransaction, type PostingLine } from '../ledger/service.js';
import { rupiah } from './policy.js';

export type PaymentJob = { paymentAttemptId?: string; paymentEventId?: string; orderGroupId?: string; reconciliationId?: string; userId: string; requestId: string };
export async function enqueuePayment(db: DatabaseExecutor, eventType: string, aggregateId: string, payload: PaymentJob, eventKey = `${eventType}:${aggregateId}:${randomUUID()}`) {
  const id = randomUUID();
  await db.insert(t.outboxEvents).values({ id, eventKey, eventType, aggregateType: 'payment', aggregateId, payload });
  return { id, state: 'QUEUED', status_url: `/api/v1/operations/${id}`, result_type: payload.reconciliationId ? 'reconciliation' : payload.paymentAttemptId ? 'payment_attempt' : 'order_group', result_id: payload.reconciliationId ?? payload.paymentAttemptId ?? payload.orderGroupId };
}
export async function paymentAttemptDetail(db: DatabaseExecutor, id: string, buyerId: string, secret: string) {
  const attempt = await one(db, t.paymentAttempts, id);
  await one(db, t.checkoutGroups, attempt.checkoutGroupId, eq(t.checkoutGroups.buyerAccountId, buyerId));
  const session = attempt.sessionSecretCiphertext && !attempt.terminalVerifiedAt ? JSON.parse(decryptSensitive(attempt.sessionSecretCiphertext, secret, 'payment-session')) : {};
  return { ...attempt, order_group_id: attempt.checkoutGroupId, amount: attempt.expectedAmount, snap_token: session.token ?? null, redirect_url: session.redirect_url ?? null };
}
async function providerForAttempt(services: Services, attempt: typeof t.paymentAttempts.$inferSelect) {
  const account = await providerAccount(services.db, services.config, 'MIDTRANS');
  if (account.id !== attempt.providerAccountId) throw new AppError(503, 'PROVIDER_ACCOUNT_MISMATCH', 'Credential aktif tidak cocok dengan akun transaksi.');
  return account;
}
async function recordAudit(tx: DatabaseTransaction, type: string, id: string, action: string, payload: PaymentJob, changes: Record<string, unknown>) {
  await tx.insert(t.auditLogs).values({ actorId: payload.userId, entityType: type, entityId: id, action, changesRedacted: changes, correlationId: payload.requestId });
}
export async function releaseReservations(tx: DatabaseTransaction, groupId: string, payload: PaymentJob, state: 'CANCELLED' | 'EXPIRED') {
  const group = await one(tx, t.checkoutGroups, groupId, undefined, true);
  const receipts = await tx.select({ id: t.paymentReceipts.id }).from(t.paymentReceipts).where(eq(t.paymentReceipts.checkoutGroupId, groupId)).limit(1).for('update');
  if (receipts.length) throw new AppError(409, 'ORDER_ALREADY_PAID', 'Dana diterima; reservasi tidak boleh dilepas sebagai order tidak dibayar.');
  const unresolved = await tx.select({ id: t.paymentAttempts.id }).from(t.paymentAttempts).where(and(eq(t.paymentAttempts.checkoutGroupId, groupId), isNull(t.paymentAttempts.terminalVerifiedAt))).limit(1).for('update');
  if (unresolved.length) throw new AppError(409, 'PAYMENT_UNRESOLVED', 'Status provider belum terminal terverifikasi.');
  if (['CANCELLED', 'EXPIRED'].includes(group.orderState)) return;
  const reservations = await tx.select({ reservation: t.stockReservations }).from(t.stockReservations).innerJoin(t.orderItems, eq(t.orderItems.id, t.stockReservations.orderItemId)).innerJoin(t.vendorOrders, eq(t.vendorOrders.id, t.orderItems.vendorOrderId))
    .where(and(eq(t.vendorOrders.checkoutGroupId, groupId), eq(t.stockReservations.state, 'ACTIVE'))).orderBy(asc(t.stockReservations.inventoryId), asc(t.stockReservations.id)).for('update');
  for (const { reservation } of reservations) {
    const balance = await one(tx, t.inventoryBalances, reservation.inventoryId, undefined, true);
    if (balance.reserved < reservation.quantity) throw new AppError(409, 'INVENTORY_REVIEW', 'Saldo reservasi tidak cocok; perlu rekonsiliasi.');
    await tx.update(t.inventoryBalances).set({ reserved: balance.reserved - reservation.quantity, rowVersion: balance.rowVersion + 1 }).where(eq(t.inventoryBalances.id, balance.id));
    await tx.update(t.stockReservations).set({ state: 'RELEASED', closedAt: new Date(), rowVersion: reservation.rowVersion + 1 }).where(eq(t.stockReservations.id, reservation.id));
    await tx.insert(t.inventoryMovements).values({ inventoryId: balance.id, reservationId: reservation.id, onHandDelta: 0, reservedDelta: -reservation.quantity, actorId: payload.userId, reason: 'RELEASE', eventKey: `release:${reservation.id}` });
  }
  await tx.update(t.checkoutGroups).set({ orderState: state, rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
  await tx.update(t.vendorOrders).set({ fulfillmentStatus: 'CANCELLED', rowVersion: sql`${t.vendorOrders.rowVersion} + 1` }).where(eq(t.vendorOrders.checkoutGroupId, group.id));
  await recordAudit(tx, 'checkout', group.id, `ORDER_${state}`, payload, { state });
}

async function saveObservation(tx: DatabaseTransaction, services: Services, attempt: typeof t.paymentAttempts.$inferSelect, data: Record<string, unknown>, payload: PaymentJob) {
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex'), eventId = randomUUID(), outboxId = randomUUID();
  await tx.insert(t.paymentEvents).values({ id: eventId, providerAccountId: attempt.providerAccountId, paymentAttemptId: attempt.id, dedupeKey: `poll:${hash}`, source: 'POLL', payloadReference: `outbox:${outboxId}`, verificationStatus: 'VERIFIED', processingStatus: 'DONE', processedAt: new Date() }).onDuplicateKeyUpdate({ set: { dedupeKey: `poll:${hash}` } });
  await tx.insert(t.outboxEvents).values({ id: outboxId, eventKey: `payment-observation:${outboxId}`, aggregateType: 'payment', aggregateId: attempt.id, eventType: 'PAYMENT_OBSERVATION', payload: { userId: payload.userId, encryptedPayload: encryptSensitive(JSON.stringify(data), services.config.dataEncryptionKey, 'payment-provider-payload') }, state: 'DONE' });
}

export async function applyVerifiedStatus(services: Services, attemptId: string, data: Record<string, any>, payload: PaymentJob) {
  const initial = await one(services.db, t.paymentAttempts, attemptId);
  const account = await providerForAttempt(services, initial);
  if (data.order_id !== initial.providerOrderId || !data.transaction_id || (data.merchant_id && data.merchant_id !== account.merchantReference) || (data.currency && data.currency !== 'IDR')) throw new AppError(409, 'PROVIDER_RESPONSE_MISMATCH', 'Identitas respons provider tidak cocok dengan transaksi.');
  const amount = rupiah(data.gross_amount), status = String(data.transaction_status);
  await services.db.transaction(async tx => {
    const group = await one(tx, t.checkoutGroups, initial.checkoutGroupId, undefined, true);
    const attempt = await one(tx, t.paymentAttempts, attemptId, undefined, true);
    await saveObservation(tx, services, attempt, data, payload);
    const [receipt] = await tx.select().from(t.paymentReceipts).where(eq(t.paymentReceipts.paymentAttemptId, attempt.id)).for('update');
    if (receipt) {
      if (receipt.providerTransactionId !== data.transaction_id || receipt.amount !== amount) throw new AppError(409, 'RECEIPT_IDENTITY_MISMATCH', 'Receipt yang tersimpan tidak cocok dengan respons provider.');
      // A stale pending event cannot undo a verified receipt. Actual reversals need review.
      if (['deny', 'chargeback', 'partial_chargeback'].includes(status)) {
        await tx.update(t.checkoutGroups).set({ orderState: 'REVIEW', rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
        await tx.update(t.vendorOrders).set({ fulfillmentStatus: 'REVIEW', rowVersion: sql`${t.vendorOrders.rowVersion} + 1` }).where(eq(t.vendorOrders.checkoutGroupId, group.id));
        await recordAudit(tx, 'payment', attempt.id, 'PAYMENT_REVERSAL_REVIEW', payload, { provider_status: status });
      }
      return;
    }
    if (status === 'settlement' && (!data.fraud_status || data.fraud_status === 'accept')) {
      const orders = await tx.select().from(t.vendorOrders).where(eq(t.vendorOrders.checkoutGroupId, group.id)).orderBy(asc(t.vendorOrders.id)).for('update');
      const entries = await tx.select({ item: t.orderItems, reservation: t.stockReservations }).from(t.orderItems).innerJoin(t.vendorOrders, eq(t.vendorOrders.id, t.orderItems.vendorOrderId))
        .leftJoin(t.stockReservations, eq(t.stockReservations.orderItemId, t.orderItems.id)).where(eq(t.vendorOrders.checkoutGroupId, group.id)).orderBy(asc(t.stockReservations.inventoryId), asc(t.orderItems.id)).for('update');
      const requirements = new Map<string, number>();
      for (const { item, reservation } of entries) if (reservation) requirements.set(reservation.inventoryId, (requirements.get(reservation.inventoryId) ?? 0) + item.quantity);
      const balances = requirements.size ? await tx.select().from(t.inventoryBalances).where(inArray(t.inventoryBalances.id, [...requirements.keys()].sort())).orderBy(asc(t.inventoryBalances.id)).for('update') : [];
      const [applied] = await tx.select({ id: t.paymentReceipts.id }).from(t.paymentReceipts).where(and(eq(t.paymentReceipts.checkoutGroupId, group.id), eq(t.paymentReceipts.applicationStatus, 'APPLIED'))).for('update');
      const canApply = !applied && amount === attempt.expectedAmount && amount === group.grandTotal && ['AWAITING_PAYMENT', 'CANCEL_REQUESTED'].includes(group.orderState) && orders.length > 0 && entries.length > 0 && entries.every(({ item, reservation }) => reservation?.state === 'ACTIVE' && reservation.quantity === item.quantity) && balances.length === requirements.size && balances.every(balance => balance.reserved >= requirements.get(balance.id)! && balance.onHand >= requirements.get(balance.id)!);
      const receiptId = randomUUID();
      await tx.insert(t.paymentReceipts).values({ id: receiptId, paymentAttemptId: attempt.id, checkoutGroupId: group.id, providerAccountId: account.id, providerTransactionId: data.transaction_id, amount, receivedAt: new Date(), applicationStatus: canApply ? 'APPLIED' : 'EXCESS_REVIEW' });
      const lines: PostingLine[] = [{ accountId: await ensureAccount(tx, 'PROVIDER_CLEARING', 'ASSET'), debit: BigInt(amount), credit: 0n }];
      if (canApply) {
        for (const balance of balances) {
          const quantity = requirements.get(balance.id)!;
          await tx.update(t.inventoryBalances).set({ onHand: balance.onHand - quantity, reserved: balance.reserved - quantity, rowVersion: balance.rowVersion + 1 }).where(eq(t.inventoryBalances.id, balance.id));
        }
        for (const { reservation } of entries) {
          await tx.update(t.stockReservations).set({ state: 'CONSUMED', closedAt: new Date(), rowVersion: reservation!.rowVersion + 1 }).where(eq(t.stockReservations.id, reservation!.id));
          await tx.insert(t.inventoryMovements).values({ inventoryId: reservation!.inventoryId, reservationId: reservation!.id, onHandDelta: -reservation!.quantity, reservedDelta: -reservation!.quantity, reason: 'CONSUME', eventKey: `consume:${reservation!.id}`, actorId: payload.userId });
        }
        for (const order of orders) {
          const vendorAmount = BigInt(order.itemsGross) - BigInt(order.commissionAmount) - BigInt(order.commissionVat) - BigInt(order.sellerWithholding);
          if (vendorAmount < 0n) throw new AppError(409, 'INVALID_PAYMENT_SPLIT', 'Hak vendor tidak boleh negatif ketika akrual.');
          const credits: Array<[string, bigint, string]> = [[`VENDOR_PAYABLE:${order.storeId}`, vendorAmount, 'LIABILITY'], ['SHIPPING_PAYABLE', BigInt(order.shippingAmount), 'LIABILITY'], ['DEFERRED_COMMISSION', BigInt(order.commissionAmount), 'LIABILITY'], ['COMMISSION_VAT_PAYABLE', BigInt(order.commissionVat), 'LIABILITY'], ['SELLER_WITHHOLDING_PAYABLE', BigInt(order.sellerWithholding), 'LIABILITY'], ['BUYER_FEE_REVENUE', BigInt(order.buyerFee), 'INCOME']];
          for (const [code, credit, kind] of credits) if (credit > 0n) lines.push({ accountId: await ensureAccount(tx, code, kind, code.startsWith('VENDOR_PAYABLE:') ? order.storeId : undefined), vendorOrderId: order.id, debit: 0n, credit });
          if (order.platformDiscount > 0) lines.push({ accountId: await ensureAccount(tx, 'PLATFORM_DISCOUNT_EXPENSE', 'EXPENSE'), vendorOrderId: order.id, debit: BigInt(order.platformDiscount), credit: 0n });
          await tx.insert(t.paymentAllocations).values({ paymentReceiptId: receiptId, checkoutGroupId: group.id, vendorOrderId: order.id, amount: order.buyerTotal });
          await tx.insert(t.vendorPayables).values({ vendorOrderId: order.id, accruedAmount: Number(vendorAmount), adjustmentAmount: 0, reservedPayoutAmount: 0, paidAmount: 0, eligibility: 'BLOCKED' });
        }
        await tx.update(t.checkoutGroups).set({ orderState: 'ACTIVE', rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
      } else {
        lines.push({ accountId: await ensureAccount(tx, 'REFUND_PAYABLE'), debit: 0n, credit: BigInt(amount) });
        if (!applied) {
          await tx.update(t.checkoutGroups).set({ orderState: 'REVIEW', rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
          await tx.update(t.vendorOrders).set({ fulfillmentStatus: 'REVIEW', rowVersion: sql`${t.vendorOrders.rowVersion} + 1` }).where(eq(t.vendorOrders.checkoutGroupId, group.id));
        }
      }
      const journal = await postJournalInTransaction(tx, { eventKey: `payment-received:${receiptId}`, description: `Penerimaan ${group.orderNumber}`, paymentReceiptId: receiptId, lines });
      if (canApply) for (const order of orders) await tx.update(t.vendorPayables).set({ lastJournalEntryId: journal.id }).where(eq(t.vendorPayables.vendorOrderId, order.id));
      await tx.update(t.paymentAttempts).set({ state: 'TERMINAL', providerStatus: status, providerTransactionId: data.transaction_id, terminalVerifiedAt: new Date(), sessionSecretCiphertext: null, rowVersion: attempt.rowVersion + 1 }).where(eq(t.paymentAttempts.id, attempt.id));
      await tx.insert(t.notifications).values({ userId: group.createdBy, businessEventKey: `payment-received:${receiptId}`, kind: 'PAYMENT', payload: { order_group_id: group.id, payment_receipt_id: receiptId, status: canApply ? 'PAID' : 'REVIEW' } });
      await recordAudit(tx, 'payment', attempt.id, canApply ? 'PAYMENT_APPLIED' : 'PAYMENT_EXCESS_REVIEW', payload, { amount, receipt_id: receiptId });
    } else if (['cancel', 'expire', 'deny'].includes(status)) {
      await tx.update(t.paymentAttempts).set({ state: 'TERMINAL', providerStatus: status, providerTransactionId: data.transaction_id, terminalVerifiedAt: new Date(), sessionSecretCiphertext: null, rowVersion: attempt.rowVersion + 1 }).where(eq(t.paymentAttempts.id, attempt.id));
      if (group.orderState === 'CANCEL_REQUESTED' || group.reservationExpiresAt <= new Date()) await releaseReservations(tx, group.id, payload, group.orderState === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'EXPIRED');
    } else if (!attempt.terminalVerifiedAt) {
      await tx.update(t.paymentAttempts).set({ state: status === 'pending' && attempt.state !== 'CANCEL_REQUESTED' ? 'PENDING' : attempt.state === 'CANCEL_REQUESTED' ? 'CANCEL_REQUESTED' : 'UNKNOWN', providerStatus: status, providerTransactionId: data.transaction_id, rowVersion: attempt.rowVersion + 1 }).where(eq(t.paymentAttempts.id, attempt.id));
      if (['capture', 'authorize', 'refund', 'partial_refund', 'chargeback', 'partial_chargeback'].includes(status)) {
        await tx.update(t.checkoutGroups).set({ orderState: 'REVIEW', rowVersion: group.rowVersion + 1 }).where(eq(t.checkoutGroups.id, group.id));
        await recordAudit(tx, 'payment', attempt.id, 'PAYMENT_STATUS_REVIEW', payload, { provider_status: status });
      }
    }
    if (payload.paymentEventId) await tx.update(t.paymentEvents).set({ processingStatus: 'DONE', processedAt: new Date(), lastError: null }).where(eq(t.paymentEvents.id, payload.paymentEventId));
  });
}

export async function reconcileAttempt(services: Services, id: string, payload: PaymentJob) {
  const attempt = await one(services.db, t.paymentAttempts, id);
  await providerForAttempt(services, attempt);
  try {
    const response = await providerRequest(services.config, 'MIDTRANS', `/v2/${encodeURIComponent(attempt.providerTransactionId ?? attempt.providerOrderId)}/status`);
    await applyVerifiedStatus(services, id, response, payload);
    return response;
  } catch (error) {
    await services.db.update(t.paymentAttempts).set({ state: 'UNKNOWN', rowVersion: sql`${t.paymentAttempts.rowVersion} + 1` }).where(and(eq(t.paymentAttempts.id, id), isNull(t.paymentAttempts.terminalVerifiedAt)));
    if (payload.paymentEventId) await services.db.update(t.paymentEvents).set({ processingStatus: 'ERROR', lastError: 'Provider verification unavailable or conflicting' }).where(eq(t.paymentEvents.id, payload.paymentEventId));
    throw error;
  }
}

export async function createSnap(services: Services, id: string, payload: PaymentJob) {
  const initial = await one(services.db, t.paymentAttempts, id);
  await providerForAttempt(services, initial);
  const attempt = await services.db.transaction(async tx => {
    const group = await one(tx, t.checkoutGroups, initial.checkoutGroupId, undefined, true);
    const row = await one(tx, t.paymentAttempts, id, undefined, true);
    if (row.sessionSecretCiphertext || row.terminalVerifiedAt) return null;
    if (row.state !== 'CREATING') return row;
    if (group.orderState !== 'AWAITING_PAYMENT' || group.reservationExpiresAt.getTime() - Date.now() < 300000) {
      await tx.update(t.paymentAttempts).set({ state: 'TERMINAL', providerStatus: 'not_submitted', terminalVerifiedAt: new Date(), rowVersion: row.rowVersion + 1 }).where(eq(t.paymentAttempts.id, id));
      if (group.orderState === 'CANCEL_REQUESTED' || group.reservationExpiresAt <= new Date()) await releaseReservations(tx, group.id, payload, group.orderState === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'EXPIRED');
      return null;
    }
    await tx.update(t.paymentAttempts).set({ state: 'UNKNOWN', providerStatus: 'create_requested', rowVersion: row.rowVersion + 1 }).where(eq(t.paymentAttempts.id, id));
    return { ...row, doCreate: true, group };
  });
  if (!attempt) return;
  if (!attempt.doCreate) { await reconcileAttempt(services, id, payload); return; }
  const duration = Math.floor((attempt.group.reservationExpiresAt.getTime() - Date.now()) / 60000);
  const start = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' +0000';
  const response = await providerRequest(services.config, 'MIDTRANS', '/snap/v1/transactions', 'POST', { transaction_details: { order_id: attempt.providerOrderId, gross_amount: attempt.expectedAmount }, enabled_payments: attempt.channel ? [attempt.channel] : services.config.paymentChannels, expiry: { start_time: start, duration, unit: 'minutes' }, page_expiry: { duration, unit: 'minutes' } }, true);
  if (typeof response.token !== 'string' || !response.token || typeof response.redirect_url !== 'string') throw new ProviderError(502, true);
  const url = new URL(response.redirect_url), host = services.config.providerEnvironment === 'SANDBOX' ? 'app.sandbox.midtrans.com' : 'app.midtrans.com';
  if (url.protocol !== 'https:' || url.hostname !== host) throw new ProviderError(502, true);
  await services.db.transaction(async tx => {
    await one(tx, t.checkoutGroups, initial.checkoutGroupId, undefined, true);
    const row = await one(tx, t.paymentAttempts, id, undefined, true);
    if (row.terminalVerifiedAt) return;
    await tx.update(t.paymentAttempts).set({ state: row.state === 'CANCEL_REQUESTED' ? 'CANCEL_REQUESTED' : 'PENDING', providerStatus: 'snap_created', sessionSecretCiphertext: encryptSensitive(JSON.stringify({ token: response.token, redirect_url: response.redirect_url }), services.config.dataEncryptionKey, 'payment-session'), rowVersion: row.rowVersion + 1 }).where(eq(t.paymentAttempts.id, id));
  });
}

export async function cancelAttempt(services: Services, id: string, payload: PaymentJob) {
  const attempt = await one(services.db, t.paymentAttempts, id);
  await providerForAttempt(services, attempt);
  if (attempt.terminalVerifiedAt) return;
  let snapCancelled = false;
  if (attempt.sessionSecretCiphertext) {
    const session = JSON.parse(decryptSensitive(attempt.sessionSecretCiphertext, services.config.dataEncryptionKey, 'payment-session'));
    const base = services.config.providerEnvironment === 'SANDBOX' ? 'https://app.sandbox.midtrans.com' : 'https://app.midtrans.com';
    const response = await fetch(`${base}/snap/v1/transactions/${encodeURIComponent(session.token)}/cancel`, { method: 'POST', headers: { Authorization: services.config.midtransServerKey!, 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (response.ok) { const data = await response.json() as { canceled_at?: string }; snapCancelled = Boolean(data.canceled_at && Number.isFinite(Date.parse(data.canceled_at))); }
  }
  try {
    const data = await providerRequest(services.config, 'MIDTRANS', `/v2/${encodeURIComponent(attempt.providerTransactionId ?? attempt.providerOrderId)}/status`);
    if (data.transaction_status === 'pending') {
      await providerRequest(services.config, 'MIDTRANS', `/v2/${encodeURIComponent(attempt.providerTransactionId ?? attempt.providerOrderId)}/cancel`, 'POST');
      await reconcileAttempt(services, id, payload);
    } else await applyVerifiedStatus(services, id, data, payload);
  } catch (error) {
    if (!(error instanceof ProviderError) || error.status !== 404 || !snapCancelled) {
      await services.db.update(t.paymentAttempts).set({ state: 'UNKNOWN' }).where(and(eq(t.paymentAttempts.id, id), isNull(t.paymentAttempts.terminalVerifiedAt)));
      throw error;
    }
    await services.db.transaction(async tx => {
      const group = await one(tx, t.checkoutGroups, attempt.checkoutGroupId, undefined, true);
      const row = await one(tx, t.paymentAttempts, id, undefined, true);
      if (row.terminalVerifiedAt) return;
      await tx.update(t.paymentAttempts).set({ state: 'TERMINAL', providerStatus: 'snap_cancelled', terminalVerifiedAt: new Date(), sessionSecretCiphertext: null, rowVersion: row.rowVersion + 1 }).where(eq(t.paymentAttempts.id, id));
      if (group.orderState === 'CANCEL_REQUESTED' || group.reservationExpiresAt <= new Date()) await releaseReservations(tx, group.id, payload, group.orderState === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'EXPIRED');
    });
  }
}

export async function expireOrder(services: Services, groupId: string, payload: PaymentJob) {
  const [attempt] = await services.db.select().from(t.paymentAttempts).where(and(eq(t.paymentAttempts.checkoutGroupId, groupId), isNull(t.paymentAttempts.terminalVerifiedAt))).limit(1);
  if (attempt) await reconcileAttempt(services, attempt.id, { ...payload, paymentAttemptId: attempt.id });
  await services.db.transaction(tx => releaseReservations(tx, groupId, payload, 'EXPIRED'));
}

export async function runReconciliation(services: Services, id: string, payload: PaymentJob) {
  const run = await one(services.db, t.reconciliationRuns, id);
  if (run.state !== 'RUNNING') return;
  const account = await providerAccount(services.db, services.config, 'MIDTRANS');
  if (account.id !== run.providerAccountId) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Akun rekonsiliasi tidak cocok dengan credential aktif.');
  const attempts = await services.db.select().from(t.paymentAttempts).where(and(eq(t.paymentAttempts.providerAccountId, account.id), gte(t.paymentAttempts.createdAt, run.periodStart), lt(t.paymentAttempts.createdAt, run.periodEnd))).orderBy(asc(t.paymentAttempts.id)).limit(501);
  if (attempts.length > 500) throw new AppError(422, 'RECONCILIATION_TOO_LARGE', 'Periode rekonsiliasi memuat lebih dari 500 transaksi. Persempit periode.');
  for (const attempt of attempts) {
    try { await reconcileAttempt(services, attempt.id, { ...payload, paymentAttemptId: attempt.id }); }
    catch {
      await services.db.insert(t.reconciliationItems).values({ runId: id, paymentAttemptId: attempt.id,
        externalReference: attempt.providerOrderId, expectedAmount: attempt.expectedAmount, kind: 'STATUS', state: 'OPEN' })
        .onDuplicateKeyUpdate({ set: { expectedAmount: attempt.expectedAmount } });
    }
  }
  await services.db.update(t.reconciliationRuns).set({ state: 'COMPLETED', finishedAt: new Date(), rowVersion: sql`${t.reconciliationRuns.rowVersion} + 1` }).where(eq(t.reconciliationRuns.id, id));
}

export async function handlePaymentEvent(services: Services, eventType: string, payload: PaymentJob) {
  if (eventType === 'PAYMENT_CREATE' && payload.paymentAttemptId) return createSnap(services, payload.paymentAttemptId, payload);
  if (eventType === 'PAYMENT_RECONCILE' && payload.paymentAttemptId) return reconcileAttempt(services, payload.paymentAttemptId, payload);
  if (eventType === 'PAYMENT_CANCEL' && payload.paymentAttemptId) return cancelAttempt(services, payload.paymentAttemptId, payload);
  if (eventType === 'ORDER_EXPIRE' && payload.orderGroupId) return expireOrder(services, payload.orderGroupId, payload);
  if (eventType === 'RECONCILIATION_RUN' && payload.reconciliationId) return runReconciliation(services, payload.reconciliationId, payload);
  throw new Error('UNSUPPORTED_PAYMENT_EVENT');
}
