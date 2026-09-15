import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull, gt, asc, type SQL } from 'drizzle-orm';
import * as tables from '../database/schema.js';
import type { DatabaseExecutor } from '../database/index.js';
import { contract, routeSchema } from './contracts.js';
import { requireUser, requireStoreRole, requireAdminRole } from '../modules/auth/index.js';
import { AppError } from './errors.js';
import { executeIdempotent } from './idempotency.js';
import { assertVersion, expectedVersion, cursorScope, decodeCursor, encodeCursor } from '../modules/catalog/policy.js';

export const camel = (key: string) => key.replace(/_([a-z])/g, (_all, c: string) => c.toUpperCase());
export function values(body: Record<string, any>) { return Object.fromEntries(Object.entries(body).map(([key, value]) => [camel(key), value])); }
export function resolveSchema(schema: any): any { return schema?.$ref ? resolveSchema(contract.components.schemas[schema.$ref.split('/').at(-1)]) : schema; }
/** Only declared contract fields can leave a module; encrypted/internal columns are excluded. */
export function present(name: string | any, row: any): any {
  const schema = resolveSchema(typeof name === 'string' ? contract.components.schemas[name] : name);
  if (row === null || row === undefined) return row;
  if (schema.type === 'array') return row.map((item: any) => present(schema.items, item));
  if (schema.type === 'object') {
    if (!schema.properties && schema.additionalProperties) return row;
    const result: any = {};
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const value = row[key] !== undefined ? row[key] : row[camel(key)];
      if (value !== undefined && (value !== null || (property as any).nullable)) result[key] = present(property, value);
    }
    return result;
  }
  if (row instanceof Date) return row.toISOString();
  if (['integer', 'number'].includes(schema.type)) return Number(row);
  return row;
}
export function operationDefinition(id: string): { path: string; method: string; definition: any } {
  for (const [path, item] of Object.entries(contract.paths) as any) for (const [method, definition] of Object.entries(item) as any) if (definition.operationId === id) return { path, method: method.toUpperCase(), definition };
  throw new Error(`Unknown operation ${id}`);
}
export async function requireBuyer(request: FastifyRequest, buyerAccountId: string) {
  const user = await requireUser(request);
  const [buyer] = await request.server.services.db.select().from(tables.buyerAccounts).where(and(eq(tables.buyerAccounts.id, buyerAccountId), eq(tables.buyerAccounts.managerUserId, user.id), eq(tables.buyerAccounts.status, 'ACTIVE'))).limit(1);
  if (!buyer) throw new AppError(404, 'NOT_FOUND', 'Akun pembeli tidak ditemukan.');
  return user;
}
export async function one(db: DatabaseExecutor, table: any, id: string, extra?: SQL, lock = false): Promise<any> {
  let query = (db as any).select().from(table).where(and(eq(table.id, id), extra)).limit(1);
  if (lock) query = query.for('update');
  const [row] = await query;
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Data tidak ditemukan.');
  return row;
}
export async function page(db: DatabaseExecutor, table: any, query: any, scope: unknown, extra?: SQL) {
  const key = cursorScope(scope), cursor = decodeCursor(query.cursor, key), limit = query.limit ?? 20;
  const rows = await (db as any).select().from(table).where(and(extra, cursor ? gt(table.id, cursor.id) : undefined)).orderBy(asc(table.id)).limit(limit + 1);
  const selected = rows.slice(0, limit), last = selected.at(-1);
  return { items: selected, next_cursor: rows.length > limit && last ? encodeCursor({ id: last.id, value: last.id, scope: key }) : null };
}
export function version(request: FastifyRequest, row: { rowVersion: number }) { assertVersion(row.rowVersion, expectedVersion(request.headers['if-match'])); }
export interface Context { request: FastifyRequest; db: DatabaseExecutor; user: typeof tables.users.$inferSelect; body: any; params: any; query: any }
export type OperationHandler = (ctx: Context) => Promise<any>;

export function operation(app: FastifyInstance, id: string, handler: OperationHandler, options: { transaction?: boolean } = {}) {
  const { path, method, definition } = operationDefinition(id);
  const [status, response]: any = Object.entries(definition.responses).find(([code]) => Number(code) >= 200 && Number(code) < 300)!;
  const responseSchema = response.content?.['application/json']?.schema;
  app.route({ method: method as any, url: path.replace(/\{([^}]+)\}/g, ':$1'), schema: routeSchema(id), handler: async (request, reply) => {
    const params: any = request.params, body: any = request.body ?? {}, query: any = request.query;
    const roles: string[] = definition['x-roles'] ?? [];
    const user = params.buyerAccountId ? await requireBuyer(request, params.buyerAccountId) : params.storeId ? await requireStoreRole(request, params.storeId, roles.map(role => role === 'STORE_OWNER' ? 'OWNER' : role)) : roles.some(role => ['FINANCE','FINANCE_APPROVER','OPERATIONS','SUPERADMIN'].includes(role)) ? await requireAdminRole(request, roles) : await requireUser(request);
    const invoke = async (db: DatabaseExecutor) => {
      const result = await handler({ request, user, body, params, query, db });
      const output = responseSchema ? present(responseSchema, result) : undefined;
      return { statusCode: Number(status), body: output ?? null, headers: result?.rowVersion !== undefined ? { ETag: `"${result.rowVersion}"` } : result?.row_version !== undefined ? { ETag: `"${result.row_version}"` } : undefined };
    };
    const idempotent = definition.parameters?.some((parameter: any) => parameter.$ref?.endsWith('/IdempotencyKey'));
    const result = idempotent ? await executeIdempotent(request, { actorId: user.id, operation: id }, invoke) : options.transaction ? await app.services.db.transaction(invoke) : await invoke(app.services.db);
    if (Number(status) === 204) return reply.code(204).send();
    return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
  } });
}
export async function audit(context: Context, entityType: string, entityId: string, action: string, changes: Record<string, unknown> = {}) {
  await context.db.insert(tables.auditLogs).values({ actorId: context.user.id, entityType, entityId, action, changesRedacted: changes, correlationId: context.request.id, reason: context.body.reason ?? null });
}
export async function activeAddress(db: DatabaseExecutor, buyerId: string, addressId: string) {
  return one(db, tables.addresses, addressId, and(eq(tables.addresses.buyerAccountId, buyerId), isNull(tables.addresses.archivedAt)));
}
