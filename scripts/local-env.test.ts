import { describe, expect, it } from 'vitest';
import { assertLocalUrl, getLocalSupabaseEnv } from './local-env';

const NOT_RUNNING = 'Local Supabase is not running. Run: npx supabase start';

describe('assertLocalUrl', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'https://localhost',
    'http://127.0.0.1',
  ])('accepts %s', (u) => {
    expect(() => assertLocalUrl(u)).not.toThrow();
  });

  it.each([
    'https://abc.supabase.co',
    'http://localhost.evil.com',
    'http://127.0.0.1.nip.io',
    'not a url',
    '',
    'ftp://127.0.0.1',
  ])('rejects %s', (u) => {
    expect(() => assertLocalUrl(u)).toThrow();
  });
});

describe('getLocalSupabaseEnv', () => {
  it('maps publishable/secret keys', async () => {
    const env = await getLocalSupabaseEnv(async () => ({
      stdout: JSON.stringify({
        API_URL: 'http://127.0.0.1:54321',
        PUBLISHABLE_KEY: 'pub',
        SECRET_KEY: 'sec',
        ANON_KEY: 'anon',
        SERVICE_ROLE_KEY: 'svc',
      }),
      exitCode: 0,
    }));
    expect(env).toEqual({ url: 'http://127.0.0.1:54321', publishableKey: 'pub', secretKey: 'sec' });
  });

  it('falls back to anon/service_role keys', async () => {
    const env = await getLocalSupabaseEnv(async () => ({
      stdout: JSON.stringify({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'svc' }),
      exitCode: 0,
    }));
    expect(env).toEqual({ url: 'http://127.0.0.1:54321', publishableKey: 'anon', secretKey: 'svc' });
  });

  it.each([
    ['runner throws', async () => { throw new Error('boom'); }],
    ['non-zero exit', async () => ({ stdout: '', exitCode: 1 })],
    ['empty output', async () => ({ stdout: '', exitCode: 0 })],
    ['non-JSON output', async () => ({ stdout: 'stopped', exitCode: 0 })],
    ['missing keys', async () => ({ stdout: JSON.stringify({ API_URL: 'http://127.0.0.1:54321' }), exitCode: 0 })],
  ])('throws the not-running message when %s', async (_n, run) => {
    await expect(getLocalSupabaseEnv(run)).rejects.toThrow(NOT_RUNNING);
  });

  it('refuses a non-local API_URL', async () => {
    await expect(
      getLocalSupabaseEnv(async () => ({
        stdout: JSON.stringify({ API_URL: 'https://abc.supabase.co', ANON_KEY: 'a', SERVICE_ROLE_KEY: 's' }),
        exitCode: 0,
      })),
    ).rejects.toThrow();
  });
});
