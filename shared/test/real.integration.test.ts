// Real-client checks beyond the shared contract suite. Requires `npx supabase start`.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestAccounts } from '../../scripts/create-test-accounts';
import { createMemoryStorage, createPortalClient } from '../client/index';
import type { PortalClient, Profile, Result } from '../contracts/index';
import { TEST_PASSWORD } from './contract-suite';
import { localEnv, realFactory } from './real-factory';

const factory = realFactory('ri');
const TIMEOUT_MS = 20_000;

function ok<T>(r: Result<T>): T {
  expect(r.error, `unexpected error: ${JSON.stringify(r.error)}`).toBeNull();
  return r.data as T;
}

async function signedUp(): Promise<{ client: PortalClient; profile: Profile }> {
  const client = await factory.newClient();
  const profile = ok(
    await client.signUp({ email: factory.uniqueEmail(), password: TEST_PASSWORD, displayName: factory.uniqueName() }),
  );
  return { client, profile };
}

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('real client against the local stack', { timeout: TIMEOUT_MS }, () => {
  it('concurrent updateMe to the same new name: exactly one wins, the other gets DISPLAY_NAME_TAKEN', async () => {
    const a = await signedUp();
    const b = await signedUp();
    const name = factory.uniqueName();

    const results = await Promise.all([
      a.client.updateMe({ displayName: name }),
      b.client.updateMe({ displayName: name }),
    ]);

    const winners = results.filter((r) => r.error === null);
    const losers = results.filter((r) => r.error !== null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.data?.displayName).toBe(name);
    expect(losers[0]?.error).toMatchObject({ code: 'DISPLAY_NAME_TAKEN', field: 'displayName' });

    // The loser's profile is unchanged.
    const loser = results[0]?.error === null ? b : a;
    expect(ok(await loser.client.getMe())).toEqual(loser.profile);
  });

  it('AC-01: two accounts each see only their own profile', async () => {
    const env = await localEnv();
    const accounts = await createTestAccounts(2, env, { prefix: 'ac' });
    const seen: Profile[] = [];
    for (const account of accounts) {
      const client = await factory.newClient();
      const signedIn = ok(await client.signIn({ email: account.email, password: account.password }));
      const me = ok(await client.getMe());
      expect(me).toEqual(signedIn);
      expect(me).toEqual({ id: account.id, displayName: account.displayName, avatarId: 'avatar-01', winsTotal: 0 });
      seen.push(me);
    }
    expect(seen[0]?.id).not.toBe(seen[1]?.id);
  });

  it('Review focus 4: a session holding a garbage access token gets UNAUTHORIZED, not an exception', async () => {
    // A syntactically valid JWT with a bad signature, not yet expired. It is seeded into the
    // client's storage before creation, so supabase-js loads it as the current session without
    // refreshing (auth.setSession is not usable: it verifies the token and fails with
    // AuthApiError 403 'bad_jwt'). PostgREST then rejects it: HTTP 401, code PGRST301
    // ("No suitable key or wrong key type").
    //
    // Observed for an *expired* garbage session instead: supabase-js tries to refresh, the
    // refresh fails (AuthApiError 400 'validation_failed'), it drops the session and logs that
    // error to the console, and the call runs as anon -> HTTP 401, code 42501 -> UNAUTHORIZED.
    // That path is not exercised here because supabase-js's console.error would pollute output.
    const { url, publishableKey } = await localEnv();
    const now = Math.floor(Date.now() / 1000);
    const userId = randomUUID();
    const accessToken = [
      b64url({ alg: 'HS256', typ: 'JWT' }),
      b64url({ sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }),
      'c2lnbmF0dXJlLWlzLWdhcmJhZ2U',
    ].join('.');
    const storage = createMemoryStorage();
    const storageKey = `garbage-${randomUUID()}`;
    storage.setItem(
      storageKey,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: 'garbage-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now + 3600,
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }),
    );
    const client = createPortalClient({ url, publishableKey, storage, storageKey });

    const me = await client.getMe();
    expect(me.data).toBeNull();
    expect(me.error?.code).toBe('UNAUTHORIZED');
    const update = await client.updateMe({ avatarId: 'avatar-02' });
    expect(update.error?.code).toBe('UNAUTHORIZED');
  });

  it('the client never touches tables: no .from( and only the four player RPCs in shared/client', () => {
    const dir = fileURLToPath(new URL('../client/', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${file} must not call .from(`).not.toMatch(/\.from\s*\(/);
      for (const match of source.matchAll(/\.rpc\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
        // get_my_results was added with the runtime; the runtime-only functions must never appear here.
        expect(['get_me', 'update_me', 'check_display_name', 'get_my_results'], `${file} calls rpc ${match[1]}`).toContain(
          match[1],
        );
      }
    }
  });
});
