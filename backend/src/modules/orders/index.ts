import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/index.js';
import { checkoutGroups, paymentReceipts, payouts, refunds, shipments, vendorOrders, vendorPayables } from '../../database/schema.js';
import { one, operation, page, version } from '../../shared/operations.js';
import { boundedText } from '../catalog/policy.js';
import { completeVendorOrderInTransaction, orderGroup, refundView, requireVendorOrder, safeAmount, shipmentView, vendorOrder } from './service.js';

export async function registerOrders(app: FastifyInstance) {
  operation(app, 'listBuyerOrders', async ctx => {
    const result = await page(ctx.db, checkoutGroups, ctx.query, ['buyer-orders', ctx.params.buyerAccountId],
      eq(checkoutGroups.buyerAccountId, ctx.params.buyerAccountId));
    return { ...result, items: await Promise.all(result.items.map((row: typeof checkoutGroups.$inferSelect) => orderGroup(ctx.db, row))) };
  });
  operation(app, 'getBuyerOrder', async ctx => orderGroup(ctx.db,
    await one(ctx.db, checkoutGroups, ctx.params.orderGroupId, eq(checkoutGroups.buyerAccountId, ctx.params.buyerAccountId))));

  operation(app, 'listVendorOrders', async ctx => {
    const result = await page(ctx.db, vendorOrders, ctx.query, ['vendor-orders', ctx.params.storeId], eq(vendorOrders.storeId, ctx.params.storeId));
    return { ...result, items: await Promise.all(result.items.map((row: typeof vendorOrders.$inferSelect) => vendorOrder(ctx.db, row, true))) };
  });
  operation(app, 'getVendorOrder', async ctx => vendorOrder(ctx.db, await requireVendorOrder(ctx, ctx.params.vendorOrderId), true));

  for (const id of ['getBuyerShipment', 'getVendorShipment']) operation(app, id, async ctx => {
    const shipment = await one(ctx.db, shipments, ctx.params.shipmentId);
    await requireVendorOrder(ctx, shipment.vendorOrderId);
    return shipmentView(ctx.db, shipment);
  });

  operation(app, 'confirmReceipt', async ctx => {
    const order = await requireVendorOrder(ctx, ctx.params.vendorOrderId, true);
    version(ctx.request, order);
    return completeVendorOrderInTransaction(ctx.db as DatabaseTransaction, order.id, ctx.user.id, ctx.request.id, { requireDeadline: false });
  });

  operation(app, 'completeOrderByAdmin', async ctx => {
    const order = await requireVendorOrder(ctx, ctx.params.vendorOrderId, true);
    version(ctx.request, order);
    return completeVendorOrderInTransaction(ctx.db as DatabaseTransaction, order.id, ctx.user.id, ctx.request.id,
      { requireDeadline: true, reason: boundedText(ctx.body.reason, 'reason', 2000) });
  });

  operation(app, 'listVendorPayables', async ctx => {
    const orders = ctx.db.select({ id: vendorOrders.id }).from(vendorOrders).where(eq(vendorOrders.storeId, ctx.params.storeId));
    const result = await page(ctx.db, vendorPayables, ctx.query, ['vendor-payables', ctx.params.storeId], inArray(vendorPayables.vendorOrderId, orders));
    return { ...result, items: result.items.map((row: typeof vendorPayables.$inferSelect) => ({ ...row,
      balance: safeAmount(BigInt(row.accruedAmount) + BigInt(row.adjustmentAmount) - BigInt(row.paidAmount)),
      reservedPayout: row.reservedPayoutAmount })) };
  });
  operation(app, 'listVendorPayouts', async ctx => page(ctx.db, payouts, ctx.query, ['vendor-payouts', ctx.params.storeId], eq(payouts.storeId, ctx.params.storeId)));

  operation(app, 'listBuyerRefunds', async ctx => {
    const receipts = ctx.db.select({ id: paymentReceipts.id }).from(paymentReceipts)
      .innerJoin(checkoutGroups, eq(checkoutGroups.id, paymentReceipts.checkoutGroupId))
      .where(and(eq(checkoutGroups.buyerAccountId, ctx.params.buyerAccountId)));
    const result = await page(ctx.db, refunds, ctx.query, ['buyer-refunds', ctx.params.buyerAccountId], inArray(refunds.paymentReceiptId, receipts));
    return { ...result, items: await Promise.all(result.items.map((row: typeof refunds.$inferSelect) => refundView(ctx.db, row))) };
  });
}
