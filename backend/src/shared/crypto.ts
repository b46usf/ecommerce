import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

const encoded = /^[A-Za-z0-9_-]+$/
const legacyKey = (secret: string) => createHash('sha256').update(secret).digest()
const contextualKey = (secret: string, context: string) => createHmac('sha256', secret).update(`marketplace:v2:${context}`).digest()
const aad = (context: string) => Buffer.from(`marketplace|v2|${context}`, 'utf8')

function parts(value: string): [string, Buffer, Buffer, Buffer] {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw new Error('Invalid ciphertext')
  const [version, ivText, tagText, dataText, extra] = value.split('.')
  if (!version || !ivText || !tagText || !dataText || extra !== undefined
    || !encoded.test(ivText) || !encoded.test(tagText) || !encoded.test(dataText)) throw new Error('Invalid ciphertext')
  const iv = Buffer.from(ivText, 'base64url'), tag = Buffer.from(tagText, 'base64url'), data = Buffer.from(dataText, 'base64url')
  if (iv.length !== 12 || tag.length !== 16 || !data.length) throw new Error('Invalid ciphertext')
  return [version, iv, tag, data]
}

/** AES-256-GCM envelope. Context is authenticated to prevent ciphertext substitution between fields. */
export function encryptSensitive(value: string, secret: string, context = 'generic'): string {
  if (typeof value !== 'string' || !value.length) throw new Error('Invalid plaintext')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', contextualKey(secret, context), iv)
  cipher.setAAD(aad(context))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v2', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSensitive(value: string, secret: string, context = 'generic'): string {
  const [version, iv, tag, data] = parts(value)
  const key = version === 'v1' ? legacyKey(secret) : version === 'v2' ? contextualKey(secret, context) : undefined
  if (!key) throw new Error('Invalid ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  if (version === 'v2') decipher.setAAD(aad(context))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Stable keyed lookup value. Keep this format stable unless existing rows are migrated atomically. */
export function fingerprint(value: string, secret: string): string {
  return createHmac('sha256', secret).update(`fingerprint:${value}`).digest('hex')
}
