import { eq } from 'drizzle-orm';
import type { Services } from '../services.js';
import { auditLogs, paymentAttempts, paymentReceipts, refunds } from '../database/schema.js';
import { one } from '../shared/operations.js';
import { providerRequest, ProviderError } from '../integrations/providers.js';
import { finalizeRefund, refundChannel } from '../modules/settlement/service.js';

export async function processRefund(services: Services, payload: Record<string, unknown>) {
  const refundId = String(payload.refundId), userId = String(payload.userId), requestId = String(payload.requestId);
  const row = await one(services.db, refunds, refundId);
  const channel = await refundChannel(services.db, row.paymentReceiptId);
  if (channel.manual && !channel.api) return { state: 'REVIEW', result_type: 'refund', result_id: refundId };
  await services.db.transaction(async tx => {
    const locked = await one(tx, refunds, refundId, undefined, true);
    if (['SUCCEEDED', 'FAILED'].includes(locked.state)) return;
    if (!['APPROVED', 'PROCESSING', 'UNKNOWN'].includes(locked.state)) throw new Error('INVALID_REFUND_STATE');
    if (locked.state !== 'PROCESSING') await tx.update(refunds).set({ state: 'PROCESSING', rowVersion: locked.rowVersion + 1 }).where(eq(refunds.id, refundId));
    await tx.insert(auditLogs).values({ actorId: userId, entityType: 'refund', entityId: refundId, action: 'REFUND_API_STARTED',
      changesRedacted: { reference: locked.reference }, correlationId: requestId, reason: locked.reason });
  });
  const receipt = await one(services.db, paymentReceipts, row.paymentReceiptId);
  const attempt = await one(services.db, paymentAttempts, receipt.paymentAttemptId);
  const providerId = attempt.providerTransactionId ?? attempt.providerOrderId;
  let state: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN', reference: string | undefined;
  try {
    const response = await providerRequest(services.config, 'MIDTRANS', `/v2/${encodeURIComponent(providerId)}/refund/online/direct`, 'POST',
      { refund_key: row.reference, amount: row.amount, reason: row.reason.slice(0, 255) });
    reference = response.refund_chargeback_id == null ? undefined : String(response.refund_chargeback_id);
    if (String(response.status_code) === '202') state = 'FAILED';
    const status = await providerRequest(services.config, 'MIDTRANS', `/v2/${encodeURIComponent(providerId)}/status`);
    const verified = Array.isArray(status.refunds) ? status.refunds.find((item: any) => item.refund_key === row.reference && Number(item.refund_amount) === row.amount) : undefined;
    if (verified?.bank_confirmed_at) { state = 'SUCCEEDED'; reference = String(verified.refund_chargeback_id ?? reference ?? row.reference); }
  } catch (error) {
    if (error instanceof ProviderError && !error.ambiguous) state = 'FAILED';
    else state = 'UNKNOWN';
  }
  await services.db.transaction(tx => finalizeRefund(tx, refundId, state, { providerRefundId: reference, actorId: userId,
    requestId, reason: state === 'UNKNOWN' ? 'Provider refund result requires verification' : row.reason, channel: 'API' }));
  return { state: state === 'UNKNOWN' ? 'REVIEW' : state === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', result_type: 'refund', result_id: refundId };
}
