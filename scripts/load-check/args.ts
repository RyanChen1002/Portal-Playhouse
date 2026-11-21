// Command-line options for the load check. Never echoes environment values.
import { SCENARIOS, type ScenarioName } from './run';

export interface HostedSettings {
  supabaseUrl: string;
  publishableKey: string;
  runtimeUrl: string;
  origin: string;
  email: string;
  password: string;
}

export interface LoadOptions {
  scenarios: ScenarioName[];
  durationMs: number;
  rateHz: number;
  hosted: HostedSettings | null;
}

export const USAGE = `Usage: npx tsx scripts/load-check.ts [--scenario baseline|full|quarter]... [--duration <seconds>] [--rate <hz>] [--hosted]
  Local (default): starts the local runtime against the local Supabase stack (npm run db:start).
  --hosted: hosted dev; needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, RUNTIME_URL, RUNTIME_ORIGIN, LOAD_EMAIL, LOAD_PASSWORD.`;

const NAMES = Object.keys(SCENARIOS) as ScenarioName[];
const HOSTED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'RUNTIME_URL',
  'RUNTIME_ORIGIN',
  'LOAD_EMAIL',
  'LOAD_PASSWORD',
] as const;

const isPositiveInt = (s: string | undefined): boolean => !!s && /^\d+$/.test(s) && Number(s) > 0;

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): { ok: true; options: LoadOptions } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  const scenarios: ScenarioName[] = [];
  let durationMs = 60_000;
  let rateHz = 10;
  let hosted = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--scenario':
        if (!NAMES.includes(value as ScenarioName)) return fail(`--scenario must be one of: ${NAMES.join(', ')}.`);
        scenarios.push(value as ScenarioName);
        i++;
        break;
      case '--duration':
        if (!isPositiveInt(value)) return fail('--duration must be a whole number of seconds, at least 1.');
        durationMs = Number(value) * 1000;
        i++;
        break;
      case '--rate':
        if (!isPositiveInt(value) || Number(value) > 20) return fail('--rate must be a whole number from 1 to 20.');
        rateHz = Number(value);
        i++;
        break;
      case '--hosted':
        hosted = true;
        break;
      default:
        return fail(`Unknown option: ${flag}`);
    }
  }

  const options: LoadOptions = { scenarios: scenarios.length ? scenarios : [...NAMES], durationMs, rateHz, hosted: null };
  if (!hosted) return { ok: true, options };

  const missing = HOSTED_VARS.filter((name) => !env[name]);
  if (missing.length) return fail(`--hosted needs these environment variables: ${missing.join(', ')}.`);
  const v = (name: (typeof HOSTED_VARS)[number]) => env[name]!;
  for (const name of ['SUPABASE_URL', 'RUNTIME_URL'] as const) {
    if (v(name).toLowerCase().includes('production')) {
      return fail(`Refusing to run: ${name} points at production. The load check is for local and hosted dev only.`);
    }
  }
  const email = v('LOAD_EMAIL');
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return fail('LOAD_EMAIL must be an email address you own.');

  options.hosted = {
    supabaseUrl: v('SUPABASE_URL'),
    publishableKey: v('SUPABASE_PUBLISHABLE_KEY'),
    runtimeUrl: v('RUNTIME_URL'),
    origin: v('RUNTIME_ORIGIN'),
    email,
    password: v('LOAD_PASSWORD'),
  };
  return { ok: true, options };
}
