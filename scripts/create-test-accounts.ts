import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertLocalUrl, getLocalSupabaseEnv } from './local-env';

export interface TestAccount {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

export async function createTestAccounts(
  n: number,
  env: { url: string; secretKey: string },
  opts: { prefix?: string } = {},
): Promise<TestAccount[]> {
  assertLocalUrl(env.url);
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be a positive integer');

  const prefix = opts.prefix ?? 't';
  if (!/^[a-z0-9]+$/.test(prefix)) throw new Error('prefix must be lowercase letters and digits');
  const runId = randomBytes(3).toString('hex');
  const longest = `${prefix}-${runId}-${n}`;
  if ([...longest].length > 24) throw new Error('prefix is too long: display names must be 24 characters or fewer');

  const admin = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const accounts: TestAccount[] = [];
  for (let i = 1; i <= n; i++) {
    const displayName = `${prefix}-${runId}-${i}`;
    const email = `${displayName}@example.test`;
    const password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw new Error(error.message);
    accounts.push({ id: data.user.id, email, password, displayName });
  }
  return accounts;
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1 || n > 50) {
    console.error('Usage: npx tsx scripts/create-test-accounts.ts <n>  (n is an integer from 1 to 50)');
    process.exitCode = 1;
    return;
  }
  try {
    const env = await getLocalSupabaseEnv();
    const accounts = await createTestAccounts(n, env);
    console.log(JSON.stringify(accounts, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
