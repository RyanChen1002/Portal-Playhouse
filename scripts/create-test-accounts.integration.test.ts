import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createTestAccounts } from './create-test-accounts';
import { assertLocalUrl, getLocalSupabaseEnv } from './local-env';

describe('createTestAccounts (local stack)', () => {
  it('creates accounts that can sign in and have matching profiles', async () => {
    const env = await getLocalSupabaseEnv();
    const accounts = await createTestAccounts(3, env);
    expect(accounts).toHaveLength(3);
    expect(new Set(accounts.map((a) => a.displayName)).size).toBe(3);

    for (const a of accounts) {
      const client = createClient(env.url, env.publishableKey, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: a.email, password: a.password });
      expect(error).toBeNull();
      const { data, error: rpcError } = await client.rpc('get_me');
      expect(rpcError).toBeNull();
      expect(data).toMatchObject({ id: a.id, displayName: a.displayName, avatarId: 'avatar-01' });
    }
  });

  it('refuses a non-local URL', async () => {
    await expect(createTestAccounts(1, { url: 'https://abc.supabase.co', secretKey: 'x' })).rejects.toThrow();
    expect(() => assertLocalUrl('https://abc.supabase.co')).toThrow();
  });

  it('rejects a prefix that makes names too long', async () => {
    const env = await getLocalSupabaseEnv();
    await expect(createTestAccounts(1, env, { prefix: 'x'.repeat(30) })).rejects.toThrow();
  });
});
