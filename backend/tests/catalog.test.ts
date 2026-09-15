import { describe, expect, it } from 'vitest';
import { assertVersion, cursorScope, decodeCursor, encodeCursor, expectedVersion, productValues, sanitizeDescription, skuValues,
  type SkuWrite } from '../src/modules/catalog/policy.js';
import { adjustedOnHand } from '../src/modules/inventory/policy.js';

const sku: SkuWrite = { sku_code: 'PENCIL-01', unit_label: 'pcs', unit_price_gross: 15_000,
  weight_g: 500, length_cm: 20, width_cm: 10.25, height_cm: 4 };

describe('catalog safety policies', () => {
  it('removes scripts, handlers, embedded media and unsafe links but preserves formatting', () => {
    const result = sanitizeDescription('<p onclick="steal()">Hello <strong>buyer</strong></p><script>alert(1)</script><iframe src="https://evil.test"></iframe><a href="javascript:steal()">bad</a><img src=x onerror=steal()><a href="https://example.test">safe</a>');
    expect(result).toContain('<p>Hello <strong>buyer</strong></p>');
    expect(result).not.toMatch(/script|onclick|onerror|iframe|<img|javascript:/);
    expect(result).toContain('href="https://example.test"');
    expect(result).toContain('rel="nofollow noopener noreferrer"');
  });

  it('rejects whitespace-only names and unsafe slugs', () => {
    const body = { name: '  ', slug: 'valid-slug', description: 'ok', category_id: 'id', tax_class_id: 'id' };
    expect(() => productValues(body)).toThrow();
    expect(() => productValues({ ...body, name: 'Pen', slug: '../admin' })).toThrow();
    expect(() => productValues({ ...body, name: 'x'.repeat(201) })).toThrow();
  });

  it('preserves safe integer money exactly and represents dimensions as DECIMAL strings', () => {
    const result = skuValues({ ...sku, unit_price_gross: Number.MAX_SAFE_INTEGER });
    expect(result.unitPriceGross).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.widthCm).toBe('10.25');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid money %s', price => {
    expect(() => skuValues({ ...sku, unit_price_gross: price })).toThrow();
  });

  it.each([0, -1, 1.001, Infinity, 100_000_000])('rejects unrepresentable packaging dimension %s', length => {
    expect(() => skuValues({ ...sku, length_cm: length })).toThrow();
  });

  it('rejects weight overflow before hitting the database', () => {
    expect(() => skuValues({ ...sku, weight_g: 2_147_483_648 })).toThrow();
  });
});

describe('optimistic concurrency', () => {
  it('requires exactly one quoted safe integer version', () => {
    expect(expectedVersion('"0"')).toBe(0);
    expect(expectedVersion('"9007199254740991"')).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ['0', '*', 'W/"0"', '"01"', '"0", "1"', '"9007199254740992"', '"-1"']) {
      expect(() => expectedVersion(value)).toThrow();
    }
    expect(() => expectedVersion(undefined)).toThrow(expect.objectContaining({ statusCode: 428 }));
    expect(() => assertVersion(2, 1)).toThrow(expect.objectContaining({ statusCode: 412 }));
    expect(() => assertVersion(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow();
  });
});

describe('opaque query cursors', () => {
  const cursor = { id: '6fe1ff70-13cc-485d-8971-fbcac309a01f', scope: cursorScope({ store: 'a', sort: 'price_asc' }), value: 12000 };
  it('round trips the continuation without allowing cross-query reuse', () => {
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded, cursor.scope)).toEqual(cursor);
    expect(() => decodeCursor(encoded, cursorScope({ store: 'b', sort: 'price_asc' }))).toThrow();
  });
  it('rejects malformed cursors and untrusted SQL-shaped IDs', () => {
    expect(() => decodeCursor('???', cursor.scope)).toThrow();
    expect(() => decodeCursor(encodeCursor({ ...cursor, id: "' OR 1=1" }), cursor.scope)).toThrow();
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ ...cursor, extra: true })).toString('base64url'), cursor.scope)).toThrow();
  });
});

describe('inventory invariants', () => {
  it('allows restock and removal of only unreserved units', () => {
    expect(adjustedOnHand(10, 7, 20)).toBe(30);
    expect(adjustedOnHand(10, 7, -3)).toBe(7);
    expect(adjustedOnHand(1, 0, -1)).toBe(0);
  });
  it('protects reserved stock and integer storage boundaries', () => {
    expect(() => adjustedOnHand(10, 7, -4)).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => adjustedOnHand(10, 0, -11)).toThrow();
    expect(() => adjustedOnHand(2_147_483_647, 0, 1)).toThrow();
  });
  it.each([0, 1.1, Infinity, NaN, 2_147_483_648])('rejects invalid delta %s', delta => {
    expect(() => adjustedOnHand(10, 0, delta)).toThrow();
  });
});
