import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../../config.js';
import { AppError } from '../../shared/errors.js';

export function objectStorage(config: Config): S3Client {
  if (!config.s3Endpoint || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Object storage belum dikonfigurasi.');
  }
  return new S3Client({
    endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }, maxAttempts: 2,
  });
}

function localPath(config: Config, objectKey: string): string {
  if (!config.localMediaDir) {
    throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Object storage belum dikonfigurasi.');
  }
  if (objectKey.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new AppError(422, 'INVALID_OBJECT_KEY', 'Lokasi media tidak valid.');
  }
  const root = resolve(config.localMediaDir);
  const target = resolve(root, ...objectKey.split('/'));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new AppError(422, 'INVALID_OBJECT_KEY', 'Lokasi media tidak valid.');
  }
  return target;
}

function hasS3(config: Config): boolean {
  return Boolean(config.s3Endpoint && config.s3Bucket && config.s3AccessKeyId && config.s3SecretAccessKey);
}

export async function writeMediaObject(config: Config, objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
  if (hasS3(config)) {
    const client = objectStorage(config);
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.s3Bucket, Key: objectKey, Body: bytes, ContentType: contentType,
        CacheControl: 'public,max-age=31536000,immutable',
      }), { abortSignal: AbortSignal.timeout(15000) });
    } finally { client.destroy(); }
    return;
  }
  const target = localPath(config, objectKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}

export async function deleteMediaObject(config: Config, objectKey: string): Promise<void> {
  if (hasS3(config)) {
    const client = objectStorage(config);
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(5000) });
    } finally { client.destroy(); }
    return;
  }
  await rm(localPath(config, objectKey), { force: true });
}

export function publicMediaUrl(config: Config, objectKey: string | null): string | null {
  if (!objectKey) return null;
  return `${config.mediaBaseUrl.replace(/\/$/, '')}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}
