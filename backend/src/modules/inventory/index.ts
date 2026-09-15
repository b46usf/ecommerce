import type { FastifyInstance } from 'fastify';
import { routeSchema } from '../../shared/contracts.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { requireStoreRole } from '../auth/index.js';
import { expectedVersion } from '../catalog/policy.js';
import { adjustStock, getInventory } from './service.js';

interface Params { storeId: string; skuId: string }
export async function inventoryRoutes(app: FastifyInstance) {
  app.get<{ Params: Params }>('/vendor/stores/:storeId/skus/:skuId/inventory', { schema: routeSchema('getInventory') }, async (request, reply) => {
    await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    const result = await getInventory(app.services.db, request.params.storeId, request.params.skuId);
    return reply.header('ETag', `"${result.row_version}"`).header('Cache-Control', 'private, no-store').send(result);
  });
  app.post<{ Params: Params; Body: { on_hand_delta: number; reason: string } }>('/vendor/stores/:storeId/skus/:skuId/stock-adjustments',
    { schema: routeSchema('adjustStock') }, async (request, reply) => {
      const actor = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
      // Ownership of the SKU is rechecked before replaying a stored response.
      await getInventory(app.services.db, request.params.storeId, request.params.skuId);
      const result = await executeIdempotent(request, { actorId: actor.id, operation: 'adjustStock' }, async tx => {
        const body = await adjustStock(tx, request.params.storeId, request.params.skuId, request.body.on_hand_delta,
          request.body.reason, expectedVersion(request.headers['if-match']), actor.id, request.id,
          request.headers['idempotency-key'] as string);
        return { statusCode: 200, body, headers: { ETag: `"${body.row_version}"` } };
      });
      return reply.code(result.statusCode).headers(result.headers ?? {}).header('Cache-Control', 'private, no-store').send(result.body);
    });
}
