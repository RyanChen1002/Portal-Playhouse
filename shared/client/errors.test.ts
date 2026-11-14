import { describe, expect, it } from 'vitest';
import type { AppError, ErrorCode, ErrorField } from '../contracts/index';
import { mapAuthError, mapRpcError } from './errors';

function expectMapped(e: AppError, code: ErrorCode, field?: ErrorField) {
  expect(e.code).toBe(code);
  expect(typeof e.message).toBe('string');
  expect(e.message.length).toBeGreaterThan(0);
  expect(e.message).not.toBe(code); // plain language, never the bare code
  if (field === undefined) expect(e).not.toHaveProperty('field');
  else expect(e.field).toBe(field);
}

describe('mapRpcError', () => {
  it('PT409 DISPLAY_NAME_TAKEN with hint displayName', () => {
    expectMapped(
      mapRpcError({ message: 'DISPLAY_NAME_TAKEN', code: 'PT409', hint: 'displayName' }),
      'DISPLAY_NAME_TAKEN',
      'displayName',
    );
  });

  it('PT400 VALIDATION_ERROR with hint avatarId, using details as the message', () => {
    const e = mapRpcError({
      message: 'VALIDATION_ERROR',
      code: 'PT400',
      hint: 'avatarId',
      details: 'Please choose one of the avatars.',
      status: 400,
    });
    expectMapped(e, 'VALIDATION_ERROR', 'avatarId');
    expect(e.message).toBe('Please choose one of the avatars.');
  });

  it('PT400 VALIDATION_ERROR with no hint has no field', () => {
    expectMapped(mapRpcError({ message: 'VALIDATION_ERROR', code: 'PT400', hint: undefined }), 'VALIDATION_ERROR');
  });

  it('unknown hint -> no field', () => {
    expectMapped(mapRpcError({ message: 'VALIDATION_ERROR', code: 'PT400', hint: 'email' }), 'VALIDATION_ERROR');
    expectMapped(mapRpcError({ message: 'VALIDATION_ERROR', code: 'PT400', hint: 'bogus' }), 'VALIDATION_ERROR');
  });

  it('PT401 UNAUTHORIZED and PT503 SERVICE_UNAVAILABLE', () => {
    expectMapped(mapRpcError({ message: 'UNAUTHORIZED', code: 'PT401', status: 401 }), 'UNAUTHORIZED');
    expectMapped(mapRpcError({ message: 'SERVICE_UNAVAILABLE', code: 'PT503', status: 503 }), 'SERVICE_UNAVAILABLE');
  });

  it('{code: 42501} -> UNAUTHORIZED', () => {
    expectMapped(mapRpcError({ code: '42501' }), 'UNAUTHORIZED');
    expectMapped(
      mapRpcError({ code: '42501', message: 'permission denied for function get_me', status: 401 }),
      'UNAUTHORIZED',
    );
  });

  it('HTTP 401 -> UNAUTHORIZED', () => {
    expectMapped(mapRpcError({ message: 'whatever', status: 401 }), 'UNAUTHORIZED');
  });

  it('PostgREST JWT errors (PGRST30x) -> UNAUTHORIZED', () => {
    expectMapped(
      mapRpcError({
        code: 'PGRST301',
        message: 'No suitable key or wrong key type',
        details: 'None of the keys was able to decode the JWT',
      }),
      'UNAUTHORIZED',
    );
    expectMapped(mapRpcError({ code: 'PGRST303', message: 'JWT expired' }), 'UNAUTHORIZED');
  });

  it("{message:'boom'} -> SERVICE_UNAVAILABLE", () => {
    expectMapped(mapRpcError({ message: 'boom' }), 'SERVICE_UNAVAILABLE');
  });

  it('network failure (status 0) and null -> SERVICE_UNAVAILABLE', () => {
    expectMapped(mapRpcError({ message: 'TypeError: fetch failed', status: 0 }), 'SERVICE_UNAVAILABLE');
    expectMapped(mapRpcError(null), 'SERVICE_UNAVAILABLE');
  });
});

describe('mapAuthError', () => {
  it('user_already_exists / email_exists -> EMAIL_TAKEN on email', () => {
    expectMapped(mapAuthError({ code: 'user_already_exists', status: 422 }), 'EMAIL_TAKEN', 'email');
    expectMapped(mapAuthError({ code: 'email_exists', status: 422 }), 'EMAIL_TAKEN', 'email');
  });

  it('invalid_credentials -> INVALID_CREDENTIALS with no field', () => {
    expectMapped(mapAuthError({ code: 'invalid_credentials', status: 400 }), 'INVALID_CREDENTIALS');
  });

  it('weak_password -> WEAK_PASSWORD on password', () => {
    expectMapped(mapAuthError({ code: 'weak_password', status: 422 }), 'WEAK_PASSWORD', 'password');
  });

  it('rate limits -> RATE_LIMITED', () => {
    expectMapped(mapAuthError({ code: 'over_request_rate_limit', status: 429 }), 'RATE_LIMITED');
    expectMapped(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 }), 'RATE_LIMITED');
    expectMapped(mapAuthError({ status: 429 }), 'RATE_LIMITED');
  });

  it('validation_failed / email_address_invalid -> VALIDATION_ERROR on email', () => {
    expectMapped(mapAuthError({ code: 'validation_failed', status: 400 }), 'VALIDATION_ERROR', 'email');
    expectMapped(mapAuthError({ code: 'email_address_invalid', status: 400 }), 'VALIDATION_ERROR', 'email');
  });

  it('AuthRetryableFetchError or status 0 -> SERVICE_UNAVAILABLE', () => {
    expectMapped(mapAuthError({ name: 'AuthRetryableFetchError', status: 502 }), 'SERVICE_UNAVAILABLE');
    expectMapped(mapAuthError({ status: 0 }), 'SERVICE_UNAVAILABLE');
  });

  it('anything else -> SERVICE_UNAVAILABLE', () => {
    expectMapped(mapAuthError({ code: 'unexpected_failure', status: 500 }), 'SERVICE_UNAVAILABLE');
    expectMapped(mapAuthError({}), 'SERVICE_UNAVAILABLE');
    expectMapped(mapAuthError(null), 'SERVICE_UNAVAILABLE');
  });
});
