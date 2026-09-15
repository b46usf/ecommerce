import { createHash, createHmac, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { auditLogs, documents, legalEntities, storeMembers, stores, vendorOrders } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { routeSchema } from '../../shared/contracts.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { one, operation, audit, version, present } from '../../shared/operations.js';
import { requireUser, requireStoreRole } from '../auth/index.js';
import { getAdminRoles } from '../auth/session.js';
import { secureEqual } from '../auth/tokens.js';
import { objectStorage } from '../media/index.js';
import { decryptDocument, documentMime, encryptDocument, maximumDocumentBytes, scanDocument } from './security.js';

const financeTypes = new Set(['PAYOUT_PROOF', 'REFUND_PROOF']);
const entityTypes = new Set(['NPWP', 'PKP', 'SKB', 'TURNOVER_STATEMENT']);
const documentTypes = new Set([...financeTypes, ...entityTypes, 'INVOICE', 'TAX_INVOICE', 'OTHER']);
type DocumentRow = typeof documents.$inferSelect;

async function documentAccess(request: FastifyRequest, scope: { legalEntityId?: string | null; vendorOrderId?: string | null; documentType: string }) {
  const user = await requireUser(request);
  const grants = await getAdminRoles(request, user.id);
  const finance = grants.includes('FINANCE') || grants.includes('SUPERADMIN');
  if (financeTypes.has(scope.documentType) && !finance) throw new AppError(403, 'DOCUMENT_ACCESS_DENIED', 'Bukti keuangan hanya dapat diakses finance.');
  const db = request.server.services.db;
  if (scope.legalEntityId) {
    const entity = await one(db, legalEntities, scope.legalEntityId);
    if (finance) return user;
    if (entity.createdBy === user.id) return user;
    const [owned] = await db.select({ id: stores.id }).from(stores).innerJoin(storeMembers, eq(storeMembers.storeId, stores.id))
      .where(and(eq(stores.legalEntityId, entity.id), eq(storeMembers.userId, user.id), eq(storeMembers.roleCode, 'OWNER'), isNull(storeMembers.revokedAt))).limit(1);
    if (owned) return user;
  } else if (scope.vendorOrderId) {
    const order = await one(db, vendorOrders, scope.vendorOrderId);
    if (finance) return user;
    await requireStoreRole(request, order.storeId, ['OWNER']);
    return user;
  }
  throw new AppError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan.');
}
function filename(row: DocumentRow): string { return typeof row.metadata.filename === 'string' ? row.metadata.filename : `document-${row.id}`; }
function safeFilename(input: string): string {
  return [...input].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\' ? '_' : char).join('').slice(0, 160);
}
function sign(app: FastifyInstance, id: string, userId: string, expires: number): string {
  return createHmac('sha256', app.services.config.authTokenSecret).update(`document-download:${id}:${userId}:${expires}`).digest('base64url');
}
function downloadUrl(app: FastifyInstance, row: DocumentRow, userId: string): string {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const url = new URL(`/api/v1/documents/${row.id}/content`, app.services.config.publicApiUrl);
  url.searchParams.set('expires', String(expires)); url.searchParams.set('signature', sign(app, row.id, userId, expires));
  return url.toString();
}

export async function documentsRoutes(app: FastifyInstance) {
  app.post('/documents', { schema: routeSchema('uploadDocument'), bodyLimit: maximumDocumentBytes + 32768 }, async (request, reply) => {
    const user = await requireUser(request);
    if (!request.isMultipart()) throw new AppError(415, 'MULTIPART_REQUIRED', 'Gunakan multipart/form-data untuk mengunggah dokumen.');
    const fields: Record<string, string> = {};
    let file: { bytes: Buffer; filename: string; mime: string } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 3, parts: 4, fileSize: maximumDocumentBytes, fieldSize: 200 } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) throw new AppError(422, 'INVALID_UPLOAD', 'Unggah tepat satu field file.');
        file = { bytes: await part.toBuffer(), filename: safeFilename(part.filename), mime: part.mimetype };
      } else {
        if (!['document_type', 'legal_entity_id', 'vendor_order_id'].includes(part.fieldname) || fields[part.fieldname] !== undefined || typeof part.value !== 'string') {
          throw new AppError(422, 'INVALID_UPLOAD', 'Metadata dokumen tidak valid.');
        }
        fields[part.fieldname] = part.value;
      }
    }
    if (!file || !fields.document_type || !documentTypes.has(fields.document_type)
      || Boolean(fields.legal_entity_id) === Boolean(fields.vendor_order_id)) throw new AppError(422, 'INVALID_UPLOAD', 'File, tipe dokumen, dan tepat satu scope wajib diisi.');
    for (const scope of [fields.legal_entity_id, fields.vendor_order_id]) if (scope && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(scope)) throw new AppError(422, 'INVALID_SCOPE', 'Scope harus UUID.');
    if (entityTypes.has(fields.document_type) && !fields.legal_entity_id) throw new AppError(422, 'INVALID_SCOPE', 'Dokumen pajak identitas harus terikat entitas penjual.');
    if (['INVOICE', 'TAX_INVOICE', ...financeTypes].includes(fields.document_type) && !fields.vendor_order_id) throw new AppError(422, 'INVALID_SCOPE', 'Bukti transaksi harus terikat pesanan vendor.');
    const scope = { legalEntityId: fields.legal_entity_id, vendorOrderId: fields.vendor_order_id, documentType: fields.document_type };
    await documentAccess(request, scope);
    const mime = documentMime(file.bytes, file.mime), sha256 = createHash('sha256').update(file.bytes).digest('hex');
    // The idempotency hash includes the file digest, not a huge serialized Buffer or bearer secret.
    request.body = { ...fields, sha256, filename: file.filename, mime_type: mime, size_bytes: file.bytes.length };
    const storage = objectStorage(app.services.config), uploaded = new Set<string>();
    let retained: string | undefined;
    try {
      const result = await executeIdempotent(request, { actorId: user.id, operation: 'uploadDocument' }, async tx => {
        await scanDocument(file!.bytes, app.services.config);
        const id = randomUUID(), objectKey = `private/documents/${user.id}/${id}.enc`;
        const encrypted = encryptDocument(file!.bytes, id, app.services.config.dataEncryptionKey);
        await storage.send(new PutObjectCommand({ Bucket: app.services.config.s3Bucket, Key: objectKey, Body: encrypted,
          ContentType: 'application/octet-stream', ContentLength: encrypted.length }), { abortSignal: AbortSignal.timeout(15000) });
        uploaded.add(objectKey);
        await tx.insert(documents).values({ id, ...scope, uploadedBy: user.id, objectKey, sha256, mimeType: mime,
          verificationStatus: 'PENDING', metadata: { filename: file!.filename, size_bytes: file!.bytes.length, scan_status: 'CLEAN', scanned_at: new Date().toISOString(), encryption: 'AES-256-GCM-v1' } });
        await tx.insert(auditLogs).values({ actorId: user.id, entityType: 'DOCUMENT', entityId: id,
          action: 'DOCUMENT_UPLOADED', correlationId: request.id, changesRedacted: { document_type: scope.documentType, sha256 } });
        const row = await one(tx, documents, id);
        return { statusCode: 201, body: present('Document', { ...row, filename: file!.filename }), headers: { ETag: `"${row.rowVersion}"` } };
      });
      retained = `private/documents/${user.id}/${result.body.id}.enc`;
      return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
    } finally {
      for (const key of uploaded) if (key !== retained) {
        try { await storage.send(new DeleteObjectCommand({ Bucket: app.services.config.s3Bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
        catch { request.log.error({ event: 'document_orphan_cleanup_failed' }, 'Private document cleanup failed'); }
      }
      storage.destroy();
    }
  });

  app.get<{ Params: { documentId: string } }>('/documents/:documentId', { schema: routeSchema('getDocument') }, async (request, reply) => {
    await requireUser(request);
    const row = await one(app.services.db, documents, request.params.documentId) as DocumentRow;
    const user = await documentAccess(request, row);
    await app.services.db.insert(auditLogs).values({ actorId: user.id, entityType: 'DOCUMENT', entityId: row.id,
      action: 'DOCUMENT_ACCESS_GRANTED', correlationId: request.id, changesRedacted: {} });
    reply.header('Cache-Control', 'private, no-store').header('ETag', `"${row.rowVersion}"`);
    return present('Document', { ...row, filename: filename(row),
      ...(row.metadata.scan_status === 'CLEAN' ? { downloadUrl: downloadUrl(app, row, user.id) } : {}) });
  });

  app.get<{ Params: { documentId: string }; Querystring: { expires: number; signature: string } }>('/documents/:documentId/content', {
    schema: { operationId: 'downloadDocumentContent', tags: ['Documents'], params: { type: 'object', required: ['documentId'], properties: { documentId: { type: 'string', format: 'uuid' } } },
      querystring: { type: 'object', additionalProperties: false, required: ['expires', 'signature'], properties: { expires: { type: 'integer' }, signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } } } },
  }, async (request, reply) => {
    const user = await requireUser(request), now = Math.floor(Date.now() / 1000);
    if (request.query.expires < now || request.query.expires > now + 300 || !secureEqual(request.query.signature, sign(app, request.params.documentId, user.id, request.query.expires))) {
      throw new AppError(403, 'DOWNLOAD_EXPIRED', 'Tautan unduh tidak berlaku atau sudah kedaluwarsa.');
    }
    const row = await one(app.services.db, documents, request.params.documentId) as DocumentRow;
    await documentAccess(request, row);
    if (row.metadata.scan_status !== 'CLEAN') throw new AppError(409, 'DOCUMENT_NOT_READY', 'Dokumen belum lolos pemindaian.');
    const storage = objectStorage(app.services.config);
    try {
      const result = await storage.send(new GetObjectCommand({ Bucket: app.services.config.s3Bucket, Key: row.objectKey }), { abortSignal: AbortSignal.timeout(15000) });
      if (!result.Body || !result.ContentLength || result.ContentLength > maximumDocumentBytes + 33) throw new AppError(503, 'DOCUMENT_CORRUPT', 'Dokumen tidak dapat diunduh.');
      const bytes = decryptDocument(Buffer.from(await result.Body.transformToByteArray()), row.id, app.services.config.dataEncryptionKey);
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AppError(503, 'DOCUMENT_CORRUPT', 'Integritas dokumen tidak valid.');
      await app.services.db.insert(auditLogs).values({ actorId: user.id, entityType: 'DOCUMENT', entityId: row.id,
        action: 'DOCUMENT_DOWNLOADED', correlationId: request.id, changesRedacted: {} });
      reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename(row))}`).type(row.mimeType);
      return reply.send(bytes);
    } finally { storage.destroy(); }
  });

  operation(app, 'verifyDocument', async ctx => {
    const row = await one(ctx.db, documents, ctx.params.documentId, undefined, true) as DocumentRow;
    version(ctx.request, row);
    if (row.verificationStatus !== 'PENDING') throw new AppError(409, 'INVALID_STATE', 'Dokumen tidak sedang menunggu verifikasi.');
    if (ctx.body.decision === 'APPROVE' && row.metadata.scan_status !== 'CLEAN') throw new AppError(422, 'DOCUMENT_UNSCANNED', 'Dokumen harus lolos pemindaian sebelum disetujui.');
    const verificationStatus = ctx.body.decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
    await ctx.db.update(documents).set({ verificationStatus, verifiedBy: ctx.user.id, rowVersion: row.rowVersion + 1 }).where(eq(documents.id, row.id));
    await audit(ctx, 'DOCUMENT', row.id, 'DOCUMENT_DECISION', { from: row.verificationStatus, to: verificationStatus });
    return { ...await one(ctx.db, documents, row.id), filename: filename(row) };
  });
}
