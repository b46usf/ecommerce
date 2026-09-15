import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import type { Services } from './services.js';
import { AppError } from './shared/errors.js';
import { authRoutes, registerSessionHooks, requireCsrf } from './modules/auth/index.js';
import { catalogRoutes } from './modules/catalog/index.js';
import { inventoryRoutes } from './modules/inventory/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { mediaRoutes } from './modules/media/index.js';
import { operationRoutes } from './modules/operations/index.js';
import { buyerRoutes } from './modules/buyer/index.js';
import { cartRoutes } from './modules/cart/index.js';
import { rfqRoutes } from './modules/rfq/index.js';
import { checkoutRoutes } from './modules/checkout/index.js';
import { financeConfigRoutes } from './modules/finance-config/index.js';
import { documentsRoutes } from './modules/documents/index.js';
import { registerOrders } from './modules/orders/index.js';
import { registerCases } from './modules/cases/index.js';
import { settlementRoutes } from './modules/settlement/index.js';
import { paymentsRoutes } from './modules/payments/index.js';
import { shippingRoutes } from './modules/shipping/index.js';
import { contract } from './shared/contracts.js';
import { verifyRequestIntegrity } from './shared/request-integrity.js';

export async function buildApp(services: Services, options: { logger?: boolean; registerRoutes?: (app: FastifyInstance) => Promise<void> } = {}) {
  const { config } = services;
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'req.headers.x-request-signature', 'res.headers.set-cookie', 'password', 'token'] },
    trustProxy: config.trustProxy, bodyLimit: 1024 * 1024,
    requestIdHeader: false, genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, allErrors: false, coerceTypes: 'array' } },
  });
  app.decorate('services', services);
  const implementedOperations = new Set<string>();
  (app as any).implementedOperations = implementedOperations;
  app.addHook('onRoute', route => { if (route.schema?.operationId) implementedOperations.add(route.schema.operationId); });
  app.addHook('onRequest', async (request, reply) => {
    if (config.nodeEnv === 'production' && request.url.startsWith('/api/v1') && request.protocol !== 'https') {
      throw new AppError(426, 'HTTPS_REQUIRED', 'HTTPS wajib digunakan.');
    }
    reply.header('X-Request-ID', request.id).header('Cache-Control', 'private, no-store');
  });
  app.setErrorHandler((error, request, reply) => {
    const err = error as any;
    const databaseCode = err.cause?.code ?? err.code;
    const status = err instanceof AppError ? err.statusCode : err.validation ? 400 : databaseCode === 'ER_DUP_ENTRY' ? 409 : err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    const code = err instanceof AppError ? err.code : err.validation ? 'VALIDATION_ERROR' : databaseCode === 'ER_DUP_ENTRY' ? 'RESOURCE_CONFLICT' : status === 429 ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    if (status >= 500) request.log.error({ code: databaseCode, requestId: request.id }, 'Request failed');
    if (code === 'REQUEST_IN_PROGRESS') reply.header('Retry-After', '2');
    reply.code(status).send({ error: { code, message: err instanceof AppError ? err.message : err.validation ? 'Input tidak valid.' : status === 409 ? 'Data sudah ada.' : status >= 500 ? 'Terjadi kesalahan internal.' : 'Permintaan tidak dapat diproses.', request_id: request.id, ...(err instanceof AppError && err.details ? { details: err.details } : {}) } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.', request_id: request.id } }));
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12 } });
  await app.register(cors, { origin: config.appOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Timestamp', 'X-Request-Nonce', 'X-Request-Signature', 'Idempotency-Key', 'If-Match'], exposedHeaders: ['ETag', 'X-Request-ID', 'Retry-After'] });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } },
    strictTransportSecurity: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(rateLimit, { global: true, redis: services.redis, max: 120, timeWindow: '1 minute', skipOnError: false, keyGenerator: request => request.ip });
  await app.register(swagger, { mode: 'static', specification: { document: {
    ...contract, servers: [{ url: '/api/v1', description: 'Server ini' }],
    components: { ...contract.components, securitySchemes: { ...contract.components.securitySchemes,
      SessionCookie: { type: 'apiKey', in: 'cookie', name: config.sessionCookieName } } },
  } } });
  if (config.nodeEnv !== 'production') await app.register(swaggerUI, { routePrefix: '/docs' });
  registerSessionHooks(app);
  app.addHook('preValidation', async request => {
    const webhook = ['/api/v1/webhooks/midtrans', '/api/v1/webhooks/biteship'].includes(request.routeOptions.url ?? '');
    if (request.url.startsWith('/api/v1') && !webhook && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.origin;
      let refererOrigin: string | undefined;
      try { if (request.headers.referer) refererOrigin = new URL(request.headers.referer).origin; } catch { /* invalid referer is rejected below */ }
      const origins = config.nodeEnv === 'production' ? config.appOrigins : [...config.appOrigins, new URL(config.publicApiUrl).origin];
      if (!origins.includes(origin ?? refererOrigin ?? '')) throw new AppError(403, 'ORIGIN_FORBIDDEN', 'Origin tidak diizinkan.');
      requireCsrf(request);
      await verifyRequestIntegrity(request);
    }
    const headerSchema = request.routeOptions.schema?.headers as { required?: string[] } | undefined;
    if (headerSchema?.required?.includes('if-match') && request.headers['if-match'] === undefined) throw new AppError(428, 'PRECONDITION_REQUIRED', 'If-Match wajib dikirim.');
  });
  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const checks = await Promise.allSettled([services.checkDatabase(), services.redis.ping()]);
    const ready = checks.every(result => result.status === 'fulfilled');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable', checks: { database: checks[0]?.status === 'fulfilled', redis: checks[1]?.status === 'fulfilled' } });
  });
  await app.register(async api => {
    await authRoutes(api);
    await catalogRoutes(api);
    await inventoryRoutes(api);
    await adminRoutes(api);
    await mediaRoutes(api);
    await operationRoutes(api);
    await buyerRoutes(api);
    await cartRoutes(api);
    await rfqRoutes(api);
    await checkoutRoutes(api);
    await financeConfigRoutes(api);
    await documentsRoutes(api);
    await registerOrders(api);
    await registerCases(api);
    await settlementRoutes(api);
    await paymentsRoutes(api);
    await shippingRoutes(api);
    if (options.registerRoutes) await options.registerRoutes(api);
  }, { prefix: '/api/v1' });
  app.addHook('onClose', async () => services.close());
  return app;
}
