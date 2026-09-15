import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { quoteRequests, quoteRequestLines, quoteVersions, quoteLines, cartItems, carts } from '../../database/schema.js';
import { operation, one, page, activeAddress, version, audit, type Context, present } from '../../shared/operations.js';
import { lockCart, quantity, skuSnapshot } from '../cart/index.js';
import { AppError } from '../../shared/errors.js';
import type { DatabaseExecutor } from '../../database/index.js';

function requestLine(row: typeof quoteRequestLines.$inferSelect) {
  return { sku_id: row.skuId, quantity: row.quantity,
    product_name: String(row.productSnapshot.product_name ?? ''), sku_code: String(row.productSnapshot.sku_code ?? '') };
}
function offeredLine(row: typeof quoteLines.$inferSelect) {
  return { id: row.id, sku_id: row.skuId, quantity: row.quantity, unit_price_gross: row.unitPriceGross,
    product_name: String(row.itemSnapshot.product_name ?? ''), sku_code: String(row.itemSnapshot.sku_code ?? '') };
}
export async function quoteVersion(db: DatabaseExecutor, id: string) { return { ...await one(db, quoteVersions, id),
  items: (await db.select().from(quoteLines).where(eq(quoteLines.quoteVersionId, id))).map(offeredLine) }; }
async function quoteRequest(db: DatabaseExecutor, id: string) {
  const row = await one(db, quoteRequests, id);
  const versions = await db.select({ id: quoteVersions.id }).from(quoteVersions).where(eq(quoteVersions.quoteRequestId, id)).orderBy(quoteVersions.versionNo);
  return { ...row, items: (await db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id))).map(requestLine),
    versions: await Promise.all(versions.map(row => quoteVersion(db, row.id))) };
}
function scope(ctx: Context) { return ctx.params.storeId ? eq(quoteRequests.storeId, ctx.params.storeId) : eq(quoteRequests.buyerAccountId, ctx.params.buyerAccountId); }
export async function rfqRoutes(app: FastifyInstance) {
  operation(app, 'createQuoteRequest', async ctx => {
    if (ctx.body.items.length > 100 || new Set(ctx.body.items.map((line: any) => line.sku_id)).size !== ctx.body.items.length) throw new AppError(422, 'INVALID_QUOTE_ITEMS', 'Maksimal 100 SKU unik.');
    const address = await activeAddress(ctx.db, ctx.params.buyerAccountId, ctx.body.address_id);
    const id = randomUUID();
    await ctx.db.insert(quoteRequests).values({ id, buyerAccountId: ctx.params.buyerAccountId, storeId: ctx.body.store_id, requestedBy: ctx.user.id, addressSnapshot: { schema_version: 1, ...present('AddressWrite', address) }, notes: ctx.body.notes ?? null });
    for (const line of ctx.body.items) { const { snapshot } = await skuSnapshot(ctx.db, line.sku_id, ctx.body.store_id); await ctx.db.insert(quoteRequestLines).values({ quoteRequestId: id, storeId: ctx.body.store_id, skuId: line.sku_id, quantity: quantity(line.quantity), productSnapshot: snapshot }); }
    return quoteRequest(ctx.db, id);
  });
  for (const id of ['listBuyerQuotes','listVendorQuotes']) operation(app, id, async ctx => {
    const result = await page(ctx.db, quoteRequests, ctx.query, [id, ctx.params], scope(ctx));
    return { ...result, items: await Promise.all(result.items.map((row: any) => quoteRequest(ctx.db, row.id))) };
  });
  for (const id of ['getBuyerQuote','getVendorQuote']) operation(app, id, async ctx => { await one(ctx.db, quoteRequests, ctx.params.quoteRequestId, scope(ctx)); return quoteRequest(ctx.db, ctx.params.quoteRequestId); });
  operation(app, 'offerQuote', async ctx => {
    const request = await one(ctx.db, quoteRequests, ctx.params.quoteRequestId, scope(ctx), true); version(ctx.request, request);
    if (!['SUBMITTED','OFFERED'].includes(request.status)) throw new AppError(409, 'INVALID_STATE', 'Permintaan sudah ditutup.');
    const previous = await ctx.db.select().from(quoteVersions).where(eq(quoteVersions.quoteRequestId, request.id)).for('update');
    if (previous.some(row => row.status === 'ACCEPTED')) throw new AppError(409, 'QUOTE_ACCEPTED', 'Penawaran yang diterima tidak dapat diubah.');
    const requested = await ctx.db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, request.id));
    if (ctx.body.items.length !== requested.length || new Set(ctx.body.items.map((line: any) => line.sku_id)).size !== requested.length || ctx.body.items.some((line: any) => !requested.some(row => row.skuId === line.sku_id && row.quantity === line.quantity))) throw new AppError(422, 'QUOTE_ITEMS_MISMATCH', 'Penawaran harus mencakup seluruh SKU dan jumlah permintaan.');
    const expiresAt = new Date(ctx.body.expires_at); if (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 30 * 86400000) throw new AppError(422, 'INVALID_EXPIRY', 'Masa penawaran harus antara sekarang dan 30 hari.');
    await ctx.db.update(quoteVersions).set({ status: 'SUPERSEDED', rowVersion: sql`${quoteVersions.rowVersion} + 1` }).where(and(eq(quoteVersions.quoteRequestId, request.id), eq(quoteVersions.status, 'OFFERED')));
    const id = randomUUID(); await ctx.db.insert(quoteVersions).values({ id, quoteRequestId: request.id, versionNo: Math.max(0, ...previous.map(row => row.versionNo)) + 1, expiresAt });
    for (const line of ctx.body.items) { const { snapshot } = await skuSnapshot(ctx.db, line.sku_id, request.storeId); await ctx.db.insert(quoteLines).values({ quoteVersionId: id, skuId: line.sku_id, quantity: quantity(line.quantity), unitPriceGross: line.unit_price_gross, itemSnapshot: snapshot }); }
    await ctx.db.update(quoteRequests).set({ status: 'OFFERED', rowVersion: request.rowVersion + 1 }).where(eq(quoteRequests.id, request.id));
    await audit(ctx, 'QUOTE', request.id, 'OFFER_QUOTE'); return quoteVersion(ctx.db, id);
  });
  operation(app, 'rejectQuoteRequest', async ctx => {
    const row = await one(ctx.db, quoteRequests, ctx.params.quoteRequestId, scope(ctx), true); version(ctx.request, row);
    const accepted = await ctx.db.select({ id: quoteVersions.id }).from(quoteVersions).where(and(eq(quoteVersions.quoteRequestId, row.id), inArray(quoteVersions.status, ['ACCEPTED','CONSUMED'])));
    if (accepted.length || !['SUBMITTED','OFFERED'].includes(row.status)) throw new AppError(409, 'INVALID_STATE', 'Permintaan tidak dapat ditolak.');
    await ctx.db.update(quoteVersions).set({ status: 'DECLINED' }).where(and(eq(quoteVersions.quoteRequestId, row.id), eq(quoteVersions.status, 'OFFERED')));
    await ctx.db.update(quoteRequests).set({ status: 'REJECTED', rowVersion: row.rowVersion + 1 }).where(eq(quoteRequests.id, row.id));
    await audit(ctx, 'QUOTE', row.id, 'REJECT_QUOTE'); return quoteRequest(ctx.db, row.id);
  });
  for (const id of ['acceptQuote','declineQuote']) operation(app, id, async ctx => {
    const cart = await lockCart(ctx.db, ctx.params.buyerAccountId);
    const candidate = await one(ctx.db, quoteVersions, ctx.params.quoteVersionId);
    await one(ctx.db, quoteRequests, candidate.quoteRequestId, eq(quoteRequests.buyerAccountId, ctx.params.buyerAccountId), true);
    const row = await one(ctx.db, quoteVersions, candidate.id, undefined, true); version(ctx.request, row);
    if (row.status !== 'OFFERED' || row.expiresAt <= new Date()) throw new AppError(409, 'QUOTE_UNAVAILABLE', 'Penawaran sudah kedaluwarsa atau tidak tersedia.');
    const accept = id === 'acceptQuote';
    await ctx.db.update(quoteVersions).set({ status: accept ? 'ACCEPTED' : 'DECLINED', acceptedBy: accept ? ctx.user.id : null, acceptedAt: accept ? new Date() : null, rowVersion: row.rowVersion + 1 }).where(eq(quoteVersions.id, row.id));
    if (accept) {
      const lines = await ctx.db.select().from(quoteLines).where(eq(quoteLines.quoteVersionId, row.id));
      for (const line of lines) { await skuSnapshot(ctx.db, line.skuId); await ctx.db.insert(cartItems).values({ cartId: cart.id, skuId: line.skuId, quoteLineId: line.id, quantity: line.quantity }); }
      await ctx.db.update(carts).set({ rowVersion: cart.rowVersion + 1 }).where(eq(carts.id, cart.id));
    }
    await audit(ctx, 'QUOTE_VERSION', row.id, id); return quoteVersion(ctx.db, row.id);
  });
}
