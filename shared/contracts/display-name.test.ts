import { describe, expect, it } from 'vitest';
import {
  AVATAR_IDS,
  displayNameKey,
  isAvatarId,
  normalizeDisplayName,
  validateDisplayName,
} from './index';

function expectInvalid(raw: string) {
  const r = validateDisplayName(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe('VALIDATION_ERROR');
    expect(r.error.field).toBe('displayName');
    expect(r.error.message.length).toBeGreaterThan(0);
  }
}

describe('display name', () => {
  it('normalizes whitespace', () => {
    expect(normalizeDisplayName('  Ada  \t Lovelace  ')).toBe('Ada Lovelace');
    expect(normalizeDisplayName('a\u00A0\u3000b')).toBe('a b');
  });

  it('counts code points', () => {
    expect(validateDisplayName('\uD83D\uDE42'.repeat(24))).toEqual({ ok: true, value: '\uD83D\uDE42'.repeat(24) });
    expectInvalid('\uD83D\uDE42'.repeat(25));
    expect(validateDisplayName('e\u0301').ok).toBe(true);
  });

  it('bounds', () => {
    expectInvalid('');
    expectInvalid('   ');
    expect(validateDisplayName('a'.repeat(24)).ok).toBe(true);
    expectInvalid('a'.repeat(25));
  });

  it('rejects disallowed', () => {
    expectInvalid('a\u200Bb');
    expectInvalid('a\u202Eb');
    expectInvalid('\uFEFFab');
    expectInvalid('a\u0007b');
  });

  it('handles characters in both W and D (pinned identically in SQL)', () => {
    expect(normalizeDisplayName('\u0085a\u0085b ')).toBe('a b');
    expect(validateDisplayName('\u0085a\u0085b ')).toEqual({ ok: true, value: 'a b' });
    expect(normalizeDisplayName('a\u0085b')).toBe('a b');
    expect(validateDisplayName('a\u0085b')).toEqual({ ok: true, value: 'a b' });
    expect(normalizeDisplayName('a\u00A0b')).toBe('a b');
    expect(validateDisplayName('a\u00A0b')).toEqual({ ok: true, value: 'a b' });
  });

  it('rejects boundary characters of D when internal', () => {
    expectInvalid('a\u00ADb');
    expectInvalid('a\u061Cb');
    expectInvalid('a\u180Eb');
    expectInvalid('a\u2060b');
    expectInvalid('a\uFFF9b');
  });

  it('allows visible unicode', () => {
    expect(validateDisplayName('Zo\u00EB').ok).toBe(true);
    expect(validateDisplayName('\u5C71\u7530').ok).toBe(true);
  });

  it('returns the normalized value', () => {
    expect(validateDisplayName('  Ada   L ')).toEqual({ ok: true, value: 'Ada L' });
  });

  it('key is case-insensitive', () => {
    expect(displayNameKey('Alex')).toBe(displayNameKey('aLEX'));
  });

  it('avatar ids', () => {
    expect(AVATAR_IDS.length).toBe(20);
    expect(AVATAR_IDS[0]).toBe('avatar-01');
    expect(AVATAR_IDS[19]).toBe('avatar-20');
    expect(isAvatarId('avatar-21')).toBe(false);
    expect(isAvatarId('avatar-07')).toBe(true);
    expect(isAvatarId(7)).toBe(false);
  });
});
