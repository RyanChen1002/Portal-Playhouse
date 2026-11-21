import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devTargets, parseArgs, type DevTargets } from './args';

const dev: DevTargets = { supabaseHost: 'abcdefgh.supabase.co', runtimeName: 'portal-runtime-dev' };

const hostedEnv = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  RUNTIME_URL: 'wss://portal-runtime-dev.example.workers.dev/connect',
  RUNTIME_ORIGIN: 'http://127.0.0.1:4173',
  LOAD_EMAIL: 'someone@example.com',
  LOAD_PASSWORD: 'a-long-test-password',
};

function message(argv: string[], env: Record<string, string | undefined> = {}): string {
  const r = parseArgs(argv, env, dev);
  if (r.ok) throw new Error('expected a usage error');
  return r.message;
}

describe('parseArgs', () => {
  it('defaults to all three scenarios, 60 s, 10 Hz, local', () => {
    expect(parseArgs([], {})).toEqual({
      ok: true,
      options: { scenarios: ['baseline', 'full', 'quarter'], durationMs: 60_000, rateHz: 10, hosted: null },
    });
  });

  it('takes repeated --scenario flags in order', () => {
    const r = parseArgs(['--scenario', 'full', '--scenario', 'baseline'], {});
    expect(r.ok && r.options.scenarios).toEqual(['full', 'baseline']);
  });

  it('takes --duration and --rate', () => {
    const r = parseArgs(['--duration', '5', '--rate', '20'], {});
    expect(r.ok && [r.options.durationMs, r.options.rateHz]).toEqual([5_000, 20]);
  });

  it('rejects an unknown scenario and names the allowed ones', () => {
    expect(message(['--scenario', 'nope'])).toMatch(/baseline.*full.*quarter/);
  });

  it.each([['--rate', '0'], ['--rate', '21'], ['--rate', '2.5'], ['--duration', '0'], ['--duration', 'x'], ['--rate']])(
    'rejects %s %s',
    (...argv) => {
      expect(parseArgs(argv.filter((a) => a !== undefined), {}).ok).toBe(false);
    },
  );

  it('rejects an unknown flag', () => {
    expect(parseArgs(['--fast'], {}).ok).toBe(false);
  });

  it('reads the hosted settings from the environment', () => {
    const r = parseArgs(['--hosted'], hostedEnv, dev);
    expect(r.ok && r.options.hosted).toEqual({
      supabaseUrl: hostedEnv.SUPABASE_URL,
      publishableKey: hostedEnv.SUPABASE_PUBLISHABLE_KEY,
      runtimeUrl: hostedEnv.RUNTIME_URL,
      origin: hostedEnv.RUNTIME_ORIGIN,
      email: hostedEnv.LOAD_EMAIL,
      password: hostedEnv.LOAD_PASSWORD,
    });
  });

  it('names missing hosted variables without printing any values', () => {
    const msg = message(['--hosted'], { ...hostedEnv, LOAD_PASSWORD: undefined, RUNTIME_URL: '' });
    expect(msg).toContain('LOAD_PASSWORD');
    expect(msg).toContain('RUNTIME_URL');
    expect(msg).not.toContain(hostedEnv.SUPABASE_PUBLISHABLE_KEY);
  });

  it.each([
    ['SUPABASE_URL', 'https://zyxwvuts.supabase.co'],
    ['RUNTIME_URL', 'wss://portal-runtime-production.example.workers.dev/connect'],
    ['RUNTIME_URL', 'wss://play.example.com/connect'],
  ] as const)('refuses a %s that is not hosted dev (%s)', (name, url) => {
    expect(message(['--hosted'], { ...hostedEnv, [name]: url })).toContain(`${name} is not hosted dev`);
  });

  it('refuses --hosted when the dev hosts are unknown', () => {
    expect(parseArgs(['--hosted'], hostedEnv, null).ok).toBe(false);
  });

  it('rejects a LOAD_EMAIL without @', () => {
    expect(parseArgs(['--hosted'], { ...hostedEnv, LOAD_EMAIL: 'nobody' }, dev).ok).toBe(false);
  });
});

describe('devTargets', () => {
  it("reads the dev Supabase host and Worker name from the repository's wrangler.jsonc", () => {
    const text = readFileSync(new URL('../../runtime/wrangler.jsonc', import.meta.url), 'utf8');
    const t = devTargets(text);
    expect(t.runtimeName).toBe('portal-runtime-dev');
    expect(t.supabaseHost).toMatch(/^[a-z0-9]+\.supabase\.co$/);
  });

  it('refuses a placeholder or missing dev environment', () => {
    expect(() => devTargets('{ "env": { "dev": { "name": "portal-runtime-dev", "vars": { "SUPABASE_URL": "https://REPLACE-dev.supabase.co" } } } }')).toThrow();
    expect(() => devTargets('{ "env": {} }')).toThrow();
  });
});
