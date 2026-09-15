import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DatabaseExecutor, DatabaseTransaction } from '../../database/index.js';
import { auditLogs, checkoutGroups, orderCases, orderItems, outboxEvents, paymentReceipts,
  shipmentEvents, shipments, shippingQuotes, stockReservations, vendorOrders, vendorPayables } from '../../database/schema.js';
import type { Services } from '../../services.js';
import { providerAccount, providerRequest, ProviderError } from '../../integrations/providers.js';
import { AppError } from '../../shared/errors.js';
import { canonicalJson } from '../../shared/idempotency.js';
import { one, present } from '../../shared/operations.js';
import { selection, packageFor, type SelectionInput } from '../checkout/selection.js';
import { assertNoOrderBlocks } from '../orders/service.js';
import { bookingRequest, nextState, rateRequest, ratesFromProvider, validatedPackage, verifiedProviderOrder } from './policy.js';

export interface ShippingPayload { shipmentId?: string; providerOrderId?: string; inboxEventId?: string; userId?: string; requestId?: string }
export interface ShippingResult { state: 'SUCCEEDED' | 'REVIEW'; result_type: 'shipment'; result_id: string | null }
type Shipment = typeof shipments.$inferSelect;
const result = (id: string | null, review = false): ShippingResult => ({ state: review ? 'REVIEW' : 'SUCCEEDED', result_type: 'shipment', result_id: id });

export async function enqueueShipping(db: DatabaseExecutor, eventType: string, aggregateId: string, payload: Record<string, unknown>, eventKey: string, availableAt = new Date()) {
  await db.insert(outboxEvents).values({ eventKey, aggregateType: eventType === 'ORDER_COMPLETE' ? 'VENDOR_ORDER' : 'SHIPMENT', aggregateId,
    eventType, payload, availableAt }).onDuplicateKeyUpdate({ set: { eventKey } });
  const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, eventKey)).limit(1);
  return { id: event!.id, state: event!.state === 'DONE' ? 'SUCCEEDED' : event!.state === 'DEAD' ? 'FAILED' : 'QUEUED',
    status_url: `/api/v1/operations/${event!.id}`, result_type: 'shipment', result_id: aggregateId };
}

export async function shippingRates(services: Services, buyerId: string, body: SelectionInput) {
  const account = await providerAccount(services.db, services.config, 'BITESHIP');
  const chosen = await services.db.transaction(tx => selection(tx, buyerId, body));
  const cached = await services.db.select().from(shippingQuotes).where(and(eq(shippingQuotes.buyerAccountId, buyerId),
    eq(shippingQuotes.providerAccountId, account.id), eq(shippingQuotes.inputHash, chosen.fingerprint), gt(shippingQuotes.validUntil, new Date(Date.now() + 30_000))));
  if (chosen.groups.every(group => cached.some(row => row.storeId === group.store.id))) {
    return { items: cached.map(row => present('ShippingQuote', { ...row, estimatedDelivery: row.priceBreakdown.estimated_delivery ?? '' })), next_cursor: null };
  }
  const quoted: Array<{ group: any; packet: any; options: ReturnType<typeof ratesFromProvider> }> = [];
  // Limit provider concurrency independently of the number of stores selected.
  for (let offset = 0; offset < chosen.groups.length; offset += 4) {
    const batch = await Promise.all(chosen.groups.slice(offset, offset + 4).map(async group => {
      const packet = validatedPackage(packageFor(group, chosen.recipient));
      try {
        const response = await providerRequest(services.config, 'BITESHIP', '/v1/rates/couriers', 'POST', rateRequest(packet, services.config.biteshipCouriers));
        return { group, packet, options: ratesFromProvider(response, services.config.biteshipCouriers) };
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof ProviderError && error.status === 422 && !error.ambiguous) throw new AppError(422, 'SHIPPING_UNAVAILABLE', 'Provider tidak memiliki layanan untuk paket ini.');
        throw new AppError(503, 'SHIPPING_PROVIDER_UNAVAILABLE', 'Tarif kurir belum dapat diperiksa. Coba kembali.');
      }
    }));
    quoted.push(...batch);
  }
  return services.db.transaction(async tx => {
    const current = await selection(tx, buyerId, body);
    if (current.fingerprint !== chosen.fingerprint) throw new AppError(409, 'SHIPPING_SELECTION_CHANGED', 'Keranjang atau alamat berubah saat tarif diperiksa.');
    const fetchedAt = new Date(), validUntil = new Date(Date.now() + 5 * 60_000);
    const ids: string[] = [];
    for (const entry of quoted) for (const option of entry.options) {
      const id = randomUUID(); ids.push(id);
      await tx.insert(shippingQuotes).values({ id, buyerAccountId: buyerId, storeId: entry.group.store.id, providerAccountId: account.id,
        inputHash: chosen.fingerprint, courierCode: option.courierCode, serviceCode: option.serviceCode, finalAmount: option.finalAmount,
        originSnapshot: { schema_version: 1, ...entry.packet.origin }, destinationSnapshot: chosen.recipient, packageSnapshot: entry.packet,
        priceBreakdown: { ...option.breakdown, estimated_delivery: option.estimatedDelivery }, fetchedAt, validUntil });
    }
    if (!ids.length) throw new AppError(422, 'SHIPPING_UNAVAILABLE', 'Tidak ada opsi kirim.');
    const rows = await tx.select().from(shippingQuotes).where(inArray(shippingQuotes.id, ids));
    return { items: rows.map(row => present('ShippingQuote', { ...row, estimatedDelivery: row.priceBreakdown.estimated_delivery })), next_cursor: null };
  });
}

export async function assertShipmentReady(db: DatabaseExecutor, order: typeof vendorOrders.$inferSelect) {
  const group = await one(db, checkoutGroups, order.checkoutGroupId);
  if (group.orderState !== 'ACTIVE' || !['UNFULFILLED', 'PROCESSING'].includes(order.fulfillmentStatus)) throw new AppError(409, 'ORDER_NOT_READY', 'Pesanan belum dapat dikirim.');
  const [receipt] = await db.select({ id: paymentReceipts.id }).from(paymentReceipts)
    .where(and(eq(paymentReceipts.checkoutGroupId, group.id), eq(paymentReceipts.applicationStatus, 'APPLIED'))).limit(1);
  if (!receipt) throw new AppError(409, 'PAYMENT_NOT_APPLIED', 'Pembayaran harus terverifikasi sebelum pengiriman.');
  const items = await db.select({ id: orderItems.id, quantity: orderItems.quantity, reservedQuantity: stockReservations.quantity, state: stockReservations.state }).from(orderItems)
    .leftJoin(stockReservations, eq(stockReservations.orderItemId, orderItems.id)).where(eq(orderItems.vendorOrderId, order.id));
  if (!items.length || items.some(item => item.state !== 'CONSUMED' || item.reservedQuantity !== item.quantity)) {
    throw new AppError(409, 'STOCK_NOT_CONSUMED', 'Stok pesanan belum dikonsumsi dari reservasi.');
  }
  await assertNoOrderBlocks(db, order.id);
}

async function lockedShipment(tx: DatabaseTransaction, id: string) {
  const initial: Shipment = await one(tx, shipments, id);
  const initialOrder = await one(tx, vendorOrders, initial.vendorOrderId);
  const group = await one(tx, checkoutGroups, initialOrder.checkoutGroupId, undefined, true);
  const order: typeof vendorOrders.$inferSelect = await one(tx, vendorOrders, initial.vendorOrderId, undefined, true);
  const shipment: Shipment = await one(tx, shipments, id, undefined, true);
  return { group, order, shipment };
}

async function markReview(services: Services, id: string, code: string, payload: ShippingPayload) {
  await services.db.transaction(async tx => {
    const { shipment } = await lockedShipment(tx, id);
    // An overlapping poll may already have established the booking after the uncertain attempt.
    if (code === 'BOOKING_UNCERTAIN' && shipment.providerOrderId && shipment.state !== 'SHIPMENT_REVIEW') return;
    await tx.update(shipments).set({ state: 'SHIPMENT_REVIEW', rowVersion: shipment.rowVersion + 1 }).where(eq(shipments.id, id));
    await tx.insert(auditLogs).values({ actorId: payload.userId ?? null, entityType: 'SHIPMENT', entityId: id, action: 'REVIEW',
      correlationId: payload.requestId ?? id, changesRedacted: { code }, reason: code });
    if (payload.inboxEventId) await tx.update(shipmentEvents).set({ processingStatus: 'ERROR', processedAt: new Date() }).where(eq(shipmentEvents.id, payload.inboxEventId));
  });
}

async function applyProviderOrder(services: Services, id: string, data: any, payload: ShippingPayload, expectedId?: string) {
  return services.db.transaction(async tx => {
    const { group, order, shipment } = await lockedShipment(tx, id);
    const snapshot = verifiedProviderOrder(data, shipment, expectedId);
    const account = await providerAccount(tx, services.config, 'BITESHIP');
    if (shipment.providerAccountId !== account.id) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Akun provider shipment tidak cocok.');
    let state = nextState(shipment.state, snapshot.state);
    const priceChanged = snapshot.actualAmount !== shipment.quotedAmount;
    if (priceChanged) state = 'SHIPMENT_REVIEW';
    const now = new Date();
    const deliveryAt = shipment.deliveredAt ?? (state === 'DELIVERED' ? now : null);
    const deadline = order.disputeDeadline ?? (deliveryAt ? new Date(deliveryAt.getTime() + services.config.disputeWindowHours * 3_600_000) : null);
    await tx.update(shipments).set({ providerOrderId: snapshot.providerOrderId, waybillId: snapshot.waybillId ?? shipment.waybillId,
      state, actualAmount: snapshot.actualAmount, bookedAt: shipment.bookedAt ?? now, deliveredAt: deliveryAt,
      rowVersion: shipment.rowVersion + 1, updatedAt: now }).where(eq(shipments.id, id));
    const fulfillment = state === 'DELIVERED' ? (order.fulfillmentStatus === 'COMPLETED' ? 'COMPLETED' : 'DELIVERED') :
      ['PICKED_UP', 'IN_TRANSIT'].includes(state) ? 'SHIPPED' : state === 'BOOKED' ? 'PROCESSING' : 'REVIEW';
    if (fulfillment !== order.fulfillmentStatus || deadline?.getTime() !== order.disputeDeadline?.getTime()) {
      await tx.update(vendorOrders).set({ fulfillmentStatus: fulfillment, disputeDeadline: deadline,
        rowVersion: order.rowVersion + 1, updatedAt: now }).where(eq(vendorOrders.id, order.id));
      await tx.update(checkoutGroups).set({ rowVersion: group.rowVersion + 1 }).where(eq(checkoutGroups.id, group.id));
    }
    if (state === 'SHIPMENT_REVIEW' || state === 'CANCELLED') {
      const [open] = await tx.select({ id: orderCases.id }).from(orderCases).where(and(eq(orderCases.vendorOrderId, order.id), eq(orderCases.state, 'OPEN'))).limit(1);
      if (!open) await tx.insert(orderCases).values({ vendorOrderId: order.id, openedBy: group.createdBy, kind: 'DELIVERY_FAILURE',
        reason: priceChanged ? 'Provider shipping amount differs from the confirmed quote' : `Provider shipment requires review: ${snapshot.status}` });
      await tx.update(vendorPayables).set({ eligibility: 'BLOCKED', eligibleAt: null, rowVersion: sql`${vendorPayables.rowVersion} + 1` }).where(eq(vendorPayables.vendorOrderId, order.id));
    }
    const projectionKey = createHash('sha256').update(canonicalJson({ shipment: id, providerOrder: snapshot.providerOrderId,
      state: snapshot.status, price: snapshot.actualAmount, waybill: snapshot.waybillId })).digest('hex');
    await tx.insert(shipmentEvents).values({ shipmentId: id, providerAccountId: account.id, dedupeKey: `verified:${projectionKey}`,
      eventType: snapshot.status.slice(0, 100), payloadReference: `biteship-order:${snapshot.providerOrderId}`, verificationStatus: 'VERIFIED',
      processingStatus: 'DONE', providerOccurredAt: now, processedAt: now }).onDuplicateKeyUpdate({ set: { dedupeKey: `verified:${projectionKey}` } });
    if (payload.inboxEventId) await tx.update(shipmentEvents).set({ shipmentId: id, verificationStatus: 'VERIFIED', processingStatus: 'DONE', processedAt: now }).where(eq(shipmentEvents.id, payload.inboxEventId));
    if (state === 'DELIVERED' && deadline) await enqueueShipping(tx, 'ORDER_COMPLETE', order.id,
      { vendorOrderId: order.id, userId: group.createdBy, requestId: payload.requestId ?? id }, `order-complete:${order.id}`, deadline);
    await tx.insert(auditLogs).values({ actorId: payload.userId ?? null, entityType: 'SHIPMENT', entityId: id, action: 'PROVIDER_VERIFIED',
      correlationId: payload.requestId ?? id, changesRedacted: { before: shipment.state, after: state, actual_amount: snapshot.actualAmount } });
    return result(id, state === 'SHIPMENT_REVIEW' || state === 'CANCELLED');
  });
}

export async function processShipmentRequested(services: Services, payload: ShippingPayload): Promise<ShippingResult> {
  if (!payload.shipmentId) throw new Error('SHIPMENT_ID_REQUIRED');
  const id = payload.shipmentId;
  const prepared = await services.db.transaction(async tx => {
    const { order, shipment } = await lockedShipment(tx, id);
    const account = await providerAccount(tx, services.config, 'BITESHIP');
    if (shipment.providerAccountId !== account.id) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Akun pengiriman tidak cocok.');
    if (shipment.providerOrderId || shipment.state !== 'NOT_BOOKED') return { shipment, body: null };
    await assertShipmentReady(tx, order);
    const body = bookingRequest(shipment);
    // Commit a durable uncertainty marker BEFORE touching the provider, preventing crash/retry double booking.
    await tx.update(shipments).set({ state: 'BOOKING', rowVersion: shipment.rowVersion + 1 }).where(eq(shipments.id, id));
    return { shipment, body };
  });
  if (!prepared.body) {
    if (prepared.shipment.providerOrderId) return processShipmentReconcile(services, payload);
    await markReview(services, id, 'BOOKING_UNCERTAIN', payload);
    return result(id, true);
  }
  try {
    const data = await providerRequest(services.config, 'BITESHIP', '/v1/orders', 'POST', prepared.body);
    return await applyProviderOrder(services, id, data, payload);
  } catch {
    // Any error after dispatch can conceal a successful booking, including malformed JSON or a local commit failure.
    await markReview(services, id, 'BOOKING_UNCERTAIN', payload);
    return result(id, true);
  }
}

export async function processShipmentReconcile(services: Services, payload: ShippingPayload): Promise<ShippingResult> {
  const account = await providerAccount(services.db, services.config, 'BITESHIP');
  let shipment: Shipment | undefined = payload.shipmentId ? await one(services.db, shipments, payload.shipmentId) : undefined;
  if (shipment && shipment.providerAccountId !== account.id) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Akun pengiriman tidak cocok.');
  const providerId = shipment?.providerOrderId ?? payload.providerOrderId;
  if (!providerId || !/^[a-zA-Z0-9_-]{1,191}$/.test(providerId)) {
    if (shipment) await markReview(services, shipment.id, 'BOOKING_REFERENCE_UNRESOLVED', payload);
    return result(shipment?.id ?? null, true);
  }
  let data: any;
  try { data = await providerRequest(services.config, 'BITESHIP', `/v1/orders/${encodeURIComponent(providerId)}`); }
  catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      if (shipment) await markReview(services, shipment.id, 'PROVIDER_ORDER_NOT_FOUND', payload);
      return result(shipment?.id ?? null, true);
    }
    throw error; // Safe GET retries use the worker's bounded backoff.
  }
  if (!shipment) {
    const [known] = await services.db.select().from(shipments).where(and(eq(shipments.providerAccountId, account.id),
      typeof data.reference_id === 'string' ? eq(shipments.bookingReference, data.reference_id) : eq(shipments.providerOrderId, providerId))).limit(1);
    shipment = known;
  }
  if (!shipment) {
    if (payload.inboxEventId) await services.db.update(shipmentEvents).set({ verificationStatus: 'VERIFIED', processingStatus: 'ERROR', processedAt: new Date() }).where(eq(shipmentEvents.id, payload.inboxEventId));
    return result(null, true); // Durable quarantine; a provider-owned order may belong to a different system.
  }
  try { return await applyProviderOrder(services, shipment.id, data, payload, providerId); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    await markReview(services, shipment.id, error.code, payload); return result(shipment.id, true);
  }
}

export async function handleShippingEvent(services: Services, eventType: string, payload: ShippingPayload): Promise<ShippingResult> {
  if (eventType === 'SHIPMENT_REQUESTED') return processShipmentRequested(services, payload);
  if (eventType === 'SHIPMENT_RECONCILE') return processShipmentReconcile(services, payload);
  throw new Error('UNSUPPORTED_SHIPPING_EVENT');
}
