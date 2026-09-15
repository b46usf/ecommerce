import { AppError } from '../../shared/errors.js';

export const refundableStates = ['REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED'];
export const pendingRefundStates = ['REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN'];
export const reservedPayoutStates = ['DRAFT', 'APPROVED', 'PROCESSING', 'UNKNOWN'];

export function integerAmount(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AppError(422, 'INVALID_AMOUNT', 'Nominal harus berupa rupiah bulat positif yang aman.');
  }
  return BigInt(value);
}

export function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(422, 'AMOUNT_OVERFLOW', 'Jumlah melebihi batas nominal.');
  }
  return Number(value);
}

/** Cumulative allocation returns every last rupiah on the final partial refund. */
export function proportionalReversal(component: number, base: number, previous: number, current: number): number {
  if (![component, base, previous, current].every(Number.isSafeInteger) || component < 0 || base <= 0 || previous < 0 || current <= 0 || BigInt(previous) + BigInt(current) > BigInt(base)) {
    throw new AppError(422, 'REFUND_ALLOCATION_INVALID', 'Alokasi refund melampaui komponen asli.');
  }
  const amount = BigInt(component), denominator = BigInt(base), start = BigInt(previous);
  return safeAmount((amount * (start + BigInt(current))) / denominator - (amount * start) / denominator);
}

export function refundSplit(gross: number, commission: number, commissionVat: number, withholding: number, previous: number, amount: number) {
  if (commission + commissionVat + withholding > gross) throw new AppError(409, 'INVALID_REFUND_SPLIT', 'Potongan vendor melampaui nilai barang.');
  proportionalReversal(0, gross, previous, amount);
  const splitAt = (refunded: number) => {
    let remainder = BigInt(refunded), denominator = BigInt(gross);
    const result: bigint[] = [];
    for (const component of [commission, commissionVat, withholding]) {
      const allocated = denominator === 0n ? 0n : remainder * BigInt(component) / denominator;
      result.push(allocated); remainder -= allocated; denominator -= BigInt(component);
    }
    return [...result, remainder];
  };
  const before = splitAt(previous), after = splitAt(previous + amount);
  const result = after.map((value, index) => safeAmount(value - before[index]!));
  return { commission: result[0]!, commissionVat: result[1]!, withholding: result[2]!, vendorAmount: result[3]! };
}

export function reason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > 2000) throw new AppError(422, 'INVALID_REASON', 'Alasan harus berisi 3–2000 karakter.');
  return value.trim();
}

export function externalReference(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > 191 || [...value].some(character => character.charCodeAt(0) < 32)) throw new AppError(422, 'INVALID_TRANSFER_REFERENCE', 'Referensi transfer harus berisi 3–191 karakter.');
  return value.trim();
}
