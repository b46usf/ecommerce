import { describe, expect, it } from 'vitest';
import { accountNumber, fraction, maskedAccount, overlaps, period } from '../src/modules/finance-config/policy.js';
import { decryptDocument, documentMime, encryptDocument } from '../src/modules/documents/security.js';

describe('financial policy boundaries', () => {
  it('preserves representable decimal fractions and rejects silent rounding', () => {
    expect(fraction(0.02)).toBe('0.02000000');
    expect(fraction(0.00000001)).toBe('0.00000001');
    expect(() => fraction(0.123456789)).toThrow();
    expect(() => fraction(Number.NaN)).toThrow();
    expect(() => fraction(1.01)).toThrow();
  });
  it('uses exclusive interval ends and rejects invalid periods', () => {
    const first = period('2030-01-01', '2031-01-01');
    expect(overlaps(first, period('2031-01-01', null))).toBe(false);
    expect(overlaps(first, period('2030-12-31', '2032-01-01'))).toBe(true);
    expect(() => period('2030-01-01', '2030-01-01')).toThrow();
  });
  it('normalizes account separators while retaining leading zeroes', () => {
    expect(accountNumber('0012-3456 789')).toBe('00123456789');
    expect(maskedAccount('00123456789')).toBe('*******6789');
    expect(() => accountNumber('1e100000')).toThrow();
  });
});

describe('private document security', () => {
  it('binds authenticated encryption to document ID and rejects tampering', () => {
    const input = Buffer.from('private tax document'), secret = 'encryption-secret';
    const encrypted = encryptDocument(input, 'document-a', secret);
    expect(encrypted.includes(input)).toBe(false);
    expect(decryptDocument(encrypted, 'document-a', secret)).toEqual(input);
    expect(() => decryptDocument(encrypted, 'document-b', secret)).toThrow();
    const tampered = Buffer.from(encrypted); tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptDocument(tampered, 'document-a', secret)).toThrow();
  });
  it('rejects MIME spoofing and active or truncated PDF content', () => {
    expect(documentMime(Buffer.from('%PDF-1.4\n%%EOF'), 'application/pdf')).toBe('application/pdf');
    expect(() => documentMime(Buffer.from('%PDF-1.4\n/JavaScript (evil)\n%%EOF'), 'application/pdf')).toThrow();
    expect(() => documentMime(Buffer.from('%PDF-1.4'), 'application/pdf')).toThrow();
    expect(() => documentMime(Buffer.from('%PDF-1.4\n%%EOF'), 'image/png')).toThrow();
  });
});
