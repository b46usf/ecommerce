import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { outboxEvents } from '../../database/schema.js';
import { requireUser } from '../auth/index.js';
import { AppError } from '../../shared/errors.js';
import { routeSchema } from '../../shared/contracts.js';
export async function operationRoutes(app: FastifyInstance) {
  app.get<{ Params: { operationId: string } }>('/operations/:operationId', { schema: routeSchema('getOperation') }, async request => {
    const user = await requireUser(request);
    const [event] = await app.services.db.select().from(outboxEvents).where(eq(outboxEvents.id, request.params.operationId)).limit(1);
    if (!event || event.payload.userId !== user.id) throw new AppError(404, 'NOT_FOUND', 'Operasi tidak ditemukan.');
    const result = event.payload.operationResult as Record<string, unknown> | undefined;
    return { id: event.id, state: event.state === 'DONE' ? result?.state ?? 'SUCCEEDED' : event.state === 'DEAD' ? 'FAILED' : event.state === 'PROCESSING' ? 'PROCESSING' : 'QUEUED',
      status_url: `/api/v1/operations/${event.id}`, result_type: result?.result_type ?? null, result_id: result?.result_id ?? null,
      error: event.state === 'DEAD' ? event.lastError ?? 'JOB_FAILED' : result?.error ?? null };
  });
}
