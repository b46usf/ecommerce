import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { orderCases, vendorOrders, vendorPayables } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { audit, one, operation, page, version } from '../../shared/operations.js';
import { boundedText } from '../catalog/policy.js';
import { refreshPayableEligibility, requireVendorOrder } from '../orders/service.js';

export async function registerCases(app: FastifyInstance) {
  operation(app, 'openBuyerCase', async ctx => {
    const order = await requireVendorOrder(ctx, ctx.params.vendorOrderId, true);
    if (order.fulfillmentStatus === 'CANCELLED' || order.fulfillmentStatus === 'COMPLETED') {
      throw new AppError(409, 'ORDER_CASE_WINDOW_CLOSED', 'Pesanan sudah ditutup.');
    }
    if (order.disputeDeadline && order.disputeDeadline.getTime() < Date.now()) {
      throw new AppError(409, 'ORDER_CASE_WINDOW_CLOSED', 'Masa komplain telah berakhir.');
    }
    const reason = boundedText(ctx.body.reason, 'reason', 2000);
    if (reason.length < 3) throw new AppError(422, 'INVALID_REASON', 'Alasan harus sedikitnya tiga karakter.');
    const [open] = await ctx.db.select({ id: orderCases.id }).from(orderCases)
      .where(and(eq(orderCases.vendorOrderId, order.id), eq(orderCases.state, 'OPEN'))).limit(1);
    if (open) throw new AppError(409, 'ORDER_CASE_ALREADY_OPEN', 'Pesanan masih memiliki kasus terbuka.');
    const id = randomUUID();
    await ctx.db.insert(orderCases).values({ id, vendorOrderId: order.id, openedBy: ctx.user.id,
      kind: ctx.body.kind, reason, state: 'OPEN' });
    await ctx.db.update(vendorOrders).set({ rowVersion: order.rowVersion + 1, updatedAt: new Date() }).where(eq(vendorOrders.id, order.id));
    await ctx.db.update(vendorPayables).set({ eligibility: 'BLOCKED', eligibleAt: null,
      rowVersion: sql`${vendorPayables.rowVersion} + 1`, updatedAt: new Date() })
      .where(eq(vendorPayables.vendorOrderId, order.id));
    await audit(ctx, 'order_case', id, 'OPEN', { vendor_order_id: order.id, kind: ctx.body.kind });
    return one(ctx.db, orderCases, id);
  });

  operation(app, 'getBuyerCase', async ctx => {
    const row = await one(ctx.db, orderCases, ctx.params.caseId);
    await requireVendorOrder(ctx, row.vendorOrderId);
    return row;
  });

  operation(app, 'listCases', async ctx => page(ctx.db, orderCases, ctx.query, ['admin-order-cases']));

  operation(app, 'resolveCase', async ctx => {
    const initial = await one(ctx.db, orderCases, ctx.params.caseId);
    const order = await requireVendorOrder(ctx, initial.vendorOrderId, true);
    const row = await one(ctx.db, orderCases, ctx.params.caseId, undefined, true);
    version(ctx.request, row);
    if (row.state !== 'OPEN') throw new AppError(409, 'CASE_ALREADY_CLOSED', 'Kasus sudah ditutup.');
    const resolution = boundedText(ctx.body.reason, 'reason', 2000);
    if (resolution.length < 3) throw new AppError(422, 'INVALID_REASON', 'Penyelesaian harus sedikitnya tiga karakter.');
    const updated = { state: 'RESOLVED', resolution, resolvedBy: ctx.user.id, resolvedAt: new Date(), rowVersion: row.rowVersion + 1 };
    await ctx.db.update(orderCases).set(updated).where(eq(orderCases.id, row.id));
    await ctx.db.update(vendorOrders).set({ rowVersion: order.rowVersion + 1, updatedAt: new Date() }).where(eq(vendorOrders.id, order.id));
    // Recompute after resolution; an unsettled refund or unavailable provider funds continues to block payouts.
    await refreshPayableEligibility(ctx.db, order);
    await audit(ctx, 'order_case', row.id, 'RESOLVE', { before: 'OPEN', after: 'RESOLVED', vendor_order_id: order.id });
    return { ...row, ...updated };
  });
}
