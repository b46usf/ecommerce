import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { eq, inArray, lte, and, sql } from 'drizzle-orm';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createServices } from './runtime.js';
import { outboxEvents } from './database/schema.js';
import { processAuthEmail, processMedia, releaseFailedMedia } from './jobs/handlers.js';
import { handlePaymentEvent } from './modules/payments/index.js';
import { handleShippingEvent } from './modules/shipping/index.js';
import { processRefund } from './jobs/refunds.js';
import { completeVendorOrderInTransaction } from './modules/orders/service.js';
import { AppError } from './shared/errors.js';

const config = loadConfig();
const services = createServices(config);
const logger = pino({ level: config.logLevel });
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null, connectTimeout: 5000 });
connection.on('error', () => logger.error('Worker Redis unavailable'));
const queue = new Queue('marketplace', { connection: connection as any, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: false } });
const deadLetters = new Queue('marketplace-dead-letter', { connection: connection as any });

const worker = new Worker('marketplace', async (job: Job<{ eventId: string }>) => {
  const [event] = await services.db.select().from(outboxEvents).where(eq(outboxEvents.id, job.data.eventId)).limit(1);
  if (!event || event.state === 'DONE') return;
  if (event.state === 'DEAD') throw new Error('EVENT_TERMINAL');
  await services.db.update(outboxEvents).set({ state: 'PROCESSING', lockedUntil: new Date(Date.now() + 90_000), attempts: sql`${outboxEvents.attempts} + 1` }).where(eq(outboxEvents.id, event.id));
  const signal = AbortSignal.timeout(60_000);
  let result: Record<string, unknown> | undefined;
  switch (event.eventType) {
    case 'AUTH_EMAIL_REQUESTED': await processAuthEmail(services, event.payload, signal); break;
    case 'MEDIA_PROCESS_REQUESTED': await processMedia(services, event.payload, signal); break;
    case 'PAYMENT_CREATE': case 'PAYMENT_RECONCILE': case 'PAYMENT_CANCEL': case 'ORDER_EXPIRE': case 'RECONCILIATION_RUN':
      await handlePaymentEvent(services, event.eventType, event.payload as any);
      result = { state: 'SUCCEEDED', result_type: event.payload.reconciliationId ? 'reconciliation' : event.payload.paymentAttemptId ? 'payment_attempt' : 'order_group', result_id: event.payload.reconciliationId ?? event.payload.paymentAttemptId ?? event.payload.orderGroupId };
      break;
    case 'SHIPMENT_REQUESTED': case 'SHIPMENT_RECONCILE':
      result = await handleShippingEvent(services, event.eventType, event.payload as any) as unknown as Record<string, unknown>;
      break;
    case 'REFUND_REQUESTED': result = await processRefund(services, event.payload); break;
    case 'ORDER_COMPLETE':
      try {
        await services.db.transaction(tx => completeVendorOrderInTransaction(tx, String(event.payload.vendorOrderId), String(event.payload.userId), String(event.payload.requestId)));
        result = { state: 'SUCCEEDED', result_type: 'vendor_order', result_id: event.payload.vendorOrderId };
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 409) throw error;
        result = { state: 'REVIEW', result_type: 'vendor_order', result_id: event.payload.vendorOrderId, error: error.code };
      }
      break;
    default: throw new Error('UNKNOWN_EVENT_TYPE');
  }
  await services.db.update(outboxEvents).set({ state: 'DONE', payload: result ? { ...event.payload, operationResult: result } : event.payload, lockedUntil: null, lastError: null }).where(eq(outboxEvents.id, event.id));
  logger.info({ eventId: event.id, type: event.eventType, requestId: event.payload.requestId }, 'Job completed');
}, { connection: connection as any, concurrency: config.workerConcurrency });

async function recordFailure(job: Job | undefined) {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
  const [event] = await services.db.select().from(outboxEvents).where(eq(outboxEvents.id, job.data.eventId)).limit(1);
  if (!event || event.state === 'DONE') return;
  await deadLetters.add('failed-event', { eventId: event.id, eventType: event.eventType }, { jobId: event.id });
  await services.db.update(outboxEvents).set({ state: 'DEAD', lockedUntil: null, lastError: 'JOB_ATTEMPTS_EXHAUSTED' }).where(eq(outboxEvents.id, event.id));
  if (event.eventType === 'MEDIA_PROCESS_REQUESTED') await releaseFailedMedia(services, event.payload);
  logger.error({ eventId: event.id, type: event.eventType }, 'Job moved to dead letter queue');
}
worker.on('failed', job => { void recordFailure(job).catch(() => logger.error('Could not persist job failure; dispatcher will retry')); });
worker.on('error', () => logger.error('Worker error'));
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    const events = await services.db.select().from(outboxEvents).where(and(inArray(outboxEvents.state, ['READY', 'PROCESSING']), lte(outboxEvents.availableAt, new Date()))).orderBy(outboxEvents.createdAt).limit(100);
    for (const event of events) {
      const job = await queue.add(event.eventType, { eventId: event.id }, { jobId: event.id });
      if (await job.getState() === 'failed') { await recordFailure(job); continue; }
    }
  } catch { logger.error('Outbox dispatch failed; retrying on next poll'); }
  finally { dispatching = false; }
}
const timer = setInterval(() => { void dispatch(); }, 5000);
void dispatch();
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return;
  closing = true; clearInterval(timer);
  void (async () => { await worker.close(); await queue.close(); await deadLetters.close(); connection.disconnect(); await services.close(); })().catch(() => { process.exitCode = 1; });
});
