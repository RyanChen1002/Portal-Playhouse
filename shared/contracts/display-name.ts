import type { AppError } from './types';

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 24;

// Whitespace set W (identical to the SQL rule).
const W_CLASS =
  '\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const W_EDGES = new RegExp(`^[${W_CLASS}]+|[${W_CLASS}]+$`, 'gu');
const W_RUNS = new RegExp(`[${W_CLASS}]+`, 'gu');

// Disallowed set D, checked after normalizing.
const D = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF\\uFFF9-\\uFFFB]',
  'u',
);

export function normalizeDisplayName(raw: string): string {
  return raw.replace(W_EDGES, '').replace(W_RUNS, ' ');
}

export function validateDisplayName(
  raw: string,
): { ok: true; value: string } | { ok: false; error: AppError } {
  const value = normalizeDisplayName(raw);
  const length = Array.from(value).length;
  const fail = (message: string) => ({
    ok: false as const,
    error: { code: 'VALIDATION_ERROR' as const, message, field: 'displayName' as const },
  });
  if (length < DISPLAY_NAME_MIN) return fail('Please enter a display name.');
  if (length > DISPLAY_NAME_MAX) {
    return fail(`Display names can be at most ${DISPLAY_NAME_MAX} characters.`);
  }
  if (D.test(value)) return fail('That display name contains characters that are not allowed.');
  return { ok: true, value };
}

export function displayNameKey(normalized: string): string {
  return normalized.toLowerCase();
}
