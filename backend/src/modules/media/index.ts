import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { auditLogs, outboxEvents, products, productMedia, uploadIntents } from '../../database/schema.js';
import { requireStoreRole, requireUser } from '../auth/index.js';
import { executeIdempotent } from '../../shared/idempotency.js';
import { AppError } from '../../shared/errors.js';
import { routeSchema } from '../../shared/contracts.js';
import type { DatabaseTransaction } from '../../database/index.js';
import { scanDocument } from '../documents/security.js';
import { maximumProductImageBytes, prepareProductImage } from './image.js';
import { deleteMediaObject, objectStorage, publicMediaUrl, writeMediaObject } from './storage.js';
import { assertVersion, expectedVersion } from '../catalog/policy.js';

export { objectStorage } from './storage.js';

const params = { type: 'object', required: ['storeId', 'productId'], properties: { storeId: { type: 'string', format: 'uuid' }, productId: { type: 'string', format: 'uuid' } }, additionalProperties: false };
const headers = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', minLength: 16, maxLength: 128 } } };
type Params = { storeId: string; productId: string };
type MediaParams = Params & { mediaId: string };
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
    const uploaded = new Set<string>();
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
          await writeMediaObject(app.services.config, key, variant.bytes, 'image/webp');
          uploaded.add(key);
        }
        const objectKey = `products/${product.id}/${id}/detail.webp`;
        await tx.insert(productMedia).values({ id, productId: product.id, objectKey, ...fields });
        await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1` }).where(eq(products.id, product.id));
        await tx.insert(auditLogs).values({ actorId: user.id, entityType: 'PRODUCT', entityId: product.id, action: 'MEDIA_PUBLISHED',
          correlationId: request.id, changesRedacted: { media_id: id, sha256: prepared.checksum } });
        const [row] = await tx.select().from(productMedia).where(eq(productMedia.id, id));
        return { statusCode: 201, body: { id, created_at: row!.createdAt.toISOString(), row_version: row!.rowVersion,
          url: publicMediaUrl(app.services.config, objectKey)!, alt_text: fields.altText, sort_order: fields.sortOrder }, headers: { ETag: `"${row!.rowVersion}"` } };
      });
      retainedPrefix = `products/${request.params.productId}/${result.body.id}/`;
      return reply.code(result.statusCode).headers(result.headers ?? {}).send(result.body);
    } finally {
      for (const key of uploaded) if (!retainedPrefix || !key.startsWith(retainedPrefix)) {
        try { await deleteMediaObject(app.services.config, key); }
        catch { request.log.error({ event: 'media_orphan_cleanup_failed' }, 'Image cleanup failed'); }
      }
    }
  });

  app.patch<{ Params: MediaParams; Body: { alt_text: string }; Headers: { 'if-match': string } }>(
    '/vendor/stores/:storeId/products/:productId/media/:mediaId',
    { schema: routeSchema('updateProductMedia') },
    async (request, reply) => {
      const user = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
      const altText = request.body.alt_text.trim();
      if (!altText || altText.length > 300) throw new AppError(422, 'INVALID_MEDIA_METADATA', 'Teks alternatif wajib berisi maksimal 300 karakter.');
      const version = expectedVersion(request.headers['if-match']);
      const row = await app.services.db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(and(eq(products.id, request.params.productId), eq(products.storeId, request.params.storeId))).limit(1).for('update');
        if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.');
        const [media] = await tx.select().from(productMedia).where(and(eq(productMedia.id, request.params.mediaId), eq(productMedia.productId, product.id))).limit(1).for('update');
        if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Gambar produk tidak ditemukan.');
        assertVersion(media.rowVersion, version);
        const updated = { ...media, altText, rowVersion: media.rowVersion + 1, updatedAt: new Date() };
        await tx.update(productMedia).set({ altText, rowVersion: updated.rowVersion, updatedAt: updated.updatedAt }).where(eq(productMedia.id, media.id));
        await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1`, updatedAt: new Date() }).where(eq(products.id, product.id));
        await tx.insert(auditLogs).values({ actorId: user.id, entityType: 'PRODUCT_MEDIA', entityId: media.id, action: 'UPDATE', correlationId: request.id,
          changesRedacted: { product_id: product.id, before_version: media.rowVersion, after_version: updated.rowVersion } });
        return updated;
      });
      reply.header('ETag', `"${row.rowVersion}"`);
      return { id: row.id, created_at: row.createdAt.toISOString(), row_version: row.rowVersion,
        url: publicMediaUrl(app.services.config, row.objectKey)!, alt_text: row.altText, sort_order: row.sortOrder };
    },
  );

  app.delete<{ Params: MediaParams; Headers: { 'if-match': string } }>(
    '/vendor/stores/:storeId/products/:productId/media/:mediaId',
    { schema: routeSchema('deleteProductMedia') },
    async (request, reply) => {
      const user = await requireStoreRole(request, request.params.storeId, ['OWNER', 'CATALOG']);
      const version = expectedVersion(request.headers['if-match']);
      const removed = await app.services.db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(and(eq(products.id, request.params.productId), eq(products.storeId, request.params.storeId))).limit(1).for('update');
        if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.');
        const mediaRows = await tx.select().from(productMedia).where(eq(productMedia.productId, product.id));
        const media = mediaRows.find(item => item.id === request.params.mediaId);
        if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Gambar produk tidak ditemukan.');
        assertVersion(media.rowVersion, version);
        if (product.status === 'ACTIVE' && mediaRows.length === 1) {
          throw new AppError(409, 'PRODUCT_IMAGE_REQUIRED', 'Produk aktif harus memiliki minimal satu gambar. Unggah pengganti terlebih dahulu.');
        }
        await tx.delete(productMedia).where(eq(productMedia.id, media.id));
        await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1`, updatedAt: new Date() }).where(eq(products.id, product.id));
        await tx.insert(auditLogs).values({ actorId: user.id, entityType: 'PRODUCT_MEDIA', entityId: media.id, action: 'DELETE', correlationId: request.id,
          changesRedacted: { product_id: product.id } });
        return media;
      });
      if (removed.objectKey.startsWith(`products/${request.params.productId}/`)) {
        const prefix = removed.objectKey.replace(/[^/]+$/, '');
        for (const name of ['thumbnail', 'card', 'detail', 'zoom']) {
          try { await deleteMediaObject(app.services.config, `${prefix}${name}.webp`); }
          catch { request.log.error({ event: 'media_cleanup_failed', mediaId: removed.id }, 'Image cleanup failed'); }
        }
      }
      return reply.code(204).send();
    },
  );
}
