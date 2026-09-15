import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { idempotencyKeys } from '../database/schema.js';
import type { DatabaseTransaction } from '../database/index.js';
import { AppError } from './errors.js';
import { decryptSensitive, encryptSensitive } from './crypto.js';

export interface MutationResult { statusCode: number; body: any; headers?: Record<string, string> }
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** Authorize the actor/resource before calling; response and business writes commit together. */
export async function executeIdempotent(
  request: FastifyRequest,
  scope: { actorId: string; operation: string },
  action: (tx: DatabaseTransaction) => Promise<MutationResult>,
): Promise<MutationResult> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key harus 16–128 karakter.');
  const requestHash = createHash('sha256').update(canonicalJson({ body: request.body, params: request.params, query: request.query, version: request.headers['if-match'] })).digest('hex');
  for (let attempt = 0; ; attempt++) {
    try {
      return await request.server.services.db.transaction(async tx => {
        // The unique insert serializes identical keys even before SELECT FOR UPDATE.
        await tx.insert(idempotencyKeys).values({ id: randomUUID(), ...scope, key, requestHash, state: 'IN_PROGRESS', expiresAt: new Date(Date.now() + 7 * 86400000) })
          .onDuplicateKeyUpdate({ set: { key } });
        const [record] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.actorId, scope.actorId), eq(idempotencyKeys.operation, scope.operation), eq(idempotencyKeys.key, key))).for('update');
        if (!record) throw new Error('Idempotency record missing');
        if (record.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Kunci sudah digunakan untuk payload berbeda.');
        if (record.state === 'SUCCEEDED' && record.statusCode) {
          const stored = record.responseBody as { encrypted?: string } | null;
          const body = stored?.encrypted ? JSON.parse(decryptSensitive(stored.encrypted, request.server.services.config.dataEncryptionKey, 'idempotency-response')) : record.responseBody;
          return { statusCode: record.statusCode, body, headers: record.responseHeaders ?? undefined };
        }
        const result = await action(tx);
        await tx.update(idempotencyKeys).set({ state: 'SUCCEEDED', statusCode: result.statusCode, responseBody: { encrypted: encryptSensitive(JSON.stringify(result.body), request.server.services.config.dataEncryptionKey, 'idempotency-response') }, responseHeaders: result.headers ?? null }).where(eq(idempotencyKeys.id, record.id));
        return result;
      });
    } catch (error: any) {
      const code = error?.cause?.code ?? error?.code;
      if (code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue;
      if (code === 'ER_LOCK_WAIT_TIMEOUT') throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Permintaan dengan kunci ini sedang diproses.');
      throw error;
    }
  }
}
