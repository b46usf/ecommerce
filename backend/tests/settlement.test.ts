import { describe, expect, it } from 'vitest';
import { integerAmount, proportionalReversal, refundSplit, safeAmount } from '../src/modules/settlement/policy.js';

describe('settlement integer accounting', () => {
  it('recovers every original component after partial refunds without negative allocations', () => {
    const totals = { commission: 0, commissionVat: 0, withholding: 0, vendorAmount: 0 };
    for (let previous = 0; previous < 37; previous++) {
      const split = refundSplit(37, 11, 9, 8, previous, 1);
      expect(Object.values(split).every(value => value >= 0)).toBe(true);
      expect(Object.values(split).reduce((sum, value) => sum + value, 0)).toBe(1);
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += split[key];
    }
    expect(totals).toEqual({ commission: 11, commissionVat: 9, withholding: 8, vendorAmount: 9 });
  });
  it('uses exact cumulative rounding even near the JavaScript safe integer limit', () => {
    expect(proportionalReversal(3, 10, 9, 1)).toBe(1);
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(refundSplit(maximum, 2000, 220, 0, maximum - 1, 1)).toEqual({ commission: 1, commissionVat: 0, withholding: 0, vendorAmount: 0 });
    expect(() => safeAmount(BigInt(maximum) + 1n)).toThrow();
    expect(() => integerAmount(1.5)).toThrow();
    expect(() => refundSplit(100, 60, 50, 0, 0, 100)).toThrow();
  });
});
