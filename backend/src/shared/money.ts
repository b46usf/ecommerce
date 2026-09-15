import { AppError } from './errors.js';
export const SCALE = 100_000_000n;
export function fraction(rate: string | number): bigint {
  const text = typeof rate === 'number' ? rate.toFixed(8) : rate;
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new AppError(422, 'INVALID_RATE', 'Tarif harus desimal maksimal delapan digit.');
  const [whole, decimal = ''] = text.split('.'); const result = BigInt(whole!) * SCALE + BigInt(decimal.padEnd(8,'0'));
  if (result > SCALE) throw new AppError(422, 'INVALID_RATE', 'Tarif melebihi satu.'); return result;
}
export function halfUp(numerator: bigint, denominator: bigint) { if (denominator <= 0n || numerator < 0n) throw new Error('Invalid monetary fraction'); return (numerator + denominator / 2n) / denominator; }
export function money(value: bigint | number): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new AppError(422, 'AMOUNT_OUT_OF_RANGE', 'Nominal di luar batas API.'); return result;
}
export function total(values: number[]) { return money(values.reduce((sum, value) => sum + BigInt(value), 0n)); }
