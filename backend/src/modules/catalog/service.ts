import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Ajv, type ValidateFunction } from 'ajv';
import type { Database, DatabaseTransaction } from '../../database/index.js';
import { auditLogs, categories, inventoryBalances, productMedia, products, skus, stores, taxClasses } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { assertVersion, cursorScope, decodeCursor, encodeCursor, productValues, skuValues, type ProductWrite, type SkuWrite } from './policy.js';

type Db = Database | DatabaseTransaction;
type ProductRow = typeof products.$inferSelect;
type SkuRow = typeof skus.$inferSelect;
export interface PageQuery { cursor?: string; limit?: number }
export interface SearchQuery extends PageQuery {
  q?: string; category_id?: string; store_id?: string; min_price?: number; max_price?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
}

const attributeValidator = new Ajv({ strict: false, allErrors: false, validateFormats: false });
const compiledAttributes = new Map<string, { schema: Record<string, unknown>; validate: ValidateFunction }>();

function categoryAttributes(category: typeof categories.$inferSelect): ValidateFunction {
  const key = `${category.id}:${category.rowVersion}`;
  const cached = compiledAttributes.get(key);
  if (cached) return cached.validate;
  // DB JSON objects have a new identity per request; bound both our cache and Ajv's schema cache.
  if (compiledAttributes.size >= 128) {
    const oldestKey = compiledAttributes.keys().next().value;
    if (oldestKey) {
      const oldest = compiledAttributes.get(oldestKey)!;
      attributeValidator.removeSchema(oldest.schema);
      compiledAttributes.delete(oldestKey);
    }
  }
  const validate = attributeValidator.compile(category.attributeSchema);
  compiledAttributes.set(key, { schema: category.attributeSchema, validate });
  return validate;
}

function base(row: { id: string; createdAt: Date; rowVersion: number }) {
  return { id: row.id, created_at: row.createdAt.toISOString(), row_version: row.rowVersion };
}

export function presentStore(row: typeof stores.$inferSelect) {
  return { ...base(row), name: row.name, slug: row.slug, status: row.status };
}

export function presentSku(row: SkuRow, available: number) {
  return {
    ...base(row), sku_code: row.skuCode, variant_attributes: row.variantAttributes,
    unit_label: row.unitLabel, unit_price_gross: row.unitPriceGross, weight_g: row.weightG,
    length_cm: Number(row.lengthCm), width_cm: Number(row.widthCm), height_cm: Number(row.heightCm),
    available_quantity: available, status: row.status,
  };
}

export async function audit(tx: DatabaseTransaction, actorId: string, entityType: string, entityId: string,
  action: string, correlationId: string, changes: Record<string, unknown>, reason?: string) {
  await tx.insert(auditLogs).values({ actorId, entityType, entityId, action, correlationId,
    changesRedacted: changes, reason: reason ?? null });
}

export async function listCategories(db: Db, query: PageQuery) {
  const scope = cursorScope('categories');
  const cursor = decodeCursor(query.cursor, scope);
  const limit = query.limit ?? 20;
  const rows = await db.select().from(categories).where(and(eq(categories.status, 'ACTIVE'),
    cursor ? gt(categories.id, cursor.id) : undefined)).orderBy(asc(categories.id)).limit(limit + 1);
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map(row => ({ ...base(row), name: row.name, slug: row.slug,
      parent_id: row.parentId, attribute_schema: row.attributeSchema })),
    next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.id, value: last.id }) : null,
  };
}

export async function publicStore(db: Db, id: string) {
  const [row] = await db.select().from(stores).where(and(eq(stores.id, id), eq(stores.status, 'ACTIVE'))).limit(1);
  if (!row) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  return presentStore(row);
}

export async function productRows(db: Db, rows: ProductRow[], mediaBaseUrl: string, publicOnly = true) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const variants = await db.select({ sku: skus, onHand: inventoryBalances.onHand, reserved: inventoryBalances.reserved })
    .from(skus).innerJoin(inventoryBalances, eq(inventoryBalances.skuId, skus.id))
    .where(and(inArray(skus.productId, ids), publicOnly ? eq(skus.status, 'ACTIVE') : undefined)).orderBy(asc(skus.id));
  const images = await db.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.sortOrder));
  return rows.map(row => ({
    ...base(row), name: row.name, description: row.description, category_id: row.categoryId,
    tax_class_id: row.taxClassId, slug: row.slug, attributes: row.attributes, store_id: row.storeId, status: row.status,
    skus: variants.filter(item => item.sku.productId === row.id).map(item => presentSku(item.sku, item.onHand - item.reserved)),
    images: images.filter(item => item.productId === row.id).map(item => ({ ...base(item),
      url: `${mediaBaseUrl.replace(/\/$/, '')}/${item.objectKey.split('/').map(encodeURIComponent).join('/')}`,
      alt_text: item.altText, sort_order: item.sortOrder })),
  }));
}

export async function getProduct(db: Db, id: string, mediaBaseUrl: string, storeId?: string) {
  const [row] = await db.select({ product: products }).from(products).innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.id, id), storeId ? eq(products.storeId, storeId) : and(eq(products.status, 'ACTIVE'),
      eq(stores.status, 'ACTIVE'), eq(categories.status, 'ACTIVE')))).limit(1);
  if (!row) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const [result] = await productRows(db, [row.product], mediaBaseUrl, !storeId);
  return result!;
}

export async function listProducts(db: Db, query: SearchQuery, mediaBaseUrl: string, vendorStoreId?: string) {
  const keyword = query.q?.trim() ?? '';
  if (keyword.length > 120) throw new AppError(422, 'SEARCH_TOO_LONG', 'Search query exceeds 120 characters.');
  if (query.min_price !== undefined && query.max_price !== undefined && query.min_price > query.max_price) {
    throw new AppError(422, 'INVALID_PRICE_RANGE', 'Minimum price must not exceed maximum price.');
  }
  const sort = vendorStoreId ? 'newest' : query.sort ?? (keyword ? 'relevance' : 'newest');
  const scope = cursorScope({ vendorStoreId, keyword, category: query.category_id, store: query.store_id,
    min: query.min_price, max: query.max_price, sort });
  const cursor = decodeCursor(query.cursor, scope);
  const limit = query.limit ?? 20;
  const priceQuery = db.select({ productId: skus.productId, minPrice: sql<number>`MIN(${skus.unitPriceGross})`.mapWith(Number).as('min_price') })
    .from(skus).where(eq(skus.status, 'ACTIVE')).groupBy(skus.productId).as('prices');
  const score = keyword ? sql<number>`MATCH(${products.name}, ${products.description}) AGAINST (${keyword} IN NATURAL LANGUAGE MODE)` : sql<number>`0`;
  const orderValue = sort === 'price_asc' || sort === 'price_desc' ? sql`${priceQuery.minPrice}` :
    sort === 'relevance' ? score : sql`${products.createdAt}`;
  let cursorWhere: SQL | undefined;
  if (cursor) {
    let value: string | number | Date = cursor.value;
    if (sort === 'newest') {
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid cursor timestamp.');
      }
      value = new Date(value);
      // Explicit UTC string keeps SQL parameter timezone handling consistent with MySQL DATETIME.
      value = value.toISOString().slice(0, 23).replace('T', ' ');
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new AppError(400, 'INVALID_CURSOR', 'Invalid cursor sort value.');
    }
    cursorWhere = or(sort === 'price_asc' ? sql`${orderValue} > ${value}` : sql`${orderValue} < ${value}`,
      and(sql`${orderValue} = ${value}`, gt(products.id, cursor.id)));
  }
  const rows = await db.select({ product: products, price: priceQuery.minPrice, score: score.mapWith(Number) })
    .from(products).innerJoin(stores, eq(stores.id, products.storeId)).innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(priceQuery, eq(priceQuery.productId, products.id)).where(and(
      vendorStoreId ? eq(products.storeId, vendorStoreId) : and(eq(products.status, 'ACTIVE'), eq(stores.status, 'ACTIVE'),
        eq(categories.status, 'ACTIVE'), sql`${priceQuery.minPrice} IS NOT NULL`),
      query.category_id ? eq(products.categoryId, query.category_id) : undefined,
      query.store_id ? eq(products.storeId, query.store_id) : undefined,
      query.min_price !== undefined ? sql`${priceQuery.minPrice} >= ${query.min_price}` : undefined,
      query.max_price !== undefined ? sql`${priceQuery.minPrice} <= ${query.max_price}` : undefined,
      keyword ? sql`${score} > 0` : undefined, cursorWhere,
    )).orderBy(sort === 'price_asc' ? asc(orderValue) : desc(orderValue), asc(products.id)).limit(limit + 1);
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: await productRows(db, selected.map(item => item.product), mediaBaseUrl, !vendorStoreId),
    next_cursor: rows.length > limit && last ? encodeCursor({ scope, id: last.product.id,
      value: sort === 'newest' ? last.product.createdAt.toISOString() : sort === 'relevance' ? last.score : Number(last.price) }) : null,
  };
}

async function validateReferences(tx: DatabaseTransaction, categoryId: string, taxClassId: string, attributes: Record<string, unknown>) {
  const [category] = await tx.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.status, 'ACTIVE'))).limit(1);
  if (!category) throw new AppError(422, 'INVALID_CATEGORY', 'Choose an active category.');
  const [taxClass] = await tx.select().from(taxClasses).where(and(eq(taxClasses.id, taxClassId), eq(taxClasses.status, 'ACTIVE'))).limit(1);
  if (!taxClass) throw new AppError(422, 'INVALID_TAX_CLASS', 'Choose an active tax class.');
  const validate = categoryAttributes(category);
  if (!validate(attributes)) throw new AppError(422, 'INVALID_PRODUCT_ATTRIBUTES', 'Product attributes do not match the category schema.');
}

export async function lockProduct(tx: DatabaseTransaction, storeId: string, productId: string) {
  const [row] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.storeId, storeId))).limit(1).for('update');
  if (!row) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  return row;
}

export async function createProduct(tx: DatabaseTransaction, storeId: string, body: ProductWrite, actorId: string, requestId: string, mediaBaseUrl: string) {
  const values = productValues(body);
  await validateReferences(tx, values.categoryId, values.taxClassId, values.attributes);
  const id = randomUUID();
  await tx.insert(products).values({ ...values, id, storeId, status: 'DRAFT' });
  await audit(tx, actorId, 'product', id, 'CREATE', requestId, { status: 'DRAFT' });
  return getProduct(tx, id, mediaBaseUrl, storeId);
}

export async function updateProduct(tx: DatabaseTransaction, storeId: string, productId: string, body: ProductWrite, version: number, actorId: string, requestId: string, mediaBaseUrl: string) {
  const row = await lockProduct(tx, storeId, productId);
  assertVersion(row.rowVersion, version);
  const values = productValues(body);
  await validateReferences(tx, values.categoryId, values.taxClassId, values.attributes);
  await tx.update(products).set({ ...values, rowVersion: row.rowVersion + 1, updatedAt: new Date() }).where(eq(products.id, productId));
  await audit(tx, actorId, 'product', productId, 'UPDATE', requestId, { before_version: row.rowVersion, after_version: row.rowVersion + 1 });
  return getProduct(tx, productId, mediaBaseUrl, storeId);
}

export async function transitionProduct(tx: DatabaseTransaction, storeId: string, productId: string, state: 'ACTIVE' | 'ARCHIVED', version: number, actorId: string, requestId: string, mediaBaseUrl: string) {
  const [store] = await tx.select().from(stores).where(eq(stores.id, storeId)).limit(1).for('update');
  const product = await lockProduct(tx, storeId, productId);
  assertVersion(product.rowVersion, version);
  if (state === 'ACTIVE') {
    if (store?.status !== 'ACTIVE') throw new AppError(409, 'STORE_NOT_ACTIVE', 'Store must be active before publishing.');
    await validateReferences(tx, product.categoryId, product.taxClassId, product.attributes);
    const [variant] = await tx.select().from(skus).where(and(eq(skus.productId, productId), eq(skus.status, 'ACTIVE'))).limit(1);
    const [media] = await tx.select({ id: productMedia.id }).from(productMedia).where(eq(productMedia.productId, productId)).limit(1);
    if (!variant || !media) throw new AppError(422, 'PRODUCT_INCOMPLETE', 'Publishing requires at least one active SKU and one verified product image.');
    skuValues({ sku_code: variant.skuCode, unit_label: variant.unitLabel, unit_price_gross: variant.unitPriceGross,
      weight_g: variant.weightG, length_cm: Number(variant.lengthCm), width_cm: Number(variant.widthCm), height_cm: Number(variant.heightCm) });
  }
  await tx.update(products).set({ status: state, rowVersion: product.rowVersion + 1, updatedAt: new Date() }).where(eq(products.id, productId));
  await audit(tx, actorId, 'product', productId, state === 'ACTIVE' ? 'PUBLISH' : 'ARCHIVE', requestId, { before: product.status, after: state });
  return getProduct(tx, productId, mediaBaseUrl, storeId);
}

export async function createSku(tx: DatabaseTransaction, storeId: string, productId: string, body: SkuWrite, actorId: string, requestId: string) {
  await lockProduct(tx, storeId, productId);
  const id = randomUUID();
  await tx.insert(skus).values({ ...skuValues(body), id, productId, storeId, status: 'ACTIVE' });
  await tx.insert(inventoryBalances).values({ skuId: id, onHand: 0, reserved: 0 });
  await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1`, updatedAt: new Date() }).where(eq(products.id, productId));
  await audit(tx, actorId, 'sku', id, 'CREATE', requestId, { product_id: productId, unit_price_gross: body.unit_price_gross });
  const [row] = await tx.select().from(skus).where(eq(skus.id, id));
  return presentSku(row!, 0);
}

export async function updateSku(tx: DatabaseTransaction, storeId: string, skuId: string, body: SkuWrite, version: number, actorId: string, requestId: string) {
  const [target] = await tx.select({ productId: skus.productId }).from(skus).where(and(eq(skus.id, skuId), eq(skus.storeId, storeId))).limit(1);
  if (!target) throw new AppError(404, 'SKU_NOT_FOUND', 'SKU not found.');
  await lockProduct(tx, storeId, target.productId);
  const [row] = await tx.select().from(skus).where(and(eq(skus.id, skuId), eq(skus.storeId, storeId))).limit(1).for('update');
  if (!row) throw new AppError(404, 'SKU_NOT_FOUND', 'SKU not found.');
  assertVersion(row.rowVersion, version);
  const values = skuValues(body);
  await tx.update(skus).set({ ...values, rowVersion: row.rowVersion + 1, updatedAt: new Date() }).where(eq(skus.id, skuId));
  await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1`, updatedAt: new Date() }).where(eq(products.id, row.productId));
  await audit(tx, actorId, 'sku', skuId, 'UPDATE', requestId, { before_price: row.unitPriceGross, after_price: values.unitPriceGross });
  const [inventory] = await tx.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, skuId));
  return presentSku({ ...row, ...values, rowVersion: row.rowVersion + 1 }, inventory ? inventory.onHand - inventory.reserved : 0);
}
