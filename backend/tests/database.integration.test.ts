import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionOptions, createDatabase } from '../src/database/index.js';
import {
  auditLogs, authTokens, categories, inventoryBalances, inventoryMovements,
  legalEntities, products, skus, storeMembers, stores, taxClasses, users,
} from '../src/database/schema.js';

const url = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL ?? url;

describe.skipIf(!url)('MySQL/MariaDB database guarantees', () => {
  let database: ReturnType<typeof createDatabase>;
  const ids = { user: randomUUID(), otherUser: randomUUID(), legal: randomUUID(), store: randomUUID(), otherStore: randomUUID(), category: randomUUID(), tax: randomUUID(), product: randomUUID(), sku: randomUUID(), inventory: randomUUID() };

  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must target a dedicated database ending in _test.');
    const connection = await mysql.createConnection(connectionOptions({ databaseUrl: migrationUrl! }));
    try {
      await connection.query("SET time_zone = '+00:00', default_storage_engine = 'InnoDB'");
      const migrationDb = drizzle(connection);
      const settings = { migrationsFolder: fileURLToPath(new URL('../src/database/migrations', import.meta.url)) };
      await migrate(migrationDb, settings);
      await migrate(migrationDb, settings);
    } finally {
      await connection.end();
    }
    database = createDatabase({ databaseUrl: url, databaseConnectionLimit: 10 });
    await database.db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ids.user, emailNormalized: `${ids.user}@example.test`, name: 'Database Test', passwordHash: 'unusable-integration-fixture' },
        { id: ids.otherUser, emailNormalized: `${ids.otherUser}@example.test`, name: 'Other Test', passwordHash: 'unusable-integration-fixture' },
      ]);
      await tx.insert(legalEntities).values({ id: ids.legal, createdBy: ids.user, kind: 'INDIVIDUAL', legalName: 'Database Test' });
      await tx.insert(stores).values([
        { id: ids.store, legalEntityId: ids.legal, slug: ids.store, name: 'Store A', contactPhone: '+628000000000' },
        { id: ids.otherStore, legalEntityId: ids.legal, slug: ids.otherStore, name: 'Store B', contactPhone: '+628000000000' },
      ]);
      await tx.insert(storeMembers).values({ storeId: ids.store, userId: ids.user, roleCode: 'OWNER' });
      await tx.insert(categories).values({ id: ids.category, slug: ids.category, name: 'Test Category' });
      await tx.insert(taxClasses).values({ id: ids.tax, code: ids.tax, name: 'Test Class', status: 'ACTIVE' });
      await tx.insert(products).values({ id: ids.product, storeId: ids.store, categoryId: ids.category, taxClassId: ids.tax, name: 'Test Product', description: 'Test', slug: ids.product });
      await tx.insert(skus).values({ id: ids.sku, productId: ids.product, storeId: ids.store, skuCode: ids.sku, unitLabel: 'pcs', unitPriceGross: 12_000, weightG: 100, lengthCm: '2.00', widthCm: '2.00', heightCm: '2.00' });
      await tx.insert(inventoryBalances).values({ id: ids.inventory, skuId: ids.sku, onHand: 10 });
    });
  }, 30_000);

  afterAll(async () => { if (database) await database.close(); });

  it('re-applies migrations safely with InnoDB and compatible collation', async () => {
    const [rows] = await database.pool.query<RowDataPacket[]>(
      'SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> ?',[ '__drizzle_migrations' ],
    );
    expect(rows.length).toBeGreaterThanOrEqual(22);
    expect(rows.every((row) => row.engine === 'InnoDB' && row.collation === 'utf8mb4_unicode_ci')).toBe(true);
    const [timezone] = await database.pool.query<RowDataPacket[]>('SELECT @@session.time_zone AS timezone');
    expect(timezone[0]?.timezone).toBe('+00:00');
  });

  it('rejects cross-store SKU references and invalid stock balances', async () => {
    await expect(database.db.insert(skus).values({ productId: ids.product, storeId: ids.otherStore, skuCode: randomUUID(), unitLabel: 'pcs', unitPriceGross: 500, weightG: 1, lengthCm: '1.00', widthCm: '1.00', heightCm: '1.00' })).rejects.toThrow();
    await expect(database.db.update(inventoryBalances).set({ reserved: 11 }).where(eq(inventoryBalances.id, ids.inventory))).rejects.toThrow();
    await expect(database.db.update(inventoryBalances).set({ onHand: -1 }).where(eq(inventoryBalances.id, ids.inventory))).rejects.toThrow();
  });

  it('enforces one active store owner with generated unique columns', async () => {
    await expect(database.db.insert(storeMembers).values({ storeId: ids.store, userId: ids.otherUser, roleCode: 'OWNER' })).rejects.toThrow();
    await database.db.insert(storeMembers).values({ storeId: ids.store, userId: ids.otherUser, roleCode: 'OWNER', revokedAt: new Date() });
  });

  it('serializes concurrent stock reservations without overselling', async () => {
    const reserve = () => database.db.transaction(async (tx) => {
      const [balance] = await tx.select().from(inventoryBalances).where(eq(inventoryBalances.id, ids.inventory)).for('update');
      if (!balance || balance.reserved >= balance.onHand) return false;
      await tx.update(inventoryBalances).set({ reserved: balance.reserved + 1, rowVersion: balance.rowVersion + 1 }).where(eq(inventoryBalances.id, ids.inventory));
      await tx.insert(inventoryMovements).values({ inventoryId: ids.inventory, onHandDelta: 0, reservedDelta: 1, reason: 'RESERVE', eventKey: randomUUID(), actorId: ids.user });
      return true;
    });
    const results = await Promise.all(Array.from({ length: 20 }, reserve));
    expect(results.filter(Boolean)).toHaveLength(10);
    const [balance] = await database.db.select().from(inventoryBalances).where(eq(inventoryBalances.id, ids.inventory));
    expect(balance).toMatchObject({ onHand: 10, reserved: 10, rowVersion: 10 });
  });

  it('rolls back both stock and movement on failed business work', async () => {
    const eventKey = randomUUID();
    await expect(database.db.transaction(async (tx) => {
      await tx.update(inventoryBalances).set({ onHand: 20 }).where(eq(inventoryBalances.id, ids.inventory));
      await tx.insert(inventoryMovements).values({ inventoryId: ids.inventory, onHandDelta: 10, reason: 'RESTOCK', eventKey });
      throw new Error('Business validation rejected');
    })).rejects.toThrow('Business validation rejected');
    const [balance] = await database.db.select().from(inventoryBalances).where(eq(inventoryBalances.id, ids.inventory));
    expect(balance?.onHand).toBe(10);
    expect(await database.db.select().from(inventoryMovements).where(eq(inventoryMovements.eventKey, eventKey))).toHaveLength(0);
  });

  it('consumes one-time auth tokens exactly once under concurrency', async () => {
    const tokenId = randomUUID();
    await database.db.insert(authTokens).values({ id: tokenId, userId: ids.user, purpose: 'RESET_PASSWORD', tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60_000) });
    const consume = async () => {
      const [result] = await database.db.update(authTokens).set({ consumedAt: new Date() }).where(and(eq(authTokens.id, tokenId), isNull(authTokens.consumedAt), isNull(authTokens.revokedAt), gt(authTokens.expiresAt, new Date())));
      return result.affectedRows;
    };
    const consumed = await Promise.all(Array.from({ length: 8 }, consume));
    expect(consumed.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(await consume()).toBe(0);
  });

  it('prevents editing or deleting append-only audit and inventory history', async () => {
    const auditId = randomUUID();
    await database.db.insert(auditLogs).values({ id: auditId, actorId: ids.user, entityType: 'test', entityId: ids.store, action: 'TEST', changesRedacted: {}, correlationId: randomUUID() });
    await expect(database.db.update(auditLogs).set({ action: 'TAMPER' }).where(eq(auditLogs.id, auditId))).rejects.toThrow();
    await expect(database.db.delete(auditLogs).where(eq(auditLogs.id, auditId))).rejects.toThrow();
    await expect(database.db.update(inventoryMovements).set({ reason: 'TAMPER' }).where(eq(inventoryMovements.inventoryId, ids.inventory))).rejects.toThrow();
    await expect(database.db.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, ids.inventory))).rejects.toThrow();
  });
});
