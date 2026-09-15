import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { auditLogs, outboxEvents, products, productMedia, uploadIntents } from '../../database/schema.js';
import { requireStoreRole, requireUser } from '../auth/index.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { AppError } from '../../shared/errors.js';
import type { Config } from '../../config.js';
import { routeSchema } from '../../shared/contracts.js';
import type { DatabaseTransaction } from '../../database/index.js';
import { scanDocument } from '../documents/security.js';
import { maximumProductImageBytes, prepareProductImage } from './image.js';

export function objectStorage(config: Config): S3Client {
  if (!config.s3Endpoint || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Object storage belum dikonfigurasi.');
  return new S3Client({ endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true, credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }, maxAttempts: 2 });
}
const params = { type: 'object', required: ['storeId', 'productId'], properties: { storeId: { type: 'string', format: 'uuid' }, productId: { type: 'string', format: 'uuid' } }, additionalProperties: false };
const headers = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', minLength: 16, maxLength: 128 } } };
type Params = { storeId: string; productId: string };
type ConfirmBody = { upload_id: string; alt_text: string; sort_order: number };

function metadata(body: { alt_text: string; sort_order: number }) {
  if (typeof body.alt_text !== 'string' || !body.alt_text.trim() || body.alt_text.trim().length > 300 || !Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 4294967295) {
    throw new AppError(422, 'INVALID_MEDIA_METADATA', 'Alt text wajib berisi maksimal 300 karakter; sort_order harus integer 0–4294967295.');
  }
  return { altText: body.alt_text.trim(), sortOrder: body.sort_order };
}
async function checkMediaCapacity(tx: DatabaseTransaction, productId: string, sortOrder: number) {
  const existing = await tx.select().from(productMedia).where(eq(productMedia.productId, productId));
  const pending = await tx.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, productId),
    eq(outboxEvents.eventType, 'MEDIA_PROCESS_REQUESTED'), inArray(outboxEvents.state, ['READY', 'PROCESSING'])));
  if (existing.length + pending.length >= 8) throw new AppError(422, 'MEDIA_LIMIT', 'Maksimal 8 gambar per produk.');
  if (existing.some(row => row.sortOrder === sortOrder) || pending.some(row => row.payload.sortOrder === sortOrder)) {
    throw new AppError(409, 'MEDIA_POSITION_USED', 'Posisi gambar sudah digunakan atau sedang diproses.');
  }
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post<{ Params: Params; Body: { content_type: string; size_bytes: number } }>('/vendor/stores/:storeId/products/:productId/media/upload-url', {
    schema: { operationId: 'createProductMediaUploadUrl', tags: ['Vendor Catalog'], params, headers, body: { type: 'object', additionalProperties: false, required: ['content_type', 'size_bytes'], properties: { content_type: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] }, size_bytes: { type: 'integer', minimum: 1, maximum: maximumProductImageBytes } } } },
  }, async (request, reply) => {
    const user = await requireUser(request);
    await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    const storage = objectStorage(app.services.config);
    try {
      const result = await executeIdempotent(request, { actorId: user.id, operation: 'createProductMediaUploadUrl' }, async tx => {
        const [product] = await tx.select().from(products).where(and(eq(products.id, request.params.productId), eq(products.storeId, request.params.storeId))).for('update');
        if (!product) throw new AppError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
        const id = randomUUID();
        const objectKey = `quarantine/${user.id}/${id}`;
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        const command = new PutObjectCommand({ Bucket: app.services.config.s3Bucket, Key: objectKey, ContentType: request.body.content_type, ContentLength: request.body.size_bytes });
        const url = await getSignedUrl(storage, command, { expiresIn: 900, signableHeaders: new Set(['content-type', 'content-length']) });
        await tx.insert(uploadIntents).values({ id, userId: user.id, storeId: product.storeId, productId: product.id, objectKey, contentType: request.body.content_type, sizeBytes: request.body.size_bytes, expiresAt });
        return { statusCode: 201, body: { upload_id: id, upload_url: url, object_key: objectKey, expires_at: expiresAt.toISOString(), max_size_bytes: maximumProductImageBytes, headers: { 'Content-Type': request.body.content_type } } };
      });
      return reply.code(result.statusCode).send(result.body);
    } finally { storage.destroy(); }
  });
  const confirm = async (request: FastifyRequest<{ Params: Params; Body: ConfirmBody }>, reply: FastifyReply) => {
    const user = await requireUser(request);
    await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    if (!request.body || typeof request.body.upload_id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(request.body.upload_id) || Object.keys(request.body).some(key => !['upload_id', 'alt_text', 'sort_order'].includes(key))) {
      throw new AppError(422, 'INVALID_MEDIA_METADATA', 'Konfirmasi upload tidak valid.');
    }
    const fields = metadata(request.body);
    const result = await executeIdempotent(request, { actorId: user.id, operation: 'confirmProductMediaUpload' }, async tx => {
      const [product] = await tx.select().from(products).where(and(eq(products.id, request.params.productId), eq(products.storeId, request.params.storeId))).for('update');
      if (!product) throw new AppError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
      const [intent] = await tx.select().from(uploadIntents).where(and(eq(uploadIntents.id, request.body.upload_id), eq(uploadIntents.userId, user.id), eq(uploadIntents.productId, product.id), eq(uploadIntents.storeId, product.storeId))).for('update');
      if (!intent) throw new AppError(404, 'NOT_FOUND', 'Upload tidak ditemukan.');
      if (intent.confirmedAt) throw new AppError(409, 'UPLOAD_ALREADY_CONFIRMED', 'Upload sudah dikonfirmasi.');
      if (intent.expiresAt <= new Date()) throw new AppError(422, 'UPLOAD_EXPIRED', 'Minta URL upload baru.');
      await checkMediaCapacity(tx, product.id, fields.sortOrder);
      const id = randomUUID();
      await tx.update(uploadIntents).set({ confirmedAt: new Date() }).where(eq(uploadIntents.id, intent.id));
      await tx.insert(outboxEvents).values({ id, eventKey: `media:${intent.id}`, aggregateType: 'PRODUCT', aggregateId: product.id, eventType: 'MEDIA_PROCESS_REQUESTED', payload: { intentId: intent.id, userId: user.id, altText: fields.altText, sortOrder: fields.sortOrder, requestId: request.id } });
      return { statusCode: 202, body: { id, state: 'QUEUED', status_url: `/api/v1/operations/${id}` } };
    });
    return reply.code(result.statusCode).send(result.body);
  };
  app.post<{ Params: Params; Body: ConfirmBody }>('/vendor/stores/:storeId/products/:productId/media/confirm', {
    schema: { operationId: 'confirmProductMediaUpload', tags: ['Vendor Catalog'], params, headers,
      body: { type: 'object', additionalProperties: false, required: ['upload_id', 'alt_text', 'sort_order'], properties: { upload_id: { type: 'string', format: 'uuid' }, alt_text: { type: 'string', minLength: 1, maxLength: 300 }, sort_order: { type: 'integer', minimum: 0, maximum: 4294967295 } } } },
  }, confirm);

  app.post<{ Params: Params; Body: ConfirmBody }>('/vendor/stores/:storeId/products/:productId/media', {
    schema: routeSchema('uploadProductMedia'), bodyLimit: maximumProductImageBytes + 32768,
  }, async (request, reply) => {
    if (!request.isMultipart()) return confirm(request, reply);
    const user = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
    let file: { bytes: Buffer; mime: string } | undefined;
    const form: Record<string, string> = {};
    for await (const part of request.parts({ limits: { files: 1, fields: 2, parts: 3, fileSize: maximumProductImageBytes, fieldSize: 1200 } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) throw new AppError(422, 'INVALID_MEDIA_UPLOAD', 'Unggah tepat satu file gambar.');
        file = { bytes: await part.toBuffer(), mime: part.mimetype };
      } else {
        if (!['alt_text', 'sort_order'].includes(part.fieldname) || typeof part.value !== 'string' || form[part.fieldname] !== undefined) throw new AppError(422, 'INVALID_MEDIA_UPLOAD', 'Field gambar tidak valid.');
        form[part.fieldname] = part.value;
      }
    }
    if (!file || form.alt_text === undefined || !form.sort_order || !/^(0|[1-9][0-9]*)$/.test(form.sort_order)) throw new AppError(422, 'INVALID_MEDIA_UPLOAD', 'file, alt_text, dan sort_order wajib diisi.');
    const fields = metadata({ alt_text: form.alt_text, sort_order: Number(form.sort_order) });
    const digest = createHash('sha256').update(file.bytes).digest('hex');
    request.body = { ...fields, sha256: digest, mime: file.mime } as unknown as ConfirmBody;
    const client = objectStorage(app.services.config), uploaded = new Set<string>();
    let retainedPrefix: string | undefined;
    try {
      const result = await executeIdempotent(request, { actorId: user.id, operation: 'uploadProductMedia' }, async tx => {
        const [product] = await tx.select().from(products).where(and(eq(products.id, request.params.productId), eq(products.storeId, request.params.storeId))).for('update');
        if (!product) throw new AppError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
        await checkMediaCapacity(tx, product.id, fields.sortOrder);
        await scanDocument(file!.bytes, app.services.config);
        const prepared = await prepareProductImage(file!.bytes, file!.mime), id = randomUUID();
        for (const variant of prepared.variants) {
          const key = `products/${product.id}/${id}/${variant.name}.webp`;
          await client.send(new PutObjectCommand({ Bucket: app.services.config.s3Bucket, Key: key, Body: variant.bytes,
            ContentType: 'image/webp', CacheControl: 'public,max-age=31536000,immutable' }), { abortSignal: AbortSignal.timeout(15000) });
          uploaded.add(key);
        }
        const objectKey = `products/${product.id}/${id}/detail.webp`;
        await tx.insert(productMedia).values({ id, productId: product.id, objectKey, ...fields });
        await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1` }).where(eq(products.id, product.id));
        await tx.insert(auditLogs).values({ actorId: user.id, entityType: 'PRODUCT', entityId: product.id, action: 'MEDIA_PUBLISHED',
          correlationId: request.id, changesRedacted: { media_id: id, sha256: prepared.checksum } });
        const [row] = await tx.select().from(productMedia).where(eq(productMedia.id, id));
        return { statusCode: 201, body: { id, created_at: row!.createdAt.toISOString(), row_version: row!.rowVersion,
          url: `${app.services.config.mediaBaseUrl.replace(/\/$/, '')}/${objectKey}`, alt_text: fields.altText, sort_order: fields.sortOrder }, headers: { ETag: `"${row!.rowVersion}"` } };
      });
      retainedPrefix = `products/${request.params.productId}/${result.body.id}/`;
      return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
    } finally {
      for (const key of uploaded) if (!retainedPrefix || !key.startsWith(retainedPrefix)) {
        try { await client.send(new DeleteObjectCommand({ Bucket: app.services.config.s3Bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
        catch { request.log.error({ event: 'media_orphan_cleanup_failed' }, 'Image cleanup failed'); }
      }
      client.destroy();
    }
  });
}
