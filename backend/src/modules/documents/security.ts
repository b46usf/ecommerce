import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { AppError } from '../../shared/errors.js';

export const maximumDocumentBytes = 10 * 1024 * 1024;
export function documentMime(data: Buffer, declared: string): string {
  let detected: string | undefined;
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') {
    detected = 'application/pdf';
    if (!data.subarray(-1024).includes(Buffer.from('%%EOF')) || /\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(data.toString('latin1'))) {
      throw new AppError(422, 'UNSAFE_PDF', 'PDF harus lengkap dan tidak boleh memuat konten aktif atau lampiran.');
    }
  } else if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detected = 'image/png';
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) detected = 'image/jpeg';
  if (!detected || detected !== declared || !data.length || data.length > maximumDocumentBytes) {
    throw new AppError(422, 'INVALID_DOCUMENT', 'Dokumen harus PDF, JPEG, atau PNG yang sesuai MIME, maksimal 10 MiB.');
  }
  return detected;
}

export function encryptDocument(data: Buffer, documentId: string, secret: string): Buffer {
  const iv = randomBytes(12), key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(documentId));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from('MDOC1'), iv, cipher.getAuthTag(), encrypted]);
}
export function decryptDocument(data: Buffer, documentId: string, secret: string): Buffer {
  if (data.length < 33 || data.subarray(0, 5).toString() !== 'MDOC1') throw new Error('Invalid encrypted document');
  const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), data.subarray(5, 17));
  cipher.setAAD(Buffer.from(documentId));
  cipher.setAuthTag(data.subarray(17, 33));
  return Buffer.concat([cipher.update(data.subarray(33)), cipher.final()]);
}

/** Fail closed: only an explicit ClamAV INSTREAM OK response releases an upload. */
export async function scanDocument(data: Buffer, config: { clamavHost?: string; clamavPort: number; clamavTimeoutMs: number }): Promise<void> {
  if (!config.clamavHost) throw new AppError(503, 'DOCUMENT_SCANNER_UNAVAILABLE', 'Pemindai dokumen belum dikonfigurasi.');
  const socket = createConnection({ host: config.clamavHost, port: config.clamavPort });
  const deadline = setTimeout(() => socket.destroy(new Error('Scanner deadline exceeded')), config.clamavTimeoutMs);
  const result = new Promise<void>((resolve, reject) => {
    let response = '';
    socket.setTimeout(config.clamavTimeoutMs, () => socket.destroy(new Error('Scanner timeout')));
    socket.on('error', () => reject(new AppError(503, 'DOCUMENT_SCANNER_UNAVAILABLE', 'Pemindai dokumen tidak tersedia.')));
    socket.on('data', chunk => {
      response += chunk.toString();
      if (response.length > 4096) socket.destroy(new Error('Invalid scanner response'));
      if (!response.includes('\0') && !response.includes('\n')) return;
      if (/^stream: OK[\0\r\n]*$/.test(response)) resolve();
      else if (/FOUND[\0\r\n]*$/.test(response)) reject(new AppError(422, 'MALWARE_DETECTED', 'Dokumen ditolak oleh pemindai keamanan.'));
      else reject(new AppError(503, 'DOCUMENT_SCANNER_UNAVAILABLE', 'Pemindai belum memberikan hasil yang valid.'));
      socket.destroy();
    });
    socket.on('close', () => reject(new AppError(503, 'DOCUMENT_SCANNER_UNAVAILABLE', 'Pemindaian dokumen tidak selesai.')));
  });
  // Attach immediately so connection failures cannot become unhandled while frames are written.
  const send = async () => {
    await once(socket, 'connect');
    socket.write('zINSTREAM\0');
    for (let offset = 0; offset < data.length; offset += 65536) {
      const chunk = data.subarray(offset, offset + 65536), length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length);
      if (!socket.write(Buffer.concat([length, chunk]))) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
  };
  try { await Promise.all([send(), result]); } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'DOCUMENT_SCANNER_UNAVAILABLE', 'Pemindai dokumen tidak tersedia.');
  } finally { clearTimeout(deadline); socket.destroy(); }
}
