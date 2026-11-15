// Unit tests for the real client that need no running stack: unreachable server and
// in-memory storage. Behavior against the live local stack is in shared/test/*.integration.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, createPortalClient } from './index';

// Port 1 on loopback refuses connections immediately.
const UNREACHABLE = 'http://127.0.0.1:1';
const KEY = 'sb_publishable_unit_test_placeholder';

describe('createPortalClient without a reachable server', () => {
  it('never throws; network failures map to SERVICE_UNAVAILABLE', async () => {
    const client = createPortalClient({ url: UNREACHABLE, publishableKey: KEY });

    const check = await client.checkDisplayName('someone');
    expect(check.data).toBeNull();
    expect(check.error?.code).toBe('SERVICE_UNAVAILABLE');

    const signIn = await client.signIn({ email: 'nobody@example.test', password: 'correct-horse-1' });
    expect(signIn.data).toBeNull();
    expect(signIn.error?.code).toBe('SERVICE_UNAVAILABLE');

    const signUp = await client.signUp({
      email: 'nobody@example.test',
      password: 'correct-horse-1',
      displayName: 'nobody',
    });
    expect(signUp.error?.code).toBe('SERVICE_UNAVAILABLE');

    // No session: signed out, and profile calls are UNAUTHORIZED like the mock.
    expect(await client.getSession()).toEqual({ data: { signedIn: false, playerId: null }, error: null });
    expect((await client.getMe()).error?.code).toBe('UNAUTHORIZED');
    expect((await client.signOut()).error).toBeNull();
  });

  it('client-side validation runs before any network call', async () => {
    const client = createPortalClient({ url: UNREACHABLE, publishableKey: KEY });
    const r = await client.signUp({ email: 'not-an-email', password: 'correct-horse-1', displayName: 'x' });
    expect(r.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'email' });
    const n = await client.checkDisplayName('   ');
    expect(n.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'displayName' });
  });
});

// Stubs fetch so the pre-check reports the name as available and /signup answers with `signupBody`.
function stubSignupResponse(signupBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/rest/v1/rpc/check_display_name')) return json({ available: true });
      if (url.includes('/auth/v1/signup')) return json(signupBody);
      return new Response('unexpected request', { status: 500 });
    }),
  );
}

describe('signUp responses without a session', () => {
  const SERVER = 'http://127.0.0.1:54399';
  const input = { email: 'someone@example.test', password: 'correct-horse-1', displayName: 'someone' };
  const user = (identities: unknown[]) => ({
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: input.email,
    identities,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-11-14T00:00:00Z',
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('obfuscated existing-email response (identities: []) -> EMAIL_TAKEN on email', async () => {
    stubSignupResponse(user([]));
    const client = createPortalClient({ url: SERVER, publishableKey: KEY });
    const r = await client.signUp(input);
    expect(r.data).toBeNull();
    expect(r.error).toMatchObject({ code: 'EMAIL_TAKEN', field: 'email' });
  });

  it('any other missing session -> SERVICE_UNAVAILABLE with no field', async () => {
    stubSignupResponse(user([{ id: 'identity-1', provider: 'email' }]));
    const client = createPortalClient({ url: SERVER, publishableKey: KEY });
    const r = await client.signUp(input);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.error).not.toHaveProperty('field');
    expect(r.error?.message).toMatch(/did not return a session/i);
  });
});

describe('createMemoryStorage', () => {
  it('stores, reads and removes strings; instances are independent', () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    a.setItem('k', 'v');
    expect(a.getItem('k')).toBe('v');
    expect(b.getItem('k')).toBeNull();
    a.removeItem('k');
    expect(a.getItem('k')).toBeNull();
  });
});
