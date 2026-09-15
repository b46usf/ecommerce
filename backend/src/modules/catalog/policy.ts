import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { AppError } from '../../shared/errors.js';

export interface ProductWrite {
  name: string;
  description: string;
  category_id: string;
  tax_class_id: string;
  slug: string;
  attributes?: Record<string, unknown>;
}

export interface SkuWrite {
  sku_code: string;
  variant_attributes?: Record<string, unknown>;
  unit_label: string;
  unit_price_gross: number;
  weight_g: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}

export const int32Max = 2_147_483_647;

export function boundedText(value: string, label: string, maximum = 255): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum) {
    throw new AppError(422, 'INVALID_FIELD', `${label} must contain 1 to ${maximum} characters.`);
  }
  return cleaned;
}

export function validateSlug(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 160) {
    throw new AppError(422, 'INVALID_SLUG', 'Slug must use lowercase letters, numbers and single hyphens, up to 160 characters.');
  }
  return value;
}

export function sanitizeDescription(value: string): string {
  if (value.length > 100_000) throw new AppError(422, 'DESCRIPTION_TOO_LONG', 'Description exceeds 100000 characters.');
  return sanitizeHtml(value, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a'],
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }) },
  });
}

export function productValues(body: ProductWrite) {
  return {
    name: boundedText(body.name, 'name', 200), description: sanitizeDescription(body.description),
    categoryId: body.category_id, taxClassId: body.tax_class_id,
    slug: validateSlug(body.slug), attributes: body.attributes ?? {},
  };
}

function dimension(value: number, label: string): string {
  // DECIMAL(10,2): reject rounding rather than silently changing shipping dimensions.
  if (!Number.isFinite(value) || value <= 0 || value > 99_999_999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new AppError(422, 'INVALID_DIMENSION', `${label} must be positive with at most two decimal places.`);
  }
  return value.toFixed(2);
}

export function skuValues(body: SkuWrite) {
  if (!Number.isSafeInteger(body.unit_price_gross) || body.unit_price_gross <= 0) {
    throw new AppError(422, 'INVALID_PRICE', 'Price must be a positive safe integer in IDR.');
  }
  if (!Number.isInteger(body.weight_g) || body.weight_g < 1 || body.weight_g > int32Max) {
    throw new AppError(422, 'INVALID_WEIGHT', 'Weight must be a positive 32-bit integer in grams.');
  }
  return {
    skuCode: boundedText(body.sku_code, 'sku_code', 100),
    unitLabel: boundedText(body.unit_label, 'unit_label', 30),
    variantAttributes: body.variant_attributes ?? {}, unitPriceGross: body.unit_price_gross,
    weightG: body.weight_g, lengthCm: dimension(body.length_cm, 'length_cm'),
    widthCm: dimension(body.width_cm, 'width_cm'), heightCm: dimension(body.height_cm, 'height_cm'),
  };
}

export function expectedVersion(value: string | string[] | undefined): number {
  if (value === undefined) throw new AppError(428, 'PRECONDITION_REQUIRED', 'If-Match is required.');
  if (typeof value !== 'string' || !/^"(?:0|[1-9][0-9]*)"$/.test(value)) {
    throw new AppError(400, 'INVALID_IF_MATCH', 'If-Match must contain one quoted integer row version.');
  }
  const version = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(version)) throw new AppError(400, 'INVALID_IF_MATCH', 'If-Match exceeds the safe integer range.');
  return version;
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new AppError(412, 'VERSION_CONFLICT', 'The resource has changed. Fetch it again before updating.');
  if (actual >= Number.MAX_SAFE_INTEGER) throw new AppError(409, 'VERSION_EXHAUSTED', 'Resource version cannot be incremented.');
}

export function cursorScope(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export interface Cursor { id: string; value: string | number; scope: string }
export function encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
export function decodeCursor(encoded: string | undefined, scope: string): Cursor | undefined {
  if (!encoded) return undefined;
  try {
    if (encoded.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('format');
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('format');
    const cursor = parsed as Cursor;
    if (Object.keys(cursor).sort().join(',') !== 'id,scope,value' || cursor.scope !== scope ||
      typeof cursor.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cursor.id) ||
      !((typeof cursor.value === 'number' && Number.isFinite(cursor.value)) || typeof cursor.value === 'string')) throw new Error('format');
    return cursor;
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor is invalid or belongs to another query.');
  }
}
