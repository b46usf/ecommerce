import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DatabaseExecutor } from '../../database/index.js';
import { buyerAccounts, carts, cartItems, skus, products, stores, inventoryBalances, productMedia, quoteLines, quoteVersions } from '../../database/schema.js';
import { operation, one, version } from '../../shared/operations.js';
import { AppError } from '../../shared/errors.js';

export function quantity(value: number) { if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new AppError(422, 'INVALID_QUANTITY', 'Jumlah harus integer positif yang didukung persediaan.'); return value; }
export async function lockCart(db: DatabaseExecutor, buyerId: string) {
  await one(db, buyerAccounts, buyerId, undefined, true);
  await db.insert(carts).values({ buyerAccountId: buyerId }).onDuplicateKeyUpdate({ set: { buyerAccountId: buyerId } });
  const [cart] = await db.select().from(carts).where(eq(carts.buyerAccountId, buyerId)).for('update');
  return cart!;
}
export async function skuSnapshot(db: DatabaseExecutor, skuId: string, storeId?: string) {
  const sku = await one(db, skus, skuId, and(eq(skus.status, 'ACTIVE'), storeId ? eq(skus.storeId, storeId) : undefined));
  const product = await one(db, products, sku.productId, eq(products.status, 'ACTIVE'));
  await one(db, stores, sku.storeId, eq(stores.status, 'ACTIVE'));
  return { sku, product, snapshot: { schema_version: 1, product_name: product.name, sku_code: sku.skuCode, variant: sku.variantAttributes, unit_label: sku.unitLabel, weight_g: sku.weightG, dimensions_cm: { length: sku.lengthCm, width: sku.widthCm, height: sku.heightCm } } };
}
export async function readCart(db: DatabaseExecutor, cart: typeof carts.$inferSelect, mediaBaseUrl: string) {
  const rows = await db.select({ item: cartItems, sku: skus, quote: quoteLines, product: products, store: stores,
    onHand: inventoryBalances.onHand, reserved: inventoryBalances.reserved })
    .from(cartItems).innerJoin(skus, eq(skus.id, cartItems.skuId)).innerJoin(products, eq(products.id, skus.productId))
    .innerJoin(stores, eq(stores.id, skus.storeId)).innerJoin(inventoryBalances, eq(inventoryBalances.skuId, skus.id))
    .leftJoin(quoteLines, eq(quoteLines.id, cartItems.quoteLineId)).where(eq(cartItems.cartId, cart.id)).orderBy(cartItems.id);
  const productIds = [...new Set(rows.map(row => row.product.id))];
  const images = productIds.length
    ? await db.select().from(productMedia).where(and(inArray(productMedia.productId, productIds), eq(productMedia.sortOrder, 0)))
    : [];
  const imageByProduct = new Map(images.map(item => [item.productId,
    `${mediaBaseUrl.replace(/\/$/, '')}/${item.objectKey.split('/').map(encodeURIComponent).join('/')}`]));
  return { buyer_account_id: cart.buyerAccountId, row_version: cart.rowVersion, items: rows.map(({ item, sku, quote, product, store, onHand, reserved }) => ({
    id: item.id, created_at: item.createdAt.toISOString(), row_version: item.rowVersion,
    sku_id: item.skuId, quote_line_id: item.quoteLineId, quantity: item.quantity,
    unit_price_gross: quote?.unitPriceGross ?? sku.unitPriceGross, store_id: sku.storeId,
    product_id: product.id, product_name: product.name, sku_code: sku.skuCode,
    variant_attributes: sku.variantAttributes, available_quantity: onHand - reserved,
    product_status: product.status, sku_status: sku.status, store_name: store.name,
    image_url: imageByProduct.get(product.id) ?? null,
  })) };
}
export async function cartRoutes(app: FastifyInstance) {
  operation(app, 'getCart', async ctx => readCart(ctx.db, await lockCart(ctx.db, ctx.params.buyerAccountId), app.services.config.mediaBaseUrl), { transaction: true });
  operation(app, 'addCartItem', async ctx => {
    const cart = await lockCart(ctx.db, ctx.params.buyerAccountId); version(ctx.request, cart);
    await skuSnapshot(ctx.db, ctx.body.sku_id);
    const [item] = await ctx.db.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.skuId, ctx.body.sku_id), isNull(cartItems.quoteLineId)));
    const count = quantity((item?.quantity ?? 0) + ctx.body.quantity);
    const [stock] = await ctx.db.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, ctx.body.sku_id));
    if (!stock || stock.onHand - stock.reserved < count) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stok tersedia tidak mencukupi.');
    if (item) await ctx.db.update(cartItems).set({ quantity: count, rowVersion: item.rowVersion + 1 }).where(eq(cartItems.id, item.id));
    else await ctx.db.insert(cartItems).values({ id: randomUUID(), cartId: cart.id, skuId: ctx.body.sku_id, quantity: count });
    await ctx.db.update(carts).set({ rowVersion: cart.rowVersion + 1 }).where(eq(carts.id, cart.id));
    return readCart(ctx.db, { ...cart, rowVersion: cart.rowVersion + 1 }, app.services.config.mediaBaseUrl);
  });
  for (const id of ['updateCartItem','removeCartItem'] as const) operation(app, id, async ctx => {
    const cart = await lockCart(ctx.db, ctx.params.buyerAccountId); version(ctx.request, cart);
    const item = await one(ctx.db, cartItems, ctx.params.cartItemId, eq(cartItems.cartId, cart.id), true);
    if (id === 'updateCartItem') {
      if (item.quoteLineId) throw new AppError(409, 'QUOTE_IMMUTABLE', 'Jumlah penawaran harus mengikuti seluruh versi yang diterima.');
      const count = quantity(ctx.body.quantity); await skuSnapshot(ctx.db, item.skuId);
      const [stock] = await ctx.db.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, item.skuId));
      if (!stock || stock.onHand - stock.reserved < count) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stok tersedia tidak mencukupi.');
      await ctx.db.update(cartItems).set({ quantity: count, rowVersion: item.rowVersion + 1 }).where(eq(cartItems.id, item.id));
    } else if (item.quoteLineId) {
      const quote = await one(ctx.db, quoteLines, item.quoteLineId);
      const lines = await ctx.db.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteVersionId, quote.quoteVersionId));
      await ctx.db.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), inArray(cartItems.quoteLineId, lines.map(line => line.id))));
      await ctx.db.update(quoteVersions).set({ status: 'DECLINED', rowVersion: sql`${quoteVersions.rowVersion} + 1` }).where(and(eq(quoteVersions.id, quote.quoteVersionId), eq(quoteVersions.status, 'ACCEPTED')));
    } else await ctx.db.delete(cartItems).where(eq(cartItems.id, item.id));
    await ctx.db.update(carts).set({ rowVersion: cart.rowVersion + 1 }).where(eq(carts.id, cart.id));
    return readCart(ctx.db, { ...cart, rowVersion: cart.rowVersion + 1 }, app.services.config.mediaBaseUrl);
  }, { transaction: true });
}
