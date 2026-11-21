import { describe, expect, it } from 'vitest';
import type { AppError, Result } from '../../shared/contracts/index';
import { signInLoadUsers, type AuthClient } from './accounts';

/** A fake auth client over a shared set of existing emails; counts every call. */
function fakeAuth(existing: Set<string>, calls: string[], password = 'pw') {
  const fail = (code: AppError['code']): Result<null> => ({ data: null, error: { code } as AppError });
  return (): AuthClient => ({
    async signIn({ email, password: p }) {
      calls.push(`in ${email}`);
      return existing.has(email) && p === password ? { data: null, error: null } : fail('INVALID_CREDENTIALS');
    },
    async signUp({ email }) {
      calls.push(`up ${email}`);
      if (existing.has(email)) return fail('EMAIL_TAKEN');
      existing.add(email);
      return { data: null, error: null };
    },
  });
}

const users = (n: number, make: () => AuthClient) =>
  Array.from({ length: n }, (_, i) => ({ tag: `load${i + 1}`, client: make(), email: `u+${i + 1}@x`, displayName: `Load${i + 1}` }));

describe('signInLoadUsers', () => {
  it('signs in existing users without signing up', async () => {
    const calls: string[] = [];
    const existing = new Set(['u+1@x', 'u+2@x', 'u+3@x']);
    await signInLoadUsers(users(3, fakeAuth(existing, calls)), 'pw', () => {});
    expect(calls).toEqual(['in u+1@x', 'in u+2@x', 'in u+3@x']);
  });

  it('on a first run, stops trying sign-in once a sign-up succeeds (17 calls for 16 users)', async () => {
    const calls: string[] = [];
    const created: string[] = [];
    await signInLoadUsers(users(16, fakeAuth(new Set(), calls)), 'pw', (email) => created.push(email));
    expect(calls).toHaveLength(17);
    expect(calls.slice(0, 2)).toEqual(['in u+1@x', 'up u+1@x']);
    expect(created).toHaveLength(16);
  });

  it('after a partial earlier run, signs in the rest it finds already taken', async () => {
    const calls: string[] = [];
    const existing = new Set(['u+1@x', 'u+3@x']);
    await signInLoadUsers(users(3, fakeAuth(existing, calls)), 'pw', () => {});
    expect(calls).toEqual(['in u+1@x', 'in u+2@x', 'up u+2@x', 'up u+3@x', 'in u+3@x']);
  });

  it('stops with the tag and code when a user cannot sign in or sign up', async () => {
    const calls: string[] = [];
    const existing = new Set(['u+1@x']);
    const make = fakeAuth(existing, calls, 'other-password');
    await expect(signInLoadUsers(users(2, make), 'pw', () => {})).rejects.toThrow(/load1.*EMAIL_TAKEN/);
  });
});
