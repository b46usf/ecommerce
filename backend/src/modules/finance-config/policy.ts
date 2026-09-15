import { AppError } from '../../shared/errors.js';

export function fraction(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1 || Number(value.toFixed(8)) !== value) {
    throw new AppError(422, 'INVALID_RATE', 'Tarif harus 0–1 dengan maksimal delapan angka desimal.');
  }
  return value.toFixed(8);
}

export function period(from: string, until?: string | null) {
  const validFrom = new Date(from), validUntil = until ? new Date(until) : null;
  if (!Number.isFinite(validFrom.getTime()) || (validUntil && (!Number.isFinite(validUntil.getTime()) || validUntil <= validFrom))) {
    throw new AppError(422, 'INVALID_PERIOD', 'Akhir periode harus setelah awal periode.');
  }
  return { validFrom, validUntil };
}

export function overlaps(a: { validFrom: Date; validUntil: Date | null }, b: { validFrom: Date; validUntil: Date | null }): boolean {
  return (!a.validUntil || b.validFrom < a.validUntil) && (!b.validUntil || a.validFrom < b.validUntil);
}

export function accountNumber(value: string): string {
  const normalized = value.replace(/[ -]/g, '');
  if (!/^\d{5,34}$/.test(normalized)) throw new AppError(422, 'INVALID_BANK_ACCOUNT', 'Nomor rekening harus berisi 5–34 digit.');
  return normalized;
}

export function maskedAccount(value: string): string { return `${'*'.repeat(Math.max(value.length - 4, 1))}${value.slice(-4)}`; }
