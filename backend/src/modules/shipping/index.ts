import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { auditLogs, outboxEvents, shipmentEvents, shipments, shippingQuotes, vendorOrders } from '../../database/schema.js';
import { operation, one, version } from '../../shared/operations.js';
import { routeSchema } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { encryptSensitive } from '../../shared/crypto.js';
import { secureEqual } from '../auth/tokens.js';
import { requireVendorOrder } from '../orders/service.js';
import { assertShipmentReady, enqueueShipping, shippingRates } from './service.js';
import { providerAccount } from '../../integrations/providers.js';

export async function shippingRoutes(app: FastifyInstance) {
  operation(app, 'getShippingRates', ctx => shippingRates(app.services, ctx.params.buyerAccountId, ctx.body));

  operation(app, 'readyToShip', async ctx => {
    const order = await requireVendorOrder(ctx, ctx.params.vendorOrderId, true);
    version(ctx.request, order);
    await assertShipmentReady(ctx.db, order);
    const [existing] = await ctx.db.select().from(shipments).where(eq(shipments.vendorOrderId, order.id)).limit(1).for('update');
    if (existing) {
      const [queued] = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, `shipment-requested:${existing.id}`)).limit(1);
      if (queued) return { id: queued.id, state: queued.state === 'DONE' ? 'SUCCEEDED' : queued.state === 'DEAD' ? 'FAILED' : 'QUEUED', status_url: `/api/v1/operations/${queued.id}`, result_type: 'shipment', result_id: existing.id };
      throw new AppError(409, 'SHIPMENT_ALREADY_EXISTS', 'Shipment pesanan sudah dibuat.');
    }
    const quote = await one(ctx.db, shippingQuotes, order.shippingQuoteId);
    if (quote.validUntil <= order.createdAt || quote.storeId !== order.storeId) throw new AppError(409, 'SHIPPING_QUOTE_INVALID', 'Snapshot quotation pengiriman tidak cocok.');
    const account = await providerAccount(ctx.db, app.services.config, 'BITESHIP');
    if (quote.providerAccountId !== account.id) throw new AppError(409, 'PROVIDER_ACCOUNT_MISMATCH', 'Akun provider quotation tidak lagi cocok.');
    const id = randomUUID();
    await ctx.db.insert(shipments).values({ id, vendorOrderId: order.id, providerAccountId: account.id, bookingReference: `shipment-${id}`,
      courierCode: quote.courierCode, serviceCode: quote.serviceCode, packageSnapshot: quote.packageSnapshot,
      quotedAmount: quote.finalAmount, actualAmount: 0, state: 'NOT_BOOKED', vendorReadyAt: new Date() });
    await ctx.db.update(vendorOrders).set({ fulfillmentStatus: 'PROCESSING', rowVersion: order.rowVersion + 1 }).where(eq(vendorOrders.id, order.id));
    await ctx.db.insert(auditLogs).values({ actorId: ctx.user.id, entityType: 'SHIPMENT', entityId: id, action: 'READY_TO_SHIP',
      correlationId: ctx.request.id, changesRedacted: { vendor_order_id: order.id } });
    return enqueueShipping(ctx.db, 'SHIPMENT_REQUESTED', id, { shipmentId: id, userId: ctx.user.id, requestId: ctx.request.id }, `shipment-requested:${id}`);
  });

  operation(app, 'reconcileShipment', async ctx => {
    const shipment = await one(ctx.db, shipments, ctx.params.shipmentId, undefined, true);
    return enqueueShipping(ctx.db, 'SHIPMENT_RECONCILE', shipment.id,
      { shipmentId: shipment.id, userId: ctx.user.id, requestId: ctx.request.id, reason: ctx.body.reason },
      `shipment-reconcile:${shipment.id}:${ctx.request.headers['idempotency-key']}`);
  });

  app.post('/webhooks/biteship', { schema: routeSchema('receiveBiteshipWebhook') }, async (request, reply) => {
    const token = app.services.config.biteshipWebhookToken;
    const supplied = (typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer '))
      ? request.headers.authorization.slice(7) : typeof request.headers['x-webhook-token'] === 'string' ? request.headers['x-webhook-token'] : '';
    if (!token || !secureEqual(supplied, token)) throw new AppError(401, 'INVALID_WEBHOOK_AUTH', 'Autentikasi webhook tidak valid.');
    const body = request.body as Record<string, unknown>, providerOrderId = String(body.order_id ?? '');
    if (!/^[a-zA-Z0-9_-]{1,191}$/.test(providerOrderId)) throw new AppError(400, 'INVALID_WEBHOOK', 'Order provider tidak valid.');
    const account = await providerAccount(app.services.db, app.services.config, 'BITESHIP');
    const dedupeKey = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await app.services.db.transaction(async tx => {
      const [known] = await tx.select().from(shipmentEvents).where(and(eq(shipmentEvents.providerAccountId, account.id), eq(shipmentEvents.dedupeKey, `webhook:${dedupeKey}`))).limit(1);
      if (known) return;
      const eventId = randomUUID(), outboxId = randomUUID();
      const [shipment] = await tx.select().from(shipments).where(and(eq(shipments.providerAccountId, account.id), eq(shipments.providerOrderId, providerOrderId))).limit(1);
      await tx.insert(shipmentEvents).values({ id: eventId, shipmentId: shipment?.id ?? null, providerAccountId: account.id,
        dedupeKey: `webhook:${dedupeKey}`, eventType: String(body.event).slice(0, 100), payloadReference: `outbox:${outboxId}`,
        verificationStatus: 'UNVERIFIED', processingStatus: 'RECEIVED' });
      await tx.insert(outboxEvents).values({ id: outboxId, eventKey: `shipment-webhook:${dedupeKey}`, aggregateType: 'SHIPMENT', aggregateId: shipment?.id ?? providerOrderId,
        eventType: 'SHIPMENT_RECONCILE', payload: { shipmentId: shipment?.id, providerOrderId, inboxEventId: eventId, userId: null,
          requestId: request.id, encryptedPayload: encryptSensitive(JSON.stringify(body), app.services.config.dataEncryptionKey, 'shipment-provider-payload') } });
    });
    return reply.code(200).send({ message: 'Webhook diterima.' });
  });
}

export { handleShippingEvent } from './service.js';
