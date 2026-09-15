import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseExecutor, DatabaseTransaction } from '../../database/index.js';
import { auditLogs, checkoutGroups, journalEntries, journalLines, ledgerAccounts, orderCases, orderItems,
  paymentAttempts, paymentReceipts, refundLines, refunds, shipmentEvents, shipments, vendorOrders, vendorPayables } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { one, present, type Context } from '../../shared/operations.js';
import { requireAdminRole } from '../auth/index.js';

type Group = typeof checkoutGroups.$inferSelect;
type Order = typeof vendorOrders.$inferSelect;
const unsettledRefundStates = ['REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN'];

export function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(409, 'AMOUNT_OVERFLOW', 'Nilai agregat melampaui batas nominal API.');
  }
  return Number(value);
}

/** The group lock precedes its vendor order lock, shared by completion/cases/refunds/payouts. */
export async function requireVendorOrder(ctx: Context, id: string, lock = false): Promise<Order> {
  const target = await one(ctx.db, vendorOrders, id,
    ctx.params.storeId ? eq(vendorOrders.storeId, ctx.params.storeId) : undefined);
  const group = await one(ctx.db, checkoutGroups, target.checkoutGroupId,
    ctx.params.buyerAccountId ? eq(checkoutGroups.buyerAccountId, ctx.params.buyerAccountId) : undefined, lock);
  if (!ctx.params.storeId && !ctx.params.buyerAccountId) await requireAdminRole(ctx.request, ['OPERATIONS', 'FINANCE', 'FINANCE_APPROVER']);
  return lock ? one(ctx.db, vendorOrders, id, eq(vendorOrders.checkoutGroupId, group.id), true) : target;
}

export async function vendorOrder(db: DatabaseExecutor, row: Order, privateView = false) {
  const items = await db.select().from(orderItems).where(eq(orderItems.vendorOrderId, row.id)).orderBy(asc(orderItems.id));
  const [shipment] = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.vendorOrderId, row.id)).limit(1);
  const mappedItems = items.map(item => ({ ...item,
    productName: String(item.productSnapshot.product_name ?? item.productSnapshot.name ?? ''),
    skuCode: String(item.productSnapshot.sku_code ?? item.productSnapshot.skuCode ?? ''),
  }));
  if (!privateView) return present('VendorOrderBuyer', { ...row, items: mappedItems, shipmentId: shipment?.id ?? null });
  const group = await one(db, checkoutGroups, row.checkoutGroupId);
  const [payable] = await db.select().from(vendorPayables).where(eq(vendorPayables.vendorOrderId, row.id)).limit(1);
  const payableAmount = payable ? BigInt(payable.accruedAmount) + BigInt(payable.adjustmentAmount) - BigInt(payable.paidAmount) :
    BigInt(row.itemsGross) - BigInt(row.commissionAmount) - BigInt(row.commissionVat) - BigInt(row.sellerWithholding);
  return present('VendorOrderPrivate', { ...row, items: mappedItems, shipmentId: shipment?.id ?? null,
    recipient: group.recipientSnapshot, payableAmount: safeAmount(payableAmount) });
}

export async function orderGroup(db: DatabaseExecutor, group: Group) {
  const orders = await db.select().from(vendorOrders).where(eq(vendorOrders.checkoutGroupId, group.id)).orderBy(asc(vendorOrders.id));
  const receipts = await db.select().from(paymentReceipts).where(eq(paymentReceipts.checkoutGroupId, group.id));
  const applied = receipts.find(receipt => receipt.applicationStatus === 'APPLIED');
  let paymentStatus = 'UNPAID';
  if (receipts.some(receipt => receipt.applicationStatus !== 'APPLIED')) paymentStatus = 'REVIEW';
  else if (applied) {
    const returned = await db.select({ amount: refunds.amount }).from(refunds)
      .where(and(eq(refunds.paymentReceiptId, applied.id), eq(refunds.state, 'SUCCEEDED')));
    const refundAmount = returned.reduce((total, row) => total + BigInt(row.amount), 0n);
    paymentStatus = refundAmount >= BigInt(applied.amount) ? 'REFUNDED' : refundAmount > 0n ? 'PARTIALLY_REFUNDED' : 'PAID';
  } else {
    const attempts = await db.select({ state: paymentAttempts.state }).from(paymentAttempts).where(eq(paymentAttempts.checkoutGroupId, group.id));
    if (attempts.some(attempt => attempt.state === 'UNKNOWN')) paymentStatus = 'REVIEW';
    else if (attempts.some(attempt => attempt.state !== 'TERMINAL')) paymentStatus = 'PENDING';
  }
  const itemsNet = orders.reduce((total, order) => total + BigInt(order.itemsNet), 0n);
  const itemsVat = orders.reduce((total, order) => total + BigInt(order.itemsVat), 0n);
  return present('OrderGroup', { ...group, paymentStatus, recipient: group.recipientSnapshot, totals: {
    itemsNet: safeAmount(itemsNet), itemsVat: safeAmount(itemsVat), itemsGross: group.itemsGross,
    shipping: group.shippingTotal, buyerFee: group.buyerFeeTotal, platformDiscount: group.platformDiscount,
    grandTotal: group.grandTotal, currency: group.currency,
  }, vendorOrders: await Promise.all(orders.map(order => vendorOrder(db, order))) });
}

export async function getOrderGroup(db: DatabaseExecutor, id: string) {
  return orderGroup(db, await one(db, checkoutGroups, id));
}

export async function shipmentView(db: DatabaseExecutor, shipment: typeof shipments.$inferSelect) {
  const events = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.shipmentId, shipment.id),
    eq(shipmentEvents.verificationStatus, 'VERIFIED'), eq(shipmentEvents.processingStatus, 'DONE')))
    .orderBy(desc(shipmentEvents.providerOccurredAt), desc(shipmentEvents.id)).limit(100);
  return present('Shipment', { ...shipment, trackingEvents: events.map(event => ({ status: event.eventType,
    occurredAt: event.providerOccurredAt ?? event.processedAt ?? event.createdAt,
    // Never return raw provider payload references or webhook bodies in tracking responses.
    description: event.eventType.replace(/_/g, ' '),
  })) });
}

export async function refundView(db: DatabaseExecutor, refund: typeof refunds.$inferSelect) {
  const lines = await db.select().from(refundLines).where(eq(refundLines.refundId, refund.id)).orderBy(asc(refundLines.id));
  return present('Refund', { ...refund, lines });
}

export async function assertNoOrderBlocks(db: DatabaseExecutor, orderId: string) {
  const [openCase] = await db.select({ id: orderCases.id }).from(orderCases)
    .where(and(eq(orderCases.vendorOrderId, orderId), eq(orderCases.state, 'OPEN'))).limit(1);
  if (openCase) throw new AppError(409, 'ORDER_CASE_OPEN', 'Pesanan memiliki kasus terbuka.');
  const [pendingRefund] = await db.select({ id: refunds.id }).from(refunds).innerJoin(refundLines, eq(refundLines.refundId, refunds.id))
    .where(and(eq(refundLines.vendorOrderId, orderId), inArray(refunds.state, unsettledRefundStates))).limit(1);
  if (pendingRefund) throw new AppError(409, 'ORDER_REFUND_PENDING', 'Pesanan memiliki refund yang belum selesai.');
}

/** Called while holding checkout -> vendor_order locks; never schedules or executes a transfer. */
export async function refreshPayableEligibility(db: DatabaseExecutor, order: Order) {
  const [payable] = await db.select().from(vendorPayables).where(eq(vendorPayables.vendorOrderId, order.id)).limit(1).for('update');
  if (!payable) return;
  const [receipt] = await db.select().from(paymentReceipts)
    .where(and(eq(paymentReceipts.checkoutGroupId, order.checkoutGroupId), eq(paymentReceipts.applicationStatus, 'APPLIED'))).limit(1);
  let blocked = false;
  try { await assertNoOrderBlocks(db, order.id); } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) blocked = true; else throw error;
  }
  const available = BigInt(payable.accruedAmount) + BigInt(payable.adjustmentAmount) - BigInt(payable.paidAmount) - BigInt(payable.reservedPayoutAmount);
  const eligible = order.fulfillmentStatus === 'COMPLETED' && !blocked &&
    receipt?.providerFundsAvailableAt !== null && receipt?.providerFundsAvailableAt !== undefined &&
    receipt.providerFundsAvailableAt.getTime() <= Date.now() && available > 0n;
  await db.update(vendorPayables).set({ eligibility: eligible ? 'ELIGIBLE' : 'BLOCKED',
    eligibleAt: eligible ? payable.eligibleAt ?? new Date() : null,
    rowVersion: payable.rowVersion + 1, updatedAt: new Date() }).where(eq(vendorPayables.id, payable.id));
}

export async function deferredCommission(db: DatabaseExecutor, orderId: string): Promise<bigint> {
  const [sum] = await db.select({ credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)` }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.ledgerAccountId))
    .where(and(eq(journalLines.vendorOrderId, orderId), eq(ledgerAccounts.code, 'DEFERRED_COMMISSION'), eq(journalEntries.status, 'POSTED')));
  return BigInt(sum?.credit ?? 0) - BigInt(sum?.debit ?? 0);
}

export async function completeVendorOrderInTransaction(tx: DatabaseTransaction, id: string, actorId: string, requestId: string,
  options: { requireDeadline?: boolean; reason?: string } = {}) {
  const initial = await one(tx, vendorOrders, id);
  const group: Group = await one(tx, checkoutGroups, initial.checkoutGroupId, undefined, true);
  const order: Order = await one(tx, vendorOrders, id, undefined, true);
  if (order.fulfillmentStatus === 'COMPLETED') return vendorOrder(tx, order, true);
  if (order.fulfillmentStatus !== 'DELIVERED' || !['ACTIVE', 'COMPLETED'].includes(group.orderState)) {
    throw new AppError(409, 'ORDER_NOT_DELIVERED', 'Pesanan aktif harus sudah berstatus delivered sebelum diselesaikan.');
  }
  const [shipment] = await tx.select().from(shipments).where(eq(shipments.vendorOrderId, id)).limit(1).for('update');
  if (!shipment || shipment.state !== 'DELIVERED' || shipment.deliveredAt === null) throw new AppError(409, 'DELIVERY_UNVERIFIED', 'Konfirmasi pengiriman delivered belum tersedia.');
  if ((options.requireDeadline ?? true) && (!order.disputeDeadline || order.disputeDeadline.getTime() > Date.now())) {
    throw new AppError(409, 'DISPUTE_WINDOW_OPEN', 'Masa komplain belum berakhir.');
  }
  await assertNoOrderBlocks(tx, id);
  const [receipt] = await tx.select().from(paymentReceipts)
    .where(and(eq(paymentReceipts.checkoutGroupId, group.id), eq(paymentReceipts.applicationStatus, 'APPLIED'))).limit(1);
  if (!receipt) throw new AppError(409, 'PAYMENT_NOT_APPLIED', 'Pembayaran pesanan belum terverifikasi.');
  const now = new Date();
  await tx.update(vendorOrders).set({ fulfillmentStatus: 'COMPLETED', completedAt: now,
    rowVersion: order.rowVersion + 1, updatedAt: now }).where(eq(vendorOrders.id, id));
  // Recognize only the remaining posted deferred commission; successful refunds may already have reversed part of it.
  const amount = await deferredCommission(tx, id);
  if (amount < 0n) throw new AppError(409, 'COMMISSION_RECONCILIATION_REQUIRED', 'Saldo komisi ditangguhkan perlu direkonsiliasi.');
  if (amount > 0n) {
    const { ensureAccount, postJournalInTransaction } = await import('../ledger/service.js');
    const deferred = await ensureAccount(tx, 'DEFERRED_COMMISSION', 'LIABILITY');
    const revenue = await ensureAccount(tx, 'COMMISSION_REVENUE', 'INCOME');
    await postJournalInTransaction(tx, { eventKey: `commission-recognized:${id}`, description: 'Pengakuan komisi pesanan selesai',
      lines: [{ accountId: deferred, vendorOrderId: id, debit: amount, credit: 0n },
        { accountId: revenue, vendorOrderId: id, debit: 0n, credit: amount }] });
  }
  const completed = { ...order, fulfillmentStatus: 'COMPLETED', completedAt: now, rowVersion: order.rowVersion + 1 };
  await refreshPayableEligibility(tx, completed);
  const siblings = await tx.select({ state: vendorOrders.fulfillmentStatus }).from(vendorOrders).where(eq(vendorOrders.checkoutGroupId, group.id));
  const allComplete = siblings.every(row => row.state === 'COMPLETED' || row.state === 'CANCELLED');
  await tx.update(checkoutGroups).set({ orderState: allComplete ? 'COMPLETED' : group.orderState,
    rowVersion: group.rowVersion + 1, updatedAt: now }).where(eq(checkoutGroups.id, group.id));
  await tx.insert(auditLogs).values({ actorId, entityType: 'vendor_order', entityId: id, action: 'COMPLETE',
    changesRedacted: { before: order.fulfillmentStatus, after: 'COMPLETED', commission_recognized: safeAmount(amount) },
    correlationId: requestId, reason: options.reason ?? 'Buyer confirmed receipt' });
  return vendorOrder(tx, completed, true);
}
