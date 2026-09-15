import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../../database/index.js';
import { inventoryBalances, inventoryMovements, skus } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { assertVersion, boundedText } from '../catalog/policy.js';
import { audit } from '../catalog/service.js';
import { adjustedOnHand } from './policy.js';

function presentInventory(row: typeof inventoryBalances.$inferSelect) {
  return { sku_id: row.skuId, on_hand: row.onHand, reserved: row.reserved,
    available: row.onHand - row.reserved, row_version: row.rowVersion };
}

export async function getInventory(db: Database | DatabaseTransaction, storeId: string, skuId: string) {
  const [row] = await db.select({ inventory: inventoryBalances }).from(inventoryBalances)
    .innerJoin(skus, eq(skus.id, inventoryBalances.skuId)).where(and(eq(skus.id, skuId), eq(skus.storeId, storeId))).limit(1);
  if (!row) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found.');
  return presentInventory(row.inventory);
}

export async function adjustStock(tx: DatabaseTransaction, storeId: string, skuId: string,
  delta: number, reasonInput: string, version: number, actorId: string, requestId: string, idempotencyKey: string) {
  const reason = boundedText(reasonInput, 'reason', 200);
  if (reason.length < 3) throw new AppError(422, 'INVALID_REASON', 'Stock adjustment reason must contain at least 3 characters.');
  const [sku] = await tx.select({ id: skus.id }).from(skus).where(and(eq(skus.id, skuId), eq(skus.storeId, storeId))).limit(1);
  if (!sku) throw new AppError(404, 'SKU_NOT_FOUND', 'SKU not found.');
  const [row] = await tx.select().from(inventoryBalances).where(eq(inventoryBalances.skuId, skuId)).limit(1).for('update');
  if (!row) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found.');
  assertVersion(row.rowVersion, version);
  const onHand = adjustedOnHand(row.onHand, row.reserved, delta);
  await tx.update(inventoryBalances).set({ onHand, rowVersion: row.rowVersion + 1, updatedAt: new Date() }).where(eq(inventoryBalances.id, row.id));
  // Permanent business reference protects stock even after transport replay retention expires.
  const eventKey = `stock-adjustment:${createHash('sha256').update(JSON.stringify([actorId, storeId, skuId, idempotencyKey])).digest('hex')}`;
  await tx.insert(inventoryMovements).values({ inventoryId: row.id, actorId, onHandDelta: delta, reservedDelta: 0, reason: 'ADJUST', eventKey });
  await audit(tx, actorId, 'inventory', row.id, 'ADJUST_STOCK', requestId,
    { sku_id: skuId, before_on_hand: row.onHand, after_on_hand: onHand, reserved: row.reserved, delta }, reason);
  return presentInventory({ ...row, onHand, rowVersion: row.rowVersion + 1 });
}
