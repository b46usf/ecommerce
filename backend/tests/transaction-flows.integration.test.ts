import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../src/database/index.js';
import * as t from '../src/database/schema.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { providerAccount } from '../src/integrations/providers.js';
import { applyVerifiedStatus } from '../src/modules/payments/service.js';
import { processShipmentRequested } from '../src/modules/shipping/service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('payment and shipping transaction flow against InnoDB', () => {
  let database: ReturnType<typeof createDatabase>;
  let services: Services;
  beforeAll(() => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Use dedicated _test database.');
    database = createDatabase({ databaseUrl });
    services = { db: database.db, config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://127.0.0.1:6379', SESSION_SECRET: 'transaction-flow-test-secret-over-32-characters',
      MIDTRANS_SERVER_KEY: 'midtrans-test-server-key', MIDTRANS_MERCHANT_ID: 'merchant-test', PAYMENT_CHANNELS: 'qris',
      PAYMENT_CHANNEL_LIMITS: '{"qris":{"minimum_amount":1000,"maximum_amount":100000000}}',
      BITESHIP_API_KEY: 'biteship_test.local-only', BITESHIP_ACCOUNT_ID: 'biteship-test-account' }),
      redis: {} as any, checkDatabase: async () => undefined, close: async () => undefined };
  });
  afterAll(async () => { vi.restoreAllMocks(); if (database) await database.close(); });

  it('applies a verified settlement atomically, consumes stock, posts ledger, then books shipment', async () => {
    const id = { buyer: randomUUID(), vendor: randomUUID(), buyerAccount: randomUUID(), legal: randomUUID(), store: randomUUID(),
      category: randomUUID(), tax: randomUUID(), product: randomUUID(), sku: randomUUID(), inventory: randomUUID(), quote: randomUUID(),
      group: randomUUID(), order: randomUUID(), item: randomUUID(), reservation: randomUUID(), attempt: randomUUID(), shipment: randomUUID() };
    const paymentProvider = await providerAccount(database.db, services.config, 'MIDTRANS');
    const shippingProvider = await providerAccount(database.db, services.config, 'BITESHIP');
    const future = new Date(Date.now() + 30 * 60_000), now = new Date();
    const packet = { schema_version: 1,
      origin: { contact_name: 'Vendor', phone: '081234567890', street: 'Jl. Asal', postal_code: '12345' },
      destination: { recipient_name: 'Buyer', phone: '081234567891', street: 'Jl. Tujuan', postal_code: '54321' },
      items: [{ name: 'Barang', sku: 'SKU-1', value: 10_000, quantity: 1, weight: 100, length: 10, width: 5, height: 2 }] };
    await database.db.transaction(async tx => {
      await tx.insert(t.users).values([
        { id: id.buyer, emailNormalized: `${id.buyer}@flow.test`, passwordHash: 'flow-hash', name: 'Buyer' },
        { id: id.vendor, emailNormalized: `${id.vendor}@flow.test`, passwordHash: 'flow-hash', name: 'Vendor' },
      ]);
      await tx.insert(t.buyerAccounts).values({ id: id.buyerAccount, managerUserId: id.buyer, kind: 'INDIVIDUAL' });
      await tx.insert(t.legalEntities).values({ id: id.legal, createdBy: id.vendor, kind: 'INDIVIDUAL', legalName: 'Vendor Legal' });
      await tx.insert(t.stores).values({ id: id.store, legalEntityId: id.legal, name: 'Store', slug: id.store, contactPhone: '081234567890', status: 'ACTIVE' });
      await tx.insert(t.categories).values({ id: id.category, name: 'Category', slug: id.category, status: 'ACTIVE' });
      await tx.insert(t.taxClasses).values({ id: id.tax, code: id.tax, name: 'Tax', status: 'ACTIVE' });
      await tx.insert(t.products).values({ id: id.product, storeId: id.store, categoryId: id.category, taxClassId: id.tax, name: 'Barang', description: 'Barang', slug: id.product, status: 'ACTIVE' });
      await tx.insert(t.skus).values({ id: id.sku, productId: id.product, storeId: id.store, skuCode: 'SKU-1', unitLabel: 'pcs', unitPriceGross: 10_000,
        weightG: 100, lengthCm: '10.00', widthCm: '5.00', heightCm: '2.00', status: 'ACTIVE' });
      await tx.insert(t.inventoryBalances).values({ id: id.inventory, skuId: id.sku, onHand: 10, reserved: 1 });
      await tx.insert(t.shippingQuotes).values({ id: id.quote, buyerAccountId: id.buyerAccount, storeId: id.store, providerAccountId: shippingProvider.id,
        inputHash: 'a'.repeat(64), courierCode: 'jne', serviceCode: 'reg', finalAmount: 1_000, originSnapshot: packet.origin,
        destinationSnapshot: packet.destination, packageSnapshot: packet, priceBreakdown: {}, fetchedAt: now, validUntil: future });
      await tx.insert(t.checkoutGroups).values({ id: id.group, buyerAccountId: id.buyerAccount, createdBy: id.buyer, orderNumber: `ORD-${id.group}`,
        recipientSnapshot: packet.destination, itemsGross: 10_000, shippingTotal: 1_000, buyerFeeTotal: 0, platformDiscount: 0,
        grandTotal: 11_000, orderState: 'AWAITING_PAYMENT', reservationExpiresAt: future, pricingSnapshot: {} });
      await tx.insert(t.vendorOrders).values({ id: id.order, checkoutGroupId: id.group, storeId: id.store, shippingQuoteId: id.quote,
        orderNumber: `VEN-${id.order}`, itemsNet: 10_000, itemsVat: 0, itemsGross: 10_000, shippingAmount: 1_000,
        buyerFee: 0, platformDiscount: 0, buyerTotal: 11_000, commissionAmount: 200, commissionVat: 0, sellerWithholding: 0,
        sellerTaxSnapshot: {}, originSnapshot: packet.origin, fulfillmentStatus: 'UNFULFILLED' });
      await tx.insert(t.orderItems).values({ id: id.item, vendorOrderId: id.order, storeId: id.store, skuId: id.sku, quantity: 1,
        unitPriceGross: 10_000, lineNet: 10_000, lineVat: 0, lineGross: 10_000, vendorDiscount: 0,
        commissionAmount: 200, commissionVat: 0, sellerWithholding: 0, productSnapshot: {}, taxSnapshot: {}, feeSnapshot: {} });
      await tx.insert(t.stockReservations).values({ id: id.reservation, orderItemId: id.item, skuId: id.sku, inventoryId: id.inventory, quantity: 1, expiresAt: future });
      await tx.insert(t.paymentAttempts).values({ id: id.attempt, checkoutGroupId: id.group, providerAccountId: paymentProvider.id,
        providerOrderId: `payment-${id.attempt}`, expectedAmount: 11_000, state: 'PENDING', channel: 'qris', expiresAt: future });
    });

    await applyVerifiedStatus(services, id.attempt, { order_id: `payment-${id.attempt}`, transaction_id: `txn-${id.attempt}`,
      transaction_status: 'settlement', status_code: '200', gross_amount: '11000.00', currency: 'IDR', merchant_id: 'merchant-test' },
    { paymentAttemptId: id.attempt, userId: id.buyer, requestId: randomUUID() });
    const [balance] = await database.db.select().from(t.inventoryBalances).where(eq(t.inventoryBalances.id, id.inventory));
    const [reservation] = await database.db.select().from(t.stockReservations).where(eq(t.stockReservations.id, id.reservation));
    const [receipt] = await database.db.select().from(t.paymentReceipts).where(eq(t.paymentReceipts.paymentAttemptId, id.attempt));
    const [payable] = await database.db.select().from(t.vendorPayables).where(eq(t.vendorPayables.vendorOrderId, id.order));
    expect({ onHand: balance!.onHand, reserved: balance!.reserved, reservation: reservation!.state,
      receipt: receipt!.applicationStatus, payable: payable!.accruedAmount }).toEqual({ onHand: 9, reserved: 0, reservation: 'CONSUMED', receipt: 'APPLIED', payable: 9800 });
    const [journal] = await database.db.select().from(t.journalEntries).where(eq(t.journalEntries.paymentReceiptId, receipt!.id));
    expect(journal?.status).toBe('POSTED');

    await database.db.insert(t.shipments).values({ id: id.shipment, vendorOrderId: id.order, providerAccountId: shippingProvider.id,
      bookingReference: `shipment-${id.shipment}`, courierCode: 'jne', serviceCode: 'reg', packageSnapshot: packet,
      quotedAmount: 1_000, actualAmount: 0, state: 'NOT_BOOKED', vendorReadyAt: new Date() });
    const providerShipmentId = `provider_${id.shipment.replaceAll('-', '')}`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, id: providerShipmentId,
      reference_id: `shipment-${id.shipment}`, status: 'confirmed', courier: { company: 'jne', type: 'reg', waybill_id: 'WAYBILL-1' },
      currency: 'IDR', price: 1_000 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await processShipmentRequested(services, { shipmentId: id.shipment, userId: id.vendor, requestId: randomUUID() });
    const [shipment] = await database.db.select().from(t.shipments).where(eq(t.shipments.id, id.shipment));
    expect(result.state).toBe('SUCCEEDED');
    expect(shipment).toMatchObject({ state: 'BOOKED', providerOrderId: providerShipmentId, waybillId: 'WAYBILL-1', actualAmount: 1_000 });
  });
});
