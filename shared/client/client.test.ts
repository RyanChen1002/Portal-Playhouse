// Unit tests for the real client that need no running stack: unreachable server and
// in-memory storage. Behavior against the live local stack is in shared/test/*.integration.test.ts.
import { describe, expect, it } from 'vitest';
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
