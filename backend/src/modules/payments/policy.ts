import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors.js';

export function rupiah(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.0+)?$/.test(value)) throw new AppError(422, 'INVALID_PROVIDER_AMOUNT', 'Nominal provider harus rupiah bulat.');
  const amount = BigInt(value.split('.')[0]!);
  if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError(422, 'INVALID_PROVIDER_AMOUNT', 'Nominal provider melampaui batas.');
  return Number(amount);
}
export function validSignature(body: { order_id: string; status_code: string; gross_amount: string; signature_key: string }, secret: string): boolean {
  if (!/^[a-fA-F0-9]{128}$/.test(body.signature_key)) return false;
  const expected = createHash('sha512').update(body.order_id + body.status_code + body.gross_amount + secret).digest();
  return timingSafeEqual(expected, Buffer.from(body.signature_key, 'hex'));
}
export function paymentMethodLimits(capabilities: Record<string, unknown>, channels: string[]) {
  const limits = capabilities.payment_limits as Record<string, { minimum_amount?: number; maximum_amount?: number }> | undefined;
  return channels.flatMap(channel => {
    const limit = limits?.[channel];
    if (!limit || !Number.isSafeInteger(limit.minimum_amount) || !Number.isSafeInteger(limit.maximum_amount) || limit.minimum_amount! < 1 || limit.maximum_amount! < limit.minimum_amount!) return [];
    return [{ code: channel, name: channel, minimum_amount: limit.minimum_amount!, maximum_amount: limit.maximum_amount!, buyer_surcharge: 0 }];
  });
}
