import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/index.js';
import * as t from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { audit, one, operation, page, version } from '../../shared/operations.js';
import { approveRefund, createPayout, createRefund, finalizeRefund, recordPayout, refundDetail, validatePayout } from './service.js';
import { reason } from './policy.js';

export { finalizeRefund } from './service.js';

export async function settlementRoutes(app: FastifyInstance) {
  operation(app, 'listPaymentReceipts', async context => {
    const result = await page(context.db, t.paymentReceipts, context.query, { operation: 'payment-receipts', order: context.query.order_group_id },
      context.query.order_group_id ? eq(t.paymentReceipts.checkoutGroupId, context.query.order_group_id) : undefined);
    return { ...result, items: await Promise.all(result.items.map(async (row: typeof t.paymentReceipts.$inferSelect) => {
      const refunds = await context.db.select({ amount: t.refunds.amount, state: t.refunds.state }).from(t.refunds).where(eq(t.refunds.paymentReceiptId, row.id));
      const reserved = refunds.filter(item => !['FAILED', 'REJECTED'].includes(item.state)).reduce((sum, item) => sum + BigInt(item.amount), 0n);
      return { ...row, orderGroupId: row.checkoutGroupId, refundableAmount: Number(BigInt(row.amount) > reserved ? BigInt(row.amount) - reserved : 0n) };
    })) };
  });
  operation(app, 'createRefund', async context => {
    const result = await createRefund(context);
    await audit(context, 'refund', result.id, 'CREATE_REFUND', { amount: result.amount, payment_receipt_id: result.paymentReceiptId });
    return result;
  });
  operation(app, 'listAdminRefunds', async context => {
    const result = await page(context.db, t.refunds, context.query, { operation: 'admin-refunds' });
    return { ...result, items: await Promise.all(result.items.map((row: any) => refundDetail(context.db, row.id))) };
  });
  operation(app, 'getRefund', context => refundDetail(context.db, context.params.refundId));
  operation(app, 'approveRefund', async context => {
    const row = await one(context.db, t.refunds, context.params.refundId, undefined, true);
    version(context.request, row); reason(context.body.reason);
    const result = await approveRefund(context, row);
    await audit(context, 'refund', row.id, 'APPROVE_REFUND', { amount: row.amount });
    return result;
  });
  operation(app, 'recordManualRefund', async context => {
    const row = await one(context.db, t.refunds, context.params.refundId, undefined, true);
    version(context.request, row);
    return finalizeRefund(context.db as DatabaseTransaction, row.id, context.body.state, { channel: 'MANUAL', providerRefundId: context.body.external_reference, proofDocumentId: context.body.proof_document_id, actorId: context.user.id, requestId: context.request.id, reason: context.body.reason });
  });
  operation(app, 'createPayout', async context => {
    const result = await createPayout(context);
    await audit(context, 'payout', result.id, 'CREATE_PAYOUT', { amount: result.amount, store_id: result.storeId });
    return result;
  });
  operation(app, 'getPayout', context => one(context.db, t.payouts, context.params.payoutId));
  operation(app, 'approvePayout', async context => {
    const row = await one(context.db, t.payouts, context.params.payoutId, undefined, true);
    version(context.request, row); reason(context.body.reason);
    if (row.state !== 'DRAFT') throw new AppError(409, 'INVALID_PAYOUT_STATE', 'Hanya batch DRAFT yang dapat disetujui.');
    if (row.requestedBy === context.user.id) throw new AppError(403, 'MAKER_CHECKER_REQUIRED', 'Pemeriksa pencairan harus berbeda dari pembuat batch.');
    await validatePayout(context.db as DatabaseTransaction, row);
    await context.db.update(t.payouts).set({ state: 'APPROVED', approvedBy: context.user.id, rowVersion: row.rowVersion + 1 }).where(eq(t.payouts.id, row.id));
    await audit(context, 'payout', row.id, 'APPROVE_PAYOUT', { amount: row.amount });
    return one(context.db, t.payouts, row.id);
  });
  operation(app, 'startManualPayout', async context => {
    const row = await one(context.db, t.payouts, context.params.payoutId, undefined, true);
    version(context.request, row); reason(context.body.reason);
    if (row.state !== 'APPROVED') throw new AppError(409, 'INVALID_PAYOUT_STATE', 'Hanya batch APPROVED yang dapat mulai diproses.');
    await validatePayout(context.db as DatabaseTransaction, row);
    await context.db.update(t.payouts).set({ state: 'PROCESSING', rowVersion: row.rowVersion + 1 }).where(eq(t.payouts.id, row.id));
    await audit(context, 'payout', row.id, 'START_MANUAL_PAYOUT', { amount: row.amount });
    return one(context.db, t.payouts, row.id);
  });
  operation(app, 'recordPayoutResult', async context => {
    const row = await one(context.db, t.payouts, context.params.payoutId, undefined, true);
    version(context.request, row);
    const result = await recordPayout(context, row);
    await audit(context, 'payout', row.id, 'RECORD_PAYOUT_RESULT', { previous_state: row.state, state: result.state, amount: result.amount });
    return result;
  });
  operation(app, 'listJournals', async context => {
    const result = await page(context.db, t.journalEntries, context.query, { operation: 'journals' });
    return { ...result, items: await Promise.all(result.items.map(async (row: any) => ({ ...row, lines: await context.db.select({ account_code: t.ledgerAccounts.code, debit: t.journalLines.debit, credit: t.journalLines.credit }).from(t.journalLines).innerJoin(t.ledgerAccounts, eq(t.ledgerAccounts.id, t.journalLines.ledgerAccountId)).where(eq(t.journalLines.journalEntryId, row.id)).orderBy(asc(t.journalLines.lineNo)) }))) };
  });
  operation(app, 'listAuditLogs', async context => {
    const result = await page(context.db, t.auditLogs, context.query, { operation: 'audit-logs' });
    return { ...result, items: result.items.map((row: any) => ({ ...row, rowVersion: 0 })) };
  });
}
