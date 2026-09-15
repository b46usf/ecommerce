import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../shared/errors.js';

export const maximumProductImageBytes = 5 * 1024 * 1024;
export async function prepareProductImage(bytes: Buffer, declaredMime: string) {
  if (!bytes.length || bytes.length > maximumProductImageBytes) throw new AppError(422, 'INVALID_IMAGE_SIZE', 'Gambar harus berukuran 1 byte–5 MiB.');
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).timeout({ seconds: 10 }).metadata();
    const formats: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    if (!metadata.format || formats[metadata.format] !== declaredMime || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported format');
    const variants: { name: string; bytes: Buffer }[] = [];
    for (const [name, width] of [['thumbnail', 160], ['card', 400], ['detail', 800], ['zoom', 1600]] as const) {
      const body = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).timeout({ seconds: 10 })
        .rotate().resize(width, width, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      variants.push({ name, bytes: body });
    }
    return { variants, checksum: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'INVALID_IMAGE_CONTENT', 'Isi gambar harus JPEG, PNG, atau WebP satu frame yang valid, maksimal 40 juta piksel.');
  }
}
