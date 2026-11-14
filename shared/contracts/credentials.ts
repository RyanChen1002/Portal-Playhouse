import type { AppError } from './types';

export const PASSWORD_MIN = 8;

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
  return null;
}
