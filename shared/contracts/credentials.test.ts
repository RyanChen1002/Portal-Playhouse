import { describe, expect, it } from 'vitest';
import { ERROR_CODES, validateCredentials } from './index';

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
