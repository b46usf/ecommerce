import { AppError } from '../../shared/errors.js';
import { int32Max } from '../catalog/policy.js';

export function adjustedOnHand(onHand: number, reserved: number, delta: number): number {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > int32Max) {
    throw new AppError(422, 'INVALID_STOCK_DELTA', 'Stock delta must be a non-zero signed 32-bit integer.');
  }
  const next = onHand + delta;
  if (next < reserved) throw new AppError(409, 'INSUFFICIENT_AVAILABLE_STOCK', 'Adjustment cannot reduce on-hand stock below reserved stock.');
  if (next > int32Max) throw new AppError(422, 'STOCK_LIMIT_EXCEEDED', 'Stock exceeds the supported integer range.');
  return next;
}
