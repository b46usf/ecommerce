import { and, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { authTokens, users, uploadIntents, productMedia, products, auditLogs } from '../database/schema.js';
import { createEmailToken } from '../modules/auth/tokens.js';
import { objectStorage } from '../modules/media/index.js';
import type { Services } from '../services.js';
import { scanDocument } from '../modules/documents/security.js';
import { maximumProductImageBytes, prepareProductImage } from '../modules/media/image.js';

export async function processAuthEmail(services: Services, payload: Record<string, unknown>, signal: AbortSignal) {
  const { config, db } = services;
  if (!config.smtpHost) throw new Error('SMTP_NOT_CONFIGURED');
  const [token] = await db.select().from(authTokens).where(eq(authTokens.id, String(payload.tokenId))).limit(1);
  if (!token || token.consumedAt || token.revokedAt || token.expiresAt <= new Date()) return;
  if (!['VERIFY_EMAIL', 'RESET_PASSWORD'].includes(token.purpose)) throw new Error('INVALID_TOKEN_PURPOSE');
  const [user] = await db.select().from(users).where(eq(users.id, token.userId)).limit(1);
  if (!user || user.status !== 'ACTIVE') return;
  signal.throwIfAborted();
  const raw = createEmailToken(token.id, token.purpose as 'VERIFY_EMAIL' | 'RESET_PASSWORD', config.authTokenSecret);
  const url = new URL(token.purpose === 'VERIFY_EMAIL' ? '/verify-email' : '/reset-password', config.publicAppUrl);
  // Fragment avoids carrying the token into reverse-proxy access logs and Referer headers.
  url.hash = new URLSearchParams({ token: raw }).toString();
  const transport = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 15000 });
  const abort = () => transport.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    // Stable Message-ID reduces duplicates; SMTP delivery remains at least once after a crash.
    await transport.sendMail({ from: config.smtpFrom, to: user.emailNormalized, messageId: `<auth-${token.id}@marketplace.local>`, subject: token.purpose === 'VERIFY_EMAIL' ? 'Verifikasi email Marketplace' : 'Pemulihan password Marketplace', text: `Buka tautan berikut sebelum kedaluwarsa:\n${url.toString()}\n\nAbaikan email ini jika Anda tidak meminta tindakan tersebut.` });
  } finally { signal.removeEventListener('abort', abort); transport.close(); }
}

export async function processMedia(services: Services, payload: Record<string, unknown>, signal: AbortSignal) {
  const { db, config } = services;
  const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, String(payload.intentId))).limit(1);
  if (!intent || !intent.confirmedAt) throw new Error('UPLOAD_NOT_CONFIRMED');
  if (intent.verifiedObjectKey) return;
  const client = objectStorage(config);
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: intent.objectKey }), { abortSignal: signal });
    if (!response.Body || response.ContentLength !== intent.sizeBytes || response.ContentLength > maximumProductImageBytes) throw new Error('INVALID_FILE_SIZE');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted(); size += chunk.length;
      if (size > maximumProductImageBytes || size > intent.sizeBytes) throw new Error('INVALID_FILE_SIZE');
      chunks.push(Buffer.from(chunk));
    }
    if (size !== intent.sizeBytes) throw new Error('INVALID_FILE_SIZE');
    const bytes = Buffer.concat(chunks);
    await scanDocument(bytes, config);
    const prepared = await prepareProductImage(bytes, intent.contentType);
    for (const variant of prepared.variants) {
      signal.throwIfAborted();
      await client.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: `products/${intent.productId}/${intent.id}/${variant.name}.webp`, Body: variant.bytes, ContentType: 'image/webp', CacheControl: 'public,max-age=31536000,immutable' }), { abortSignal: signal });
    }
    const objectKey = `products/${intent.productId}/${intent.id}/detail.webp`;
    signal.throwIfAborted();
    await db.transaction(async tx => {
      const [product] = await tx.select().from(products).where(eq(products.id, intent.productId)).for('update');
      const [locked] = await tx.select().from(uploadIntents).where(eq(uploadIntents.id, intent.id)).for('update');
      if (!product || !locked) throw new Error('RESOURCE_MISSING');
      if (locked.verifiedObjectKey) return;
      await tx.insert(productMedia).values({ id: intent.id, productId: intent.productId, objectKey, altText: String(payload.altText), sortOrder: Number(payload.sortOrder) });
      await tx.update(uploadIntents).set({ verifiedObjectKey: objectKey, checksumSha256: prepared.checksum }).where(eq(uploadIntents.id, intent.id));
      await tx.update(products).set({ rowVersion: sql`${products.rowVersion} + 1` }).where(eq(products.id, product.id));
      await tx.insert(auditLogs).values({ actorId: intent.userId, entityType: 'PRODUCT', entityId: intent.productId, action: 'MEDIA_PUBLISHED', changesRedacted: { mediaId: intent.id }, correlationId: String(payload.requestId ?? intent.id) });
    });
  } finally { client.destroy(); }
}

export async function releaseFailedMedia(services: Services, payload: Record<string, unknown>) {
  await services.db.update(uploadIntents).set({ confirmedAt: null }).where(and(eq(uploadIntents.id, String(payload.intentId)), sql`${uploadIntents.verifiedObjectKey} IS NULL`));
}
