import type { FastifyInstance } from 'fastify';
import { routeSchema } from '../../shared/contracts.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { requireStoreRole } from '../auth/index.js';
import { expectedVersion, type ProductWrite, type SkuWrite } from './policy.js';
import { createProduct, createSku, getProduct, listCategories, listProducts, publicStore, transitionProduct, updateProduct, updateSku,
  type PageQuery, type SearchQuery } from './service.js';
import { storeRoutes } from './stores.js';

interface StoreParams { storeId: string }
interface ProductParams extends StoreParams { productId: string }
interface SkuParams extends StoreParams { skuId: string }

export async function catalogRoutes(app: FastifyInstance) {
  await storeRoutes(app);

  app.get<{ Querystring: PageQuery }>('/categories', { schema: routeSchema('listCategories') }, async (request, reply) => {
    const body = await listCategories(app.services.db, request.query);
    return reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600').send(body);
  });

  app.get<{ Params: StoreParams }>('/stores/:storeId', { schema: routeSchema('getPublicStore') }, async (request, reply) => {
    const body = await publicStore(app.services.db, request.params.storeId);
    return reply.header('ETag', `"${body.row_version}"`).header('Cache-Control', 'public, max-age=300').send(body);
  });

  app.get<{ Querystring: SearchQuery }>('/products', { schema: routeSchema('searchProducts') }, async (request, reply) => {
    const body = await listProducts(app.services.db, request.query, app.services.config.mediaBaseUrl);
    // Responses include authoritative stock; metadata-only caching can be introduced separately.
    return reply.header('Cache-Control', 'no-store').send(body);
  });

  app.get<{ Params: { productId: string } }>('/products/:productId', { schema: routeSchema('getProduct') }, async (request, reply) => {
    const body = await getProduct(app.services.db, request.params.productId, app.services.config.mediaBaseUrl);
    return reply.header('ETag', `"${body.row_version}"`).header('Cache-Control', 'no-store').send(body);
  });

  app.get<{ Params: StoreParams; Querystring: PageQuery }>('/vendor/stores/:storeId/products', { schema: routeSchema('listVendorProducts') }, async (request, reply) => {
    await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    return reply.header('Cache-Control', 'private, no-store').send(await listProducts(app.services.db, request.query,
      app.services.config.mediaBaseUrl, request.params.storeId));
  });

  app.post<{ Params: StoreParams; Body: ProductWrite }>('/vendor/stores/:storeId/products', { schema: routeSchema('createProduct') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'createProduct' }, async tx => {
      const body = await createProduct(tx, request.params.storeId, request.body, actor.id, request.id, app.services.config.mediaBaseUrl);
      return { statusCode: 201, body, headers: { ETag: `"${body.row_version}"` } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });

  app.put<{ Params: ProductParams; Body: ProductWrite }>('/vendor/stores/:storeId/products/:productId', { schema: routeSchema('updateProduct') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    const version = expectedVersion(request.headers['if-match']);
    const body = await app.services.db.transaction(tx => updateProduct(tx, request.params.storeId, request.params.productId,
      request.body, version, actor.id, request.id, app.services.config.mediaBaseUrl));
    return reply.header('ETag', `"${body.row_version}"`).send(body);
  });

  for (const [action, state] of [['publish', 'ACTIVE'], ['archive', 'ARCHIVED']] as const) {
    const operation = `${action}Product`;
    app.post<{ Params: ProductParams }>(`/vendor/stores/:storeId/products/:productId/${action}`, { schema: routeSchema(operation) }, async (request, reply) => {
      const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
      // Checking the nested ID before idempotency replay avoids returning another store's resource.
      await getProduct(app.services.db, request.params.productId, app.services.config.mediaBaseUrl, request.params.storeId);
      const result = await executeIdempotent(request, { actorId: actor.id, operation }, async tx => {
        const body = await transitionProduct(tx, request.params.storeId, request.params.productId, state,
          expectedVersion(request.headers['if-match']), actor.id, request.id, app.services.config.mediaBaseUrl);
        return { statusCode: 200, body, headers: { ETag: `"${body.row_version}"` } };
      });
      return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
    });
  }

  app.post<{ Params: ProductParams; Body: SkuWrite }>('/vendor/stores/:storeId/products/:productId/skus', { schema: routeSchema('createSku') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    await getProduct(app.services.db, request.params.productId, app.services.config.mediaBaseUrl, request.params.storeId);
    const result = await executeIdempotent(request, { actorId: actor.id, operation: 'createSku' }, async tx => {
      const body = await createSku(tx, request.params.storeId, request.params.productId, request.body, actor.id, request.id);
      return { statusCode: 201, body, headers: { ETag: `"${body.row_version}"` } };
    });
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  });

  app.put<{ Params: SkuParams; Body: SkuWrite }>('/vendor/stores/:storeId/skus/:skuId', { schema: routeSchema('updateSku') }, async (request, reply) => {
    const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    const body = await app.services.db.transaction(tx => updateSku(tx, request.params.storeId, request.params.skuId,
      request.body, expectedVersion(request.headers['if-match']), actor.id, request.id));
    return reply.header('ETag', `"${body.row_version}"`).send(body);
  });
}
