import { describe, expect, it } from 'vitest';
import { formatDate, formatRupiah, lowestPrice, statusLabel, variantLabel } from '../app/utils/format';

describe('buyer transaction presentation helpers', () => {
  it('keeps monetary calculations as integer rupiah at the display boundary', () => {
    expect(formatRupiah(12_500)).toMatch(/12[.,]500/);
    expect(lowestPrice({ skus: [{ unit_price_gross: 20_000 }, { unit_price_gross: 12_500 }] })).toBe(12_500);
    expect(lowestPrice({ skus: [] })).toBeNull();
  });

  it('presents stable labels for transaction states and SKU variants', () => {
    expect(statusLabel('AWAITING_PAYMENT')).toBe('Menunggu pembayaran');
    expect(statusLabel('PARTIALLY_REFUNDED')).toBe('Refund sebagian');
    expect(statusLabel('CUSTOM_STATE')).toBe('custom state');
    expect(variantLabel({ Warna: 'Biru', Ukuran: 42 })).toBe('Warna: Biru · Ukuran: 42');
  });

  it('formats valid API timestamps for the Indonesian locale', () => {
    expect(formatDate('2026-09-14T12:00:00.000Z')).toMatch(/2026/);
  });
});
