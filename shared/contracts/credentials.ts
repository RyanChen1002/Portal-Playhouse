import type { AppError } from './types';

export const PASSWORD_MIN = 8;
/** Supabase Auth hashes passwords with bcrypt, which rejects more than 72 bytes of UTF-8. */
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(input: { email: string; password: string }): AppError | null {
  if (!EMAIL_RE.test(input.email)) {
    return { code: 'VALIDATION_ERROR', message: 'Please enter a valid email address.', field: 'email' };
  }
  if (Array.from(input.password).length < PASSWORD_MIN) {
    return {
      code: 'WEAK_PASSWORD',
      message: `Your password must be at least ${PASSWORD_MIN} characters.`,
      field: 'password',
    };
  }
  if (new TextEncoder().encode(input.password).length > PASSWORD_MAX_BYTES) {
    return {
      code: 'WEAK_PASSWORD',
      message: `Your password is too long. Please use at most ${PASSWORD_MAX_BYTES} characters (fewer if it includes emoji or accented letters).`,
      field: 'password',
    };
  }
  return null;
}
