import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { maximumAvatarImageBytes, prepareAvatarImage } from '../src/modules/media/image.js';
import { deleteMediaObject, publicMediaUrl, writeMediaObject } from '../src/modules/media/storage.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('profile and product media processing', () => {
  it('normalizes an avatar to a safe square WebP', async () => {
    const input = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#1683d8' } }).png().toBuffer();
    const result = await prepareAvatarImage(input, 'image/png');
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(prepareAvatarImage(Buffer.alloc(maximumAvatarImageBytes + 1), 'image/png')).rejects.toMatchObject({ code: 'INVALID_IMAGE_SIZE' });
    await expect(prepareAvatarImage(input, 'image/jpeg')).rejects.toMatchObject({ code: 'INVALID_IMAGE_CONTENT' });
  });

  it('writes and removes development media only inside the configured directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-media-'));
    directories.push(directory);
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'mysql://app:test@127.0.0.1/media_test', REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'media-test-secret-with-at-least-32-characters', LOCAL_MEDIA_DIR: directory,
      S3_PUBLIC_BASE_URL: 'http://127.0.0.1:3000/demo-products',
    });
    const key = 'profiles/test/avatar.webp';
    await writeMediaObject(config, key, Buffer.from('safe-image'), 'image/webp');
    expect(await readFile(join(directory, 'profiles', 'test', 'avatar.webp'), 'utf8')).toBe('safe-image');
    expect(publicMediaUrl(config, key)).toBe('http://127.0.0.1:3000/demo-products/profiles/test/avatar.webp');
    await expect(writeMediaObject(config, '../escape.webp', Buffer.from('x'), 'image/webp')).rejects.toMatchObject({ code: 'INVALID_OBJECT_KEY' });
    await deleteMediaObject(config, key);
    await expect(readFile(join(directory, 'profiles', 'test', 'avatar.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
