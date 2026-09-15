import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type EmailTokenPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

/** Reconstructable by the mail worker; neither database nor queue stores the bearer token. */
export function createEmailToken(tokenId: string, purpose: EmailTokenPurpose, secret: string): string {
  const mac = createHmac('sha256', secret)
    .update(`marketplace:auth-email:v1:${purpose}:${tokenId}`)
    .digest('base64url');
  return `${tokenId}.${mac}`;
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
