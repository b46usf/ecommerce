import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { DatabaseExecutor, DatabaseTransaction } from '../../database/index.js';
import * as t from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { one, type Context } from '../../shared/operations.js';
import { ensureAccount, postJournalInTransaction, type PostingLine } from '../ledger/service.js';
import { externalReference, integerAmount, pendingRefundStates, proportionalReversal, refundableStates, refundSplit, reason, safeAmount } from './policy.js';

type RefundLineInput = { vendor_order_id?: string; order_item_id?: string; component: string; amount: number };
type RefundResult = { providerRefundId?: string; proofDocumentId?: string; actorId?: string; requestId: string; reason: string; channel: 'API' | 'MANUAL' };
const txOf = (context: Context) => context.db as DatabaseTransaction;

export async function refundDetail(db: DatabaseExecutor, id: string) {
  const refund = await one(db, t.refunds, id);
  const lines = await db.select().from(t.refundLines).where(eq(t.refundLines.refundId, id)).orderBy(asc(t.refundLines.id));
  return { ...refund, lines };
}

async function auditResult(tx: DatabaseTransaction, entityType: string, entityId: string, action: string, result: RefundResult, changes: Record<string, unknown>) {
  await tx.insert(t.auditLogs).values({ actorId: result.actorId ?? null, entityType, entityId, action, changesRedacted: changes, reason: reason(result.reason), correlationId: result.requestId });
}

export async function verifiedProof(db: DatabaseExecutor, id: string | undefined, kind: 'REFUND_PROOF' | 'PAYOUT_PROOF', legalEntityId?: string) {
  if (!id) throw new AppError(422, 'PROOF_REQUIRED', 'Bukti hasil transfer yang telah diverifikasi wajib disertakan.');
  const document = await one(db, t.documents, id, undefined, true);
  if (document.documentType !== kind || document.verificationStatus !== 'VERIFIED' || !document.verifiedBy || (legalEntityId && document.legalEntityId !== legalEntityId)) {
    throw new AppError(422, 'INVALID_PROOF', 'Dokumen harus terverifikasi dan sesuai jenis serta pemilik transaksi.');
  }
  return document;
}

async function reservedRefunds(tx: DatabaseTransaction, receiptId: string) {
  return tx.select({ refund: t.refunds, line: t.refundLines }).from(t.refundLines)
    .innerJoin(t.refunds, eq(t.refunds.id, t.refundLines.refundId))
    .where(and(eq(t.refunds.paymentReceiptId, receiptId), inArray(t.refunds.state, refundableStates))).for('update');
}

export async function createRefund(context: Context) {
  const tx = txOf(context), { body, user } = context;
  const explanation = reason(body.reason);
  const input: RefundLineInput[] = body.lines;
  if (!Array.isArray(input) || !input.length || input.length > 500) throw new AppError(422, 'INVALID_REFUND_LINES', 'Refund memerlukan 1–500 baris.');
  const total = safeAmount(input.reduce((sum, line) => sum + integerAmount(line.amount), 0n));
  const receipt = await one(tx, t.paymentReceipts, body.payment_receipt_id, undefined, true);
  const previous = await reservedRefunds(tx, receipt.id);
  const reserved = previous.reduce((sum, item) => sum + BigInt(item.line.amount), 0n);
  if (reserved + BigInt(total) > BigInt(receipt.amount)) throw new AppError(409, 'REFUND_CAPACITY_EXCEEDED', 'Jumlah refund aktif dan berhasil melampaui dana diterima.');
  const orderIds = [...new Set(input.flatMap(line => line.vendor_order_id ? [line.vendor_order_id] : []))].sort();
  const orders = new Map<string, typeof t.vendorOrders.$inferSelect>();
  for (const id of orderIds) {
    const order = await one(tx, t.vendorOrders, id, eq(t.vendorOrders.checkoutGroupId, receipt.checkoutGroupId), true);
    const [payable] = await tx.select().from(t.vendorPayables).where(eq(t.vendorPayables.vendorOrderId, id)).for('update');
    if (payable && payable.reservedPayoutAmount > 0) throw new AppError(409, 'PAYOUT_IN_PROGRESS', 'Selesaikan atau batalkan pencairan yang masih mencadangkan hak vendor sebelum refund.');
    orders.set(id, order);
  }
  const id = randomUUID();
  const checked: typeof t.refundLines.$inferInsert[] = [];
  for (const line of input) {
    if (line.component === 'EXCESS_PAYMENT') {
      if (line.vendor_order_id || line.order_item_id || receipt.applicationStatus === 'APPLIED') throw new AppError(422, 'INVALID_EXCESS_REFUND', 'Refund dana berlebih tidak boleh memakai order atau receipt yang sudah dialokasikan.');
    } else {
      if (!line.vendor_order_id || receipt.applicationStatus !== 'APPLIED') throw new AppError(422, 'REFUND_ORDER_REQUIRED', 'Refund komponen pesanan harus memakai receipt yang sudah dialokasikan dan order yang sesuai.');
      const order = orders.get(line.vendor_order_id)!;
      const sameOrderAmount = [...previous.map(row => ({ vendor_order_id: row.line.vendorOrderId, amount: row.line.amount })), ...input]
        .filter(row => row.vendor_order_id === order.id).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      if (sameOrderAmount > BigInt(order.buyerTotal)) throw new AppError(409, 'ORDER_REFUND_CAPACITY_EXCEEDED', 'Refund pesanan melampaui total yang dibayar pembeli.');
      let ceiling: number;
      if (line.component === 'ITEM') {
        if (!line.order_item_id) throw new AppError(422, 'REFUND_ITEM_REQUIRED', 'Komponen ITEM memerlukan baris order.');
        const item = await one(tx, t.orderItems, line.order_item_id, eq(t.orderItems.vendorOrderId, order.id), true);
        ceiling = item.lineGross;
      } else {
        if (line.order_item_id || !['SHIPPING', 'BUYER_FEE'].includes(line.component)) throw new AppError(422, 'INVALID_REFUND_COMPONENT', 'Komponen refund tidak cocok dengan referensi baris.');
        ceiling = line.component === 'SHIPPING' ? order.shippingAmount : order.buyerFee;
      }
      const same = (row: { component: string; vendorOrderId: string | null; orderItemId: string | null }) => row.component === line.component && row.vendorOrderId === line.vendor_order_id && row.orderItemId === (line.order_item_id ?? null);
      const prior = previous.filter(row => same(row.line)).reduce((sum, row) => sum + BigInt(row.line.amount), 0n);
      const requested = input.filter(row => row.component === line.component && row.vendor_order_id === line.vendor_order_id && row.order_item_id === line.order_item_id).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      if (prior + requested > BigInt(ceiling)) throw new AppError(409, 'COMPONENT_REFUND_CAPACITY_EXCEEDED', 'Refund komponen melampaui nilai asli.');
    }
    checked.push({ refundId: id, vendorOrderId: line.vendor_order_id ?? null, orderItemId: line.order_item_id ?? null, component: line.component, amount: line.amount, taxReversalSnapshot: {}, feeReversalSnapshot: {} });
  }
  await tx.insert(t.refunds).values({ id, paymentReceiptId: receipt.id, reference: `refund-${id}`, amount: total, state: 'REQUESTED', reason: explanation, requestedBy: user.id });
  await tx.insert(t.refundLines).values(checked);
  return refundDetail(tx, id);
}

/** Provider capability declarations are verified configuration, never guessed from a channel name. */
export async function refundChannel(db: DatabaseExecutor, receiptId: string) {
  const receipt = await one(db, t.paymentReceipts, receiptId);
  const attempt = await one(db, t.paymentAttempts, receipt.paymentAttemptId);
  const provider = await one(db, t.providerAccounts, receipt.providerAccountId);
  const capabilities = provider.capabilities as Record<string, unknown>;
  const listed = (key: string) => Array.isArray(capabilities[key]) && (capabilities[key] as unknown[]).includes(attempt.channel);
  return { receipt, attempt, provider, manual: listed('manual_refund_channels'), api: listed('refund_channels') };
}

export async function approveRefund(context: Context, row: typeof t.refunds.$inferSelect) {
  const tx = txOf(context);
  if (row.state !== 'REQUESTED') throw new AppError(409, 'INVALID_REFUND_STATE', 'Hanya refund REQUESTED yang dapat disetujui.');
  await one(tx, t.paymentReceipts, row.paymentReceiptId, undefined, true);
  const channel = await refundChannel(tx, row.paymentReceiptId);
  if (channel.provider.status !== 'ACTIVE' || (!channel.manual && !channel.api) || (channel.manual && channel.api)) throw new AppError(409, 'REFUND_CHANNEL_UNVERIFIED', 'Konfigurasi kanal refund API atau manual harus diverifikasi dahulu.');
  const active = await reservedRefunds(tx, row.paymentReceiptId);
  if (active.reduce((sum, item) => sum + BigInt(item.line.amount), 0n) > BigInt(channel.receipt.amount)) throw new AppError(409, 'REFUND_CAPACITY_EXCEEDED', 'Kapasitas refund tidak mencukupi.');
  const own = active.filter(item => item.refund.id === row.id);
  if (!own.length || own.reduce((sum, item) => sum + BigInt(item.line.amount), 0n) !== BigInt(row.amount)) throw new AppError(409, 'REFUND_LINES_MISMATCH', 'Jumlah baris refund tidak cocok dengan header.');
  await tx.update(t.refunds).set({ state: 'APPROVED', approvedBy: context.user.id, rowVersion: row.rowVersion + 1 }).where(eq(t.refunds.id, row.id));
  const eventId = randomUUID();
  await tx.insert(t.outboxEvents).values({ id: eventId, eventKey: `refund-requested:${row.id}`, aggregateType: 'refund', aggregateId: row.id, eventType: 'REFUND_REQUESTED', payload: { refundId: row.id, userId: context.user.id, requestId: context.request.id } });
  return { id: eventId, state: 'QUEUED', status_url: `/api/v1/operations/${eventId}`, result_type: 'refund', result_id: row.id };
}

/** Called only after provider verification or verified manual proof, within the caller's transaction. */
export async function finalizeRefund(tx: DatabaseTransaction, refundId: string, state: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN', result: RefundResult) {
  const initial = await one(tx, t.refunds, refundId);
  const receipt = await one(tx, t.paymentReceipts, initial.paymentReceiptId, undefined, true);
  const row = await one(tx, t.refunds, refundId, undefined, true);
  if (row.state === state && ['SUCCEEDED', 'FAILED'].includes(state)) {
    if (result.providerRefundId && row.providerRefundId !== result.providerRefundId) throw new AppError(409, 'REFUND_REFERENCE_CONFLICT', 'Hasil refund sudah memiliki referensi berbeda.');
    return refundDetail(tx, row.id);
  }
  if (!['APPROVED', 'PROCESSING', 'UNKNOWN'].includes(row.state)) throw new AppError(409, 'INVALID_REFUND_STATE', 'Status refund tidak dapat menerima hasil transfer.');
  const lines = await tx.select().from(t.refundLines).where(eq(t.refundLines.refundId, row.id)).orderBy(asc(t.refundLines.vendorOrderId), asc(t.refundLines.id)).for('update');
  if (result.channel === 'MANUAL') {
    const channel = await refundChannel(tx, receipt.id);
    if (!channel.manual || channel.api) throw new AppError(409, 'MANUAL_REFUND_NOT_ALLOWED', 'Kanal ini tidak terdaftar sebagai kanal refund manual.');
    const apiHistory = await tx.select({ id: t.auditLogs.id }).from(t.auditLogs).where(and(eq(t.auditLogs.entityType, 'refund'), eq(t.auditLogs.entityId, row.id), inArray(t.auditLogs.action, ['REFUND_API_STARTED', 'REFUND_API_UNKNOWN']))).limit(1);
    if (row.state === 'PROCESSING' || apiHistory.length) throw new AppError(409, 'API_REFUND_IN_PROGRESS', 'Refund provider yang sudah diproses harus diselesaikan melalui verifikasi provider.');
    if (state !== 'UNKNOWN') {
      const proof = await verifiedProof(tx, result.proofDocumentId, 'REFUND_PROOF');
      if (proof.vendorOrderId && !lines.some(line => line.vendorOrderId === proof.vendorOrderId)) throw new AppError(422, 'PROOF_SCOPE_MISMATCH', 'Dokumen refund berasal dari pesanan lain.');
    }
  }
  const reference = result.providerRefundId ? externalReference(result.providerRefundId) : undefined;
  if (state === 'SUCCEEDED' && !reference) throw new AppError(422, 'REFUND_REFERENCE_REQUIRED', 'Refund berhasil memerlukan referensi provider atau transfer.');
  if (state === 'SUCCEEDED') {
    const active = await reservedRefunds(tx, receipt.id);
    if (active.reduce((sum, item) => sum + BigInt(item.line.amount), 0n) > BigInt(receipt.amount)) throw new AppError(409, 'REFUND_CAPACITY_EXCEEDED', 'Refund melampaui receipt.');
    const posting: PostingLine[] = [];
    const debit = async (code: string, amount: number, kind = 'LIABILITY', order?: typeof t.vendorOrders.$inferSelect) => {
      if (amount > 0) posting.push({ accountId: await ensureAccount(tx, code, kind, code.startsWith('VENDOR_PAYABLE:') ? order?.storeId : undefined), vendorOrderId: order?.id, debit: BigInt(amount), credit: 0n });
    };
    const payableChanges = new Map<string, number>();
    for (const line of lines) {
      if (line.component === 'EXCESS_PAYMENT') { await debit('REFUND_PAYABLE', line.amount); continue; }
      const order = await one(tx, t.vendorOrders, line.vendorOrderId!, undefined, true) as typeof t.vendorOrders.$inferSelect;
      if (line.component === 'SHIPPING') { await debit('SHIPPING_PAYABLE', line.amount, 'LIABILITY', order); continue; }
      if (line.component === 'BUYER_FEE') { await debit('BUYER_FEE_REVENUE', line.amount, 'INCOME', order); continue; }
      const item = await one(tx, t.orderItems, line.orderItemId!, undefined, true) as typeof t.orderItems.$inferSelect;
      const previous = await tx.select({ amount: t.refundLines.amount }).from(t.refundLines).innerJoin(t.refunds, eq(t.refunds.id, t.refundLines.refundId))
        .where(and(eq(t.refundLines.orderItemId, item.id), eq(t.refundLines.component, 'ITEM'), eq(t.refunds.state, 'SUCCEEDED'), ne(t.refunds.id, row.id))).for('update');
      const earlierInThisRefund = lines.slice(0, lines.indexOf(line)).filter(previousLine => previousLine.orderItemId === item.id).reduce((sum, previousLine) => sum + previousLine.amount, 0);
      const priorAmount = safeAmount(previous.reduce((sum, previousLine) => sum + BigInt(previousLine.amount), BigInt(earlierInThisRefund)));
      const reverse = (amount: number) => proportionalReversal(amount, item.lineGross, priorAmount, line.amount);
      const { commission, commissionVat, withholding, vendorAmount } = refundSplit(item.lineGross, item.commissionAmount, item.commissionVat, item.sellerWithholding, priorAmount, line.amount);
      await debit(`VENDOR_PAYABLE:${order.storeId}`, vendorAmount, 'LIABILITY', order);
      await debit(order.fulfillmentStatus === 'COMPLETED' ? 'COMMISSION_REVENUE' : 'DEFERRED_COMMISSION', commission, order.fulfillmentStatus === 'COMPLETED' ? 'INCOME' : 'LIABILITY', order);
      await debit('COMMISSION_VAT_PAYABLE', commissionVat, 'LIABILITY', order);
      await debit('SELLER_WITHHOLDING_PAYABLE', withholding, 'LIABILITY', order);
      payableChanges.set(order.id, (payableChanges.get(order.id) ?? 0) + vendorAmount);
      const vat = reverse(item.lineVat);
      await tx.update(t.refundLines).set({ taxReversalSnapshot: { line_net: line.amount - vat, line_vat: vat, seller_withholding: withholding }, feeReversalSnapshot: { commission_amount: commission, commission_vat: commissionVat, vendor_amount: vendorAmount }, rowVersion: line.rowVersion + 1 }).where(eq(t.refundLines.id, line.id));
    }
    const creditAccount = await ensureAccount(tx, result.channel === 'API' ? 'PROVIDER_CLEARING' : 'BANK', 'ASSET');
    posting.push({ accountId: creditAccount, debit: 0n, credit: BigInt(row.amount) });
    const journal = await postJournalInTransaction(tx, { eventKey: `refund-succeeded:${row.id}`, description: `Refund ${row.reference}`, refundId: row.id, paymentReceiptId: receipt.id, lines: posting });
    for (const [orderId, adjustment] of payableChanges) {
      const [payable] = await tx.select().from(t.vendorPayables).where(eq(t.vendorPayables.vendorOrderId, orderId)).for('update');
      if (!payable) throw new AppError(409, 'PAYABLE_NOT_FOUND', 'Hak vendor untuk refund belum tercatat.');
      if (payable.reservedPayoutAmount > 0) throw new AppError(409, 'PAYOUT_IN_PROGRESS', 'Pencairan aktif masih mencadangkan hak vendor.');
      await tx.update(t.vendorPayables).set({ adjustmentAmount: safeAmount(BigInt(payable.adjustmentAmount) - BigInt(adjustment)), lastJournalEntryId: journal.id, rowVersion: payable.rowVersion + 1 }).where(eq(t.vendorPayables.id, payable.id));
    }
  }
  await tx.update(t.refunds).set({ state, providerRefundId: reference ?? row.providerRefundId, proofDocumentId: result.proofDocumentId ?? row.proofDocumentId, completedAt: state === 'SUCCEEDED' ? new Date() : null, rowVersion: row.rowVersion + 1 }).where(eq(t.refunds.id, row.id));
  await auditResult(tx, 'refund', row.id, `REFUND_${state}`, result, { previous_state: row.state, state, amount: row.amount, channel: result.channel });
  if (result.channel === 'API' && state === 'UNKNOWN') await auditResult(tx, 'refund', row.id, 'REFUND_API_UNKNOWN', result, { state });
  return refundDetail(tx, row.id);
}

export async function eligiblePayable(tx: DatabaseTransaction, id: string, storeId: string, includeReserved: number = 0) {
  const initial = await one(tx, t.vendorPayables, id);
  const order = await one(tx, t.vendorOrders, initial.vendorOrderId, eq(t.vendorOrders.storeId, storeId), true);
  const payable = await one(tx, t.vendorPayables, id, undefined, true);
  const now = Date.now();
  if (payable.eligibility !== 'ELIGIBLE' || !payable.eligibleAt || payable.eligibleAt.getTime() > now || order.fulfillmentStatus !== 'COMPLETED' || !order.completedAt || !order.disputeDeadline || order.disputeDeadline.getTime() > now) throw new AppError(409, 'PAYOUT_NOT_ELIGIBLE', 'Pesanan dan masa komplain harus selesai sebelum pencairan.');
  const cases = await tx.select({ id: t.orderCases.id }).from(t.orderCases).where(and(eq(t.orderCases.vendorOrderId, order.id), eq(t.orderCases.state, 'OPEN'))).limit(1).for('update');
  const pendingRefund = await tx.select({ id: t.refunds.id }).from(t.refunds).innerJoin(t.refundLines, eq(t.refundLines.refundId, t.refunds.id))
    .where(and(eq(t.refundLines.vendorOrderId, order.id), inArray(t.refunds.state, pendingRefundStates))).limit(1).for('update');
  if (cases.length || pendingRefund.length) throw new AppError(409, 'PAYOUT_BLOCKED', 'Dispute atau refund aktif memblokir pencairan.');
  const receipts = await tx.select({ receipt: t.paymentReceipts }).from(t.paymentAllocations).innerJoin(t.paymentReceipts, eq(t.paymentReceipts.id, t.paymentAllocations.paymentReceiptId))
    .where(eq(t.paymentAllocations.vendorOrderId, order.id)).for('update');
  if (!receipts.length || receipts.some(({ receipt }) => receipt.applicationStatus !== 'APPLIED' || !receipt.providerFundsAvailableAt || receipt.providerFundsAvailableAt.getTime() > now)) throw new AppError(409, 'FUNDS_UNAVAILABLE', 'Dana provider belum tersedia untuk pencairan.');
  const available = BigInt(payable.accruedAmount) + BigInt(payable.adjustmentAmount) - BigInt(payable.paidAmount) - BigInt(payable.reservedPayoutAmount) + BigInt(includeReserved);
  return { payable, order, available };
}

export async function payoutBank(tx: DatabaseTransaction, storeId: string, accountId: string) {
  const store = await one(tx, t.stores, storeId, undefined, true);
  const bank = await one(tx, t.bankAccounts, accountId, undefined, true);
  if (store.status !== 'ACTIVE' || bank.legalEntityId !== store.legalEntityId || bank.status !== 'VERIFIED' || !bank.verifiedAt) throw new AppError(422, 'INVALID_PAYOUT_BANK', 'Rekening terverifikasi harus milik entitas toko aktif.');
  return { store, bank };
}

export async function createPayout(context: Context) {
  const tx = txOf(context), input: Array<{ vendor_payable_id: string; amount: number }> = context.body.lines;
  if (!Array.isArray(input) || !input.length || input.length > 500 || new Set(input.map(line => line.vendor_payable_id)).size !== input.length) throw new AppError(422, 'INVALID_PAYOUT_LINES', 'Gunakan 1–500 payable unik.');
  const amount = safeAmount(input.reduce((sum, line) => sum + integerAmount(line.amount), 0n));
  const { bank } = await payoutBank(tx, context.body.store_id, context.body.bank_account_id);
  const lines = [...input].sort((a, b) => a.vendor_payable_id.localeCompare(b.vendor_payable_id));
  for (const line of lines) {
    const { payable, available } = await eligiblePayable(tx, line.vendor_payable_id, context.body.store_id);
    if (available < BigInt(line.amount)) throw new AppError(409, 'PAYOUT_CAPACITY_EXCEEDED', 'Saldo hak vendor yang belum dicadangkan tidak mencukupi.');
    await tx.update(t.vendorPayables).set({ reservedPayoutAmount: safeAmount(BigInt(payable.reservedPayoutAmount) + BigInt(line.amount)), rowVersion: payable.rowVersion + 1 }).where(eq(t.vendorPayables.id, payable.id));
  }
  const id = randomUUID();
  await tx.insert(t.payouts).values({ id, storeId: context.body.store_id, bankAccountId: bank.id, reference: `payout-${id}`, amount, state: 'DRAFT', requestedBy: context.user.id,
    beneficiarySnapshot: { bank_account_id: bank.id, legal_entity_id: bank.legalEntityId, bank_code: bank.bankCode, account_fingerprint: bank.accountFingerprint, account_name: bank.accountName, account_number_ciphertext: bank.accountNumberCiphertext } });
  await tx.insert(t.payoutLines).values(lines.map(line => ({ payoutId: id, vendorPayableId: line.vendor_payable_id, amount: line.amount })));
  return one(tx, t.payouts, id);
}

export async function validatePayout(tx: DatabaseTransaction, row: typeof t.payouts.$inferSelect) {
  const { bank } = await payoutBank(tx, row.storeId, row.bankAccountId);
  if (row.beneficiarySnapshot.account_fingerprint !== bank.accountFingerprint || row.beneficiarySnapshot.account_number_ciphertext !== bank.accountNumberCiphertext) throw new AppError(409, 'BENEFICIARY_CHANGED', 'Rekening berubah sesudah batch dibuat.');
  const lines = await tx.select().from(t.payoutLines).where(eq(t.payoutLines.payoutId, row.id)).orderBy(asc(t.payoutLines.vendorPayableId)).for('update');
  if (!lines.length || lines.reduce((sum, line) => sum + BigInt(line.amount), 0n) !== BigInt(row.amount)) throw new AppError(409, 'PAYOUT_LINES_MISMATCH', 'Alokasi payout tidak cocok dengan header.');
  for (const line of lines) {
    const { payable, available } = await eligiblePayable(tx, line.vendorPayableId, row.storeId, line.amount);
    if (payable.reservedPayoutAmount < line.amount || available < BigInt(line.amount)) throw new AppError(409, 'PAYOUT_CAPACITY_EXCEEDED', 'Cadangan pencairan tidak lagi mencukupi.');
  }
  return { bank, lines };
}

export async function recordPayout(context: Context, row: typeof t.payouts.$inferSelect) {
  const tx = txOf(context), state = context.body.state as 'PAID' | 'FAILED' | 'UNKNOWN';
  if (!['PROCESSING', 'UNKNOWN'].includes(row.state)) throw new AppError(409, 'INVALID_PAYOUT_STATE', 'Hasil transfer hanya dapat dicatat untuk PROCESSING atau UNKNOWN.');
  reason(context.body.reason);
  const bank = await one(tx, t.bankAccounts, row.bankAccountId);
  let transferReference = row.transferReference;
  if (state !== 'UNKNOWN') {
    await verifiedProof(tx, context.body.proof_document_id, 'PAYOUT_PROOF', bank.legalEntityId);
    transferReference = externalReference(context.body.transfer_reference);
    // A single platform bank ledger lock serializes reference checks across every vendor.
    const bankLedgerId = await ensureAccount(tx, 'BANK', 'ASSET');
    await one(tx, t.ledgerAccounts, bankLedgerId, undefined, true);
    const duplicate = await tx.select({ id: t.payouts.id }).from(t.payouts).where(and(eq(t.payouts.transferReference, transferReference), ne(t.payouts.id, row.id))).limit(1).for('update');
    if (duplicate.length) throw new AppError(409, 'TRANSFER_REFERENCE_REUSED', 'Referensi bank sudah digunakan pencairan lain.');
    const lines = await tx.select().from(t.payoutLines).where(eq(t.payoutLines.payoutId, row.id)).orderBy(asc(t.payoutLines.vendorPayableId)).for('update');
    if (!lines.length || lines.reduce((sum, line) => sum + BigInt(line.amount), 0n) !== BigInt(row.amount)) throw new AppError(409, 'PAYOUT_LINES_MISMATCH', 'Alokasi pencairan tidak cocok.');
    const posting: PostingLine[] = [];
    for (const line of lines) {
      const payable = await one(tx, t.vendorPayables, line.vendorPayableId, undefined, true);
      const order = await one(tx, t.vendorOrders, payable.vendorOrderId, eq(t.vendorOrders.storeId, row.storeId), true);
      if (payable.reservedPayoutAmount < line.amount) throw new AppError(409, 'PAYOUT_RESERVATION_MISSING', 'Cadangan pencairan tidak cocok.');
      await tx.update(t.vendorPayables).set({ reservedPayoutAmount: payable.reservedPayoutAmount - line.amount, paidAmount: state === 'PAID' ? safeAmount(BigInt(payable.paidAmount) + BigInt(line.amount)) : payable.paidAmount, rowVersion: payable.rowVersion + 1 }).where(eq(t.vendorPayables.id, payable.id));
      if (state === 'PAID') posting.push({ accountId: await ensureAccount(tx, `VENDOR_PAYABLE:${row.storeId}`, 'LIABILITY', row.storeId), vendorOrderId: order.id, debit: BigInt(line.amount), credit: 0n });
    }
    if (state === 'PAID') {
      posting.push({ accountId: bankLedgerId, debit: 0n, credit: BigInt(row.amount) });
      const journal = await postJournalInTransaction(tx, { eventKey: `payout-paid:${row.id}`, description: `Pencairan ${row.reference}`, payoutId: row.id, lines: posting });
      for (const line of lines) await tx.update(t.vendorPayables).set({ lastJournalEntryId: journal.id }).where(eq(t.vendorPayables.id, line.vendorPayableId));
    }
  }
  await tx.update(t.payouts).set({ state, transferReference, proofDocumentId: context.body.proof_document_id ?? row.proofDocumentId, paidAt: state === 'PAID' ? new Date() : null, rowVersion: row.rowVersion + 1 }).where(eq(t.payouts.id, row.id));
  return one(tx, t.payouts, row.id);
}
