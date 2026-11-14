// Shared contract suite: one set of expectations for every PortalClient implementation.
// Runs against the in-memory mock (mock.contract.test.ts) and against the real
// Supabase-backed client on a persistent local database (real.contract.integration.test.ts).
// Every name and email is therefore built from the factory's uniqueness helpers so reruns
// never collide.
import { describe, expect, it } from 'vitest';
import type {
  AppError,
  AvatarId,
  ErrorCode,
  ErrorField,
  PortalClient,
  Profile,
  Result,
  SessionState,
} from '../contracts/index';

export interface ContractFactory {
  /** A fresh client with its own (signed-out) session. */
  newClient(): Promise<PortalClient>;
  /** An email address no other call has returned, across runs. */
  uniqueEmail(): string;
  /** An ASCII name of at most 12 code points, containing a lowercase letter, unique per call. */
  uniqueName(): string;
}

export const TEST_PASSWORD = 'correct-horse-1';
const WRONG_PASSWORD = 'wrong-horse-22';
const PROFILE_KEYS = ['avatarId', 'displayName', 'id', 'winsTotal'];
const TEST_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 200;

const SMILE = '\u{1F642}';
const cp = (s: string) => Array.from(s).length;

function expectOk<T>(r: Result<T>): T {
  expect(r.error, `unexpected error: ${JSON.stringify(r.error)}`).toBeNull();
  expect(r).toHaveProperty('data'); // may be null for Result<null> (signOut)
  return r.data as T;
}

function expectError<T>(r: Result<T>, code: ErrorCode, field?: ErrorField): AppError {
  expect(r.data).toBeNull();
  expect(r.error).not.toBeNull();
  const error = r.error as AppError;
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
  if (field === undefined) {
    expect(error).not.toHaveProperty('field');
  } else {
    expect(error.field).toBe(field);
  }
  return error;
}

function expectProfile(p: Profile, expected: { displayName?: string; avatarId?: AvatarId } = {}) {
  expect(Object.keys(p).sort()).toEqual(PROFILE_KEYS);
  expect(typeof p.id).toBe('string');
  expect(p.id.length).toBeGreaterThan(0);
  expect(p.winsTotal).toBe(0);
  if (expected.displayName !== undefined) expect(p.displayName).toBe(expected.displayName);
  if (expected.avatarId !== undefined) expect(p.avatarId).toBe(expected.avatarId);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, what: string, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(10);
  }
}

export function describeClientContract(label: string, factory: ContractFactory): void {
  // Guard the factory itself: a token that breaks these rules would make some cases
  // pass or fail for the wrong reason (for example, an all-uppercase token is its own
  // "other case"), so fail loudly instead.
  function uniqueName(): string {
    const token = factory.uniqueName();
    expect(typeof token, 'factory.uniqueName() must return a string').toBe('string');
    expect(token, `factory token ${JSON.stringify(token)} must contain a lowercase letter`).not.toBe(
      token.toUpperCase(),
    );
    expect(/^[\x00-\x7F]+$/.test(token), `factory token ${JSON.stringify(token)} must be ASCII`).toBe(true);
    expect(cp(token), `factory token ${JSON.stringify(token)} must be at most 12 code points`).toBeLessThanOrEqual(12);
    return token;
  }

  async function signedUpPlayer(displayName = uniqueName()) {
    const client = await factory.newClient();
    const email = factory.uniqueEmail();
    const profile = expectOk(await client.signUp({ email, password: TEST_PASSWORD, displayName }));
    return { client, email, profile };
  }

  describe(`PortalClient contract: ${label}`, { timeout: TEST_TIMEOUT_MS }, () => {
    describe('sign up and sign in', () => {
      it('signUp returns profile with normalized name and avatar-01, winsTotal 0', async () => {
        const token = uniqueName();
        const { profile } = await signedUpPlayer(`  ${token}   X  `);
        expectProfile(profile, { displayName: `${token} X`, avatarId: 'avatar-01' });
      });

      it('signUp -> signOut -> signIn returns the same profile (AC-01)', async () => {
        const { client, email, profile } = await signedUpPlayer();
        expectOk(await client.signOut());
        const again = expectOk(await client.signIn({ email, password: TEST_PASSWORD }));
        expectProfile(again);
        expect(again).toEqual(profile);
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('signIn matches the email case-insensitively', async () => {
        const { client, email, profile } = await signedUpPlayer();
        expectOk(await client.signOut());
        const again = expectOk(await client.signIn({ email: email.toUpperCase(), password: TEST_PASSWORD }));
        expect(again).toEqual(profile);
      });

      it('signUp with taken name (other case) -> DISPLAY_NAME_TAKEN', async () => {
        const token = uniqueName();
        await signedUpPlayer(token);
        const b = await factory.newClient();
        const r = await b.signUp({
          email: factory.uniqueEmail(),
          password: TEST_PASSWORD,
          displayName: token.toUpperCase(),
        });
        expectError(r, 'DISPLAY_NAME_TAKEN', 'displayName');
        expect(expectOk(await b.getSession())).toEqual({ signedIn: false, playerId: null });
      });

      it('signUp with existing email -> EMAIL_TAKEN', async () => {
        const { email } = await signedUpPlayer();
        const b = await factory.newClient();
        const r = await b.signUp({ email, password: TEST_PASSWORD, displayName: uniqueName() });
        expectError(r, 'EMAIL_TAKEN', 'email');
      });

      it('signIn wrong password -> INVALID_CREDENTIALS', async () => {
        const { client, email } = await signedUpPlayer();
        expectOk(await client.signOut());
        expectError(await client.signIn({ email, password: WRONG_PASSWORD }), 'INVALID_CREDENTIALS');
        expect(expectOk(await client.getSession())).toEqual({ signedIn: false, playerId: null });
      });

      it('signIn unknown email -> INVALID_CREDENTIALS', async () => {
        const client = await factory.newClient();
        const r = await client.signIn({ email: factory.uniqueEmail(), password: TEST_PASSWORD });
        expectError(r, 'INVALID_CREDENTIALS');
      });

      it('signUp short password -> WEAK_PASSWORD', async () => {
        const client = await factory.newClient();
        const r = await client.signUp({
          email: factory.uniqueEmail(),
          password: 'short7!',
          displayName: uniqueName(),
        });
        expectError(r, 'WEAK_PASSWORD', 'password');
      });

      it('signUp bad email -> VALIDATION_ERROR', async () => {
        const client = await factory.newClient();
        const r = await client.signUp({
          email: 'not-an-email',
          password: TEST_PASSWORD,
          displayName: uniqueName(),
        });
        expectError(r, 'VALIDATION_ERROR', 'email');
      });

      it('signUp invalid display name -> VALIDATION_ERROR', async () => {
        const client = await factory.newClient();
        const r = await client.signUp({ email: factory.uniqueEmail(), password: TEST_PASSWORD, displayName: '   ' });
        expectError(r, 'VALIDATION_ERROR', 'displayName');
      });
    });

    describe('session', () => {
      it('getSession reflects sign in/out; onSessionChange fires and unsubscribes', async () => {
        const client = await factory.newClient();
        expect(expectOk(await client.getSession())).toEqual({ signedIn: false, playerId: null });

        const seen: SessionState[] = [];
        const unsubscribe = client.onSessionChange((s) => seen.push(s));
        expect(typeof unsubscribe).toBe('function');

        const email = factory.uniqueEmail();
        const profile = expectOk(
          await client.signUp({ email, password: TEST_PASSWORD, displayName: uniqueName() }),
        );
        expect(expectOk(await client.getSession())).toEqual({ signedIn: true, playerId: profile.id });
        await waitFor(
          () => seen.some((s) => s.signedIn && s.playerId === profile.id),
          'signed-in session event',
        );

        const beforeSignOut = seen.length;
        expectOk(await client.signOut());
        expect(expectOk(await client.getSession())).toEqual({ signedIn: false, playerId: null });
        await waitFor(
          () => seen.slice(beforeSignOut).some((s) => !s.signedIn && s.playerId === null),
          'signed-out session event',
        );

        unsubscribe();
        await sleep(QUIET_PERIOD_MS); // let any event already in flight settle
        const afterUnsubscribe = seen.length;
        expectOk(await client.signIn({ email, password: TEST_PASSWORD }));
        expect(expectOk(await client.getSession())).toEqual({ signedIn: true, playerId: profile.id });
        await sleep(QUIET_PERIOD_MS);
        expect(seen.length).toBe(afterUnsubscribe);
      });

      it('onSessionChange delivers the current (signed-out) state once after subscribing', async () => {
        const client = await factory.newClient();
        const seen: SessionState[] = [];
        const unsubscribe = client.onSessionChange((s) => seen.push(s));
        expect(seen).toEqual([]); // asynchronous, never during the subscribe call
        await waitFor(() => seen.length > 0, 'initial session event');
        expect(seen[0]).toEqual({ signedIn: false, playerId: null });
        await sleep(QUIET_PERIOD_MS);
        expect(seen).toEqual([{ signedIn: false, playerId: null }]);
        unsubscribe();
      });

      it('onSessionChange delivers the current (signed-in) state once after subscribing', async () => {
        const { client, profile } = await signedUpPlayer();
        const seen: SessionState[] = [];
        const unsubscribe = client.onSessionChange((s) => seen.push(s));
        expect(seen).toEqual([]);
        await waitFor(() => seen.length > 0, 'initial session event');
        expect(seen[0]).toEqual({ signedIn: true, playerId: profile.id });
        await sleep(QUIET_PERIOD_MS);
        expect(seen).toEqual([{ signedIn: true, playerId: profile.id }]);
        unsubscribe();
      });

      it('getMe/updateMe while signed out -> UNAUTHORIZED', async () => {
        const fresh = await factory.newClient();
        expectError(await fresh.getMe(), 'UNAUTHORIZED');
        expectError(await fresh.updateMe({ avatarId: 'avatar-02' }), 'UNAUTHORIZED');

        const { client } = await signedUpPlayer();
        expectOk(await client.signOut());
        expectError(await client.getMe(), 'UNAUTHORIZED');
        expectError(await client.updateMe({ displayName: uniqueName() }), 'UNAUTHORIZED');
      });

      it('each client holds its own session', async () => {
        const a = await signedUpPlayer();
        const b = await signedUpPlayer();
        expect(expectOk(await a.client.getMe())).toEqual(a.profile);
        expect(expectOk(await b.client.getMe())).toEqual(b.profile);
        expect(a.profile.id).not.toBe(b.profile.id);
      });
    });

    describe('updateMe', () => {
      it('updateMe({}) -> VALIDATION_ERROR with no field', async () => {
        const { client, profile } = await signedUpPlayer();
        expectError(await client.updateMe({}), 'VALIDATION_ERROR');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('updateMe({displayName: null}) -> VALIDATION_ERROR on displayName, profile unchanged', async () => {
        const { client, profile } = await signedUpPlayer();
        const r = await client.updateMe({ displayName: null } as unknown as { displayName: string });
        expectError(r, 'VALIDATION_ERROR', 'displayName');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('updateMe({avatarId: null}) -> VALIDATION_ERROR on avatarId, profile unchanged', async () => {
        const { client, profile } = await signedUpPlayer();
        const r = await client.updateMe({ avatarId: null } as unknown as { avatarId: AvatarId });
        expectError(r, 'VALIDATION_ERROR', 'avatarId');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('updateMe with an explicitly undefined field leaves that field unchanged', async () => {
        const { client, profile } = await signedUpPlayer();
        const updated = expectOk(await client.updateMe({ displayName: undefined, avatarId: 'avatar-05' }));
        expectProfile(updated, { displayName: profile.displayName, avatarId: 'avatar-05' });
      });

      it("updateMe({avatarId:'avatar-21'}) -> VALIDATION_ERROR on avatarId", async () => {
        const { client, profile } = await signedUpPlayer();
        expectError(await client.updateMe({ avatarId: 'avatar-21' as AvatarId }), 'VALIDATION_ERROR', 'avatarId');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it("updateMe({displayName:'   '}) -> VALIDATION_ERROR on displayName", async () => {
        const { client, profile } = await signedUpPlayer();
        expectError(await client.updateMe({ displayName: '   ' }), 'VALIDATION_ERROR', 'displayName');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('invalid name and invalid avatar together -> name is reported first', async () => {
        const { client, profile } = await signedUpPlayer();
        const r = await client.updateMe({ displayName: '   ', avatarId: 'avatar-21' as AvatarId });
        expectError(r, 'VALIDATION_ERROR', 'displayName');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('valid name with invalid avatar -> VALIDATION_ERROR on avatarId, nothing changed', async () => {
        const { client, profile } = await signedUpPlayer();
        const r = await client.updateMe({ displayName: uniqueName(), avatarId: 'avatar-21' as AvatarId });
        expectError(r, 'VALIDATION_ERROR', 'avatarId');
        expect(expectOk(await client.getMe())).toEqual(profile);
      });

      it('updateMe avatar only leaves the name unchanged', async () => {
        const { client, profile } = await signedUpPlayer();
        const updated = expectOk(await client.updateMe({ avatarId: 'avatar-20' }));
        expectProfile(updated, { displayName: profile.displayName, avatarId: 'avatar-20' });
        expect(updated.id).toBe(profile.id);
        expect(expectOk(await client.getMe())).toEqual(updated);
      });

      it('updateMe own name with different case succeeds', async () => {
        const token = uniqueName();
        const { client, profile } = await signedUpPlayer(token);
        const updated = expectOk(await client.updateMe({ displayName: token.toUpperCase() }));
        expectProfile(updated, { displayName: token.toUpperCase(), avatarId: profile.avatarId });
        expect(updated.id).toBe(profile.id);
        expect(expectOk(await client.getMe())).toEqual(updated);
      });

      it('updateMe name owned by another player -> DISPLAY_NAME_TAKEN, profile unchanged', async () => {
        const token = uniqueName();
        await signedUpPlayer(token);
        const b = await signedUpPlayer();
        const r = await b.client.updateMe({ displayName: token.toUpperCase(), avatarId: 'avatar-07' });
        expectError(r, 'DISPLAY_NAME_TAKEN', 'displayName');
        expect(expectOk(await b.client.getMe())).toEqual(b.profile);
      });
    });

    describe('checkDisplayName', () => {
      it('available / taken / invalid', async () => {
        const token = uniqueName();
        const { client } = await signedUpPlayer(token);
        const other = await factory.newClient(); // signed out: still allowed

        expect(expectOk(await other.checkDisplayName(uniqueName()))).toEqual({ available: true });
        expect(expectOk(await other.checkDisplayName(token))).toEqual({ available: false });
        expect(expectOk(await other.checkDisplayName(`  ${token.toUpperCase()}  `))).toEqual({ available: false });
        // The owner may keep or re-case their own name, so it is available to them.
        expect(expectOk(await client.checkDisplayName(token.toUpperCase()))).toEqual({ available: true });
        expectError(await other.checkDisplayName('   '), 'VALIDATION_ERROR', 'displayName');
        expectError(await other.checkDisplayName(SMILE.repeat(25)), 'VALIDATION_ERROR', 'displayName');
      });
    });

    describe('display-name rule through updateMe (Review focus 3)', () => {
      type Case =
        | { label: string; build: (token: string) => string; stored: (token: string) => string }
        | { label: string; build: (token: string) => string; invalid: true };

      const cases: Case[] = [
        { label: 'Zoe with precomposed diaeresis (U+00EB)', build: (t) => `${t}Zo\u00EB`, stored: (t) => `${t}Zo\u00EB` },
        { label: 'whitespace collapses', build: (t) => `  ${t}   b  `, stored: (t) => `${t} b` },
        {
          label: 'exactly 24 code points (emoji)',
          build: (t) => t + SMILE.repeat(24 - cp(t)),
          stored: (t) => t + SMILE.repeat(24 - cp(t)),
        },
        { label: '25 code points (emoji)', build: (t) => t + SMILE.repeat(25 - cp(t)), invalid: true },
        { label: 'decomposed e + combining acute (U+0301)', build: (t) => `${t}e\u0301`, stored: (t) => `${t}e\u0301` },
        { label: 'zero-width space', build: () => 'a\u200Bb', invalid: true },
        { label: 'whitespace only', build: () => '   ', invalid: true },
        { label: '25 emoji', build: () => SMILE.repeat(25), invalid: true },
      ];

      for (const c of cases) {
        it(c.label, async () => {
          const { client, profile } = await signedUpPlayer();
          const token = uniqueName();
          const input = c.build(token);
          const r = await client.updateMe({ displayName: input });
          if ('invalid' in c) {
            expectError(r, 'VALIDATION_ERROR', 'displayName');
            expect(expectOk(await client.getMe())).toEqual(profile);
          } else {
            const updated = expectOk(r);
            const stored = c.stored(token);
            expect(cp(stored)).toBeLessThanOrEqual(24);
            expectProfile(updated, { displayName: stored, avatarId: profile.avatarId });
            expect(expectOk(await client.getMe())).toEqual(updated);
          }
        });
      }
    });
  });
}
