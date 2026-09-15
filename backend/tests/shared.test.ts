import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptSensitive, decryptSensitive, fingerprint } from '../src/shared/crypto.js';
import { canonicalJson } from '../src/shared/idempotency.js';
import { loadConfig } from '../src/config.js';

describe('security and idempotency primitives', () => {
  it('canonicalizes nested object order while preserving array order', () => {
    expect(canonicalJson({ b: [1, 2], a: { d: 2, c: 1 } })).toBe(canonicalJson({ a: { c: 1, d: 2 }, b: [1, 2] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('encrypts identifiers with contextual authenticated randomized encryption', () => {
    const a = encryptSensitive('sensitive-identifier', 'test-key', 'tax-identifier');
    expect(a.startsWith('v2.')).toBe(true);
    expect(a).not.toContain('sensitive-identifier');
    expect(a).not.toBe(encryptSensitive('sensitive-identifier', 'test-key', 'tax-identifier'));
    expect(decryptSensitive(a, 'test-key', 'tax-identifier')).toBe('sensitive-identifier');
    expect(() => decryptSensitive(a, 'test-key', 'bank-account-number')).toThrow();
    expect(() => decryptSensitive(a, 'another-key', 'tax-identifier')).toThrow();
    const fields = a.split('.');
    fields[2] = `${fields[2]![0] === 'A' ? 'B' : 'A'}${fields[2]!.slice(1)}`;
    expect(() => decryptSensitive(fields.join('.'), 'test-key', 'tax-identifier')).toThrow();
    expect(fingerprint('123', 'a')).not.toBe(fingerprint('123', 'b'));
  });
  it('reads legacy v1 ciphertext while keeping database fingerprints stable', () => {
    const secret = 'legacy-test-key';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
    const encrypted = Buffer.concat([cipher.update('legacy-value', 'utf8'), cipher.final()]);
    const legacy = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
    expect(decryptSensitive(legacy, secret, 'any-new-context')).toBe('legacy-value');
    expect(fingerprint('123', 'a')).toBe(createHmac('sha256', 'a').update('fingerprint:123').digest('hex'));
  });
  it('rejects insecure production configuration without exposing secret values', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: 'mysql://app:password@localhost/db', REDIS_URL: 'redis://localhost:6379', SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters' };
    expect(() => loadConfig(env)).toThrow('HTTPS');
    expect(() => loadConfig({ ...env, DATABASE_URL: 'secret-invalid-url' })).not.toThrow('secret-invalid-url');
  });
});
