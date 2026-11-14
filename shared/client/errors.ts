// Maps Supabase errors to the contract's AppError (spec §5.4, §5.5).
// SQL functions raise errcode PTxyz with message = the contract code, detail = human text and
// hint = the field name; PostgREST turns PTxyz into HTTP status xyz.
import { ERROR_CODES } from '../contracts/index';
import type { AppError, ErrorCode, ErrorField } from '../contracts/index';

export interface RpcErrorLike {
  message?: string;
  code?: string;
  hint?: string | null;
  details?: string | null;
  status?: number;
}

export interface AuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
}

/** Plain-language fallback text per code. Never the bare code. */
export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Please check what you entered and try again.',
  UNAUTHORIZED: 'Please sign in first.',
  DISPLAY_NAME_TAKEN: 'That display name is already taken.',
  EMAIL_TAKEN: 'An account with that email already exists.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  WEAK_PASSWORD: 'Please choose a stronger password.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SERVICE_UNAVAILABLE: 'The service is unavailable right now. Please try again later.',
};

export function appError(code: ErrorCode, field?: ErrorField, message?: string): AppError {
  const text = message !== undefined && message.trim().length > 0 ? message : DEFAULT_MESSAGES[code];
  return field === undefined ? { code, message: text } : { code, message: text, field };
}

const RPC_FIELDS: readonly string[] = ['displayName', 'avatarId'];

const isErrorCode = (x: unknown): x is ErrorCode =>
  typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);

export function mapRpcError(err: RpcErrorLike | null | undefined): AppError {
  if (!err) return appError('SERVICE_UNAVAILABLE');

  // Raised by our SQL functions: message is the contract code.
  if (isErrorCode(err.message)) {
    const field =
      typeof err.hint === 'string' && RPC_FIELDS.includes(err.hint) ? (err.hint as ErrorField) : undefined;
    const details = typeof err.details === 'string' ? err.details : undefined;
    return appError(err.message, field, details);
  }

  // Not signed in (anon lacks EXECUTE: 42501 over HTTP 401) or a bad/expired JWT (PGRST30x).
  if (
    err.status === 401 ||
    err.code === '42501' ||
    (typeof err.code === 'string' && err.code.startsWith('PGRST30'))
  ) {
    return appError('UNAUTHORIZED');
  }

  return appError('SERVICE_UNAVAILABLE');
}

export function mapAuthError(err: AuthErrorLike | null | undefined): AppError {
  if (!err) return appError('SERVICE_UNAVAILABLE');
  switch (err.code) {
    case 'user_already_exists':
    case 'email_exists':
      return appError('EMAIL_TAKEN', 'email');
    case 'invalid_credentials':
      return appError('INVALID_CREDENTIALS');
    case 'weak_password':
      return appError('WEAK_PASSWORD', 'password');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return appError('RATE_LIMITED');
    case 'validation_failed':
    case 'email_address_invalid':
      return appError('VALIDATION_ERROR', 'email', 'Please enter a valid email address.');
  }
  if (err.status === 429) return appError('RATE_LIMITED');
  // AuthRetryableFetchError / status 0 (network failure) and anything else.
  return appError('SERVICE_UNAVAILABLE');
}
