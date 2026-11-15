import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PASSWORD_MAX_BYTES, validateCredentials } from './index';

describe('credentials', () => {
  it('rejects a bad email', () => {
    const e = validateCredentials({ email: 'not-an-email', password: 'longenough' });
    expect(e?.code).toBe('VALIDATION_ERROR');
    expect(e?.field).toBe('email');
  });

  it('rejects a short password', () => {
    const e = validateCredentials({ email: 'a@b.co', password: '1234567' });
    expect(e?.code).toBe('WEAK_PASSWORD');
    expect(e?.field).toBe('password');
  });

  it('counts password code points', () => {
    expect(validateCredentials({ email: 'a@b.co', password: '🙂'.repeat(8) })).toBeNull();
    expect(validateCredentials({ email: 'a@b.co', password: '🙂'.repeat(7) })?.code).toBe('WEAK_PASSWORD');
  });

  it('exports the 72-byte password limit (bcrypt)', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it('accepts a password of exactly 72 ASCII characters', () => {
    expect(validateCredentials({ email: 'a@b.co', password: 'a'.repeat(72) })).toBeNull();
  });

  it('rejects a password longer than 72 bytes on the password field', () => {
    for (const password of ['a'.repeat(73), 'a'.repeat(80)]) {
      const e = validateCredentials({ email: 'a@b.co', password });
      expect(e?.code).toBe('WEAK_PASSWORD');
      expect(e?.field).toBe('password');
      expect(e?.message).toMatch(/too long/i);
    }
  });

  it('measures the upper limit in UTF-8 bytes, not code points', () => {
    // U+1F642 is 4 bytes in UTF-8: 18 of them are 72 bytes, 19 are 76 bytes (19 code points).
    expect(validateCredentials({ email: 'a@b.co', password: '\u{1F642}'.repeat(18) })).toBeNull();
    const e = validateCredentials({ email: 'a@b.co', password: '\u{1F642}'.repeat(19) });
    expect(e?.code).toBe('WEAK_PASSWORD');
    expect(e?.field).toBe('password');
  });

  it('accepts a valid pair', () => {
    expect(validateCredentials({ email: 'a@b.co', password: '12345678' })).toBeNull();
  });

  it('lists the eight error codes', () => {
    expect([...ERROR_CODES]).toEqual([
      'VALIDATION_ERROR', 'UNAUTHORIZED', 'DISPLAY_NAME_TAKEN', 'EMAIL_TAKEN',
      'INVALID_CREDENTIALS', 'WEAK_PASSWORD', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE',
    ]);
  });
});
