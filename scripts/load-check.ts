// Load check (runtime design §10; design: doc/specs/2026-11-21-load-check-design.md).
// Connects real clients to the runtime, walks them around the lobby, and prints what it measured.
//
//   Local:      npm run db:start && npx tsx scripts/load-check.ts [--duration 60] [--rate 10] [--scenario full]
//   Hosted dev: npx tsx --env-file=.env.development.local scripts/load-check.ts --hosted   (Adam only; see
//               doc/checklists/cloudflare-hosted-setup.md, "Load check")
import type { LocalRuntime } from '../shared/test/runtime-env';
import { USAGE, parseArgs, type HostedSettings, type LoadOptions } from './load-check/args';
import { formatReport } from './load-check/report';
import { SCENARIOS, createLoadClient, runScenario, type LoadClient, type Probe } from './load-check/run';

const probe: Probe = { meter: null };
const clients: LoadClient[] = [];
let runtime: LocalRuntime | null = null;
let cleaned = false;

async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  // signOut also leaves the world, so an interrupted scenario frees its slots at once.
  await Promise.all(clients.map((c) => c.client.signOut()));
  await runtime?.stop();
}

async function localClients(n: number): Promise<void> {
  const { startLocalRuntime, TEST_ORIGIN } = await import('../shared/test/runtime-env');
  const { createTestAccounts } = await import('./create-test-accounts');
  runtime = await startLocalRuntime();
  console.log(`Supabase: ${new URL(runtime.supabase.url).host}   runtime: ${new URL(runtime.runtimeUrl).host}   (local)`);
  const accounts = await createTestAccounts(n, runtime.supabase, { prefix: 'load' });
  // Into the shared list as they are created, so cleanup signs out even a partial set.
  const out = clients;
  for (const [i, acc] of accounts.entries()) {
    const lc = createLoadClient({
      tag: `load${String(i + 1).padStart(2, '0')}`,
      supabaseUrl: runtime.supabase.url,
      publishableKey: runtime.supabase.publishableKey,
      runtimeUrl: runtime.runtimeUrl,
      origin: TEST_ORIGIN,
      probe,
    });
    out.push(lc);
    const r = await lc.client.signIn({ email: acc.email, password: acc.password });
    if (r.error) throw new Error(`${lc.tag} could not sign in (${r.error.code}).`);
  }
}

/** Signs in as <user>+loadNN@<domain>, signing up on the first run. */
async function hostedClients(n: number, h: HostedSettings): Promise<void> {
  console.log(`Supabase: ${new URL(h.supabaseUrl).host}   runtime: ${new URL(h.runtimeUrl).host}   (hosted)`);
  const at = h.email.lastIndexOf('@');
  const [user, domain] = [h.email.slice(0, at), h.email.slice(at + 1)];
  // Into the shared list as they are created, so cleanup signs out even a partial set.
  const out = clients;
  for (let i = 1; i <= n; i++) {
    const nn = String(i).padStart(2, '0');
    const lc = createLoadClient({
      tag: `load${nn}`,
      supabaseUrl: h.supabaseUrl,
      publishableKey: h.publishableKey,
      runtimeUrl: h.runtimeUrl,
      origin: h.origin,
      probe,
    });
    out.push(lc);
    const email = `${user}+load${nn}@${domain}`;
    let r = await lc.client.signIn({ email, password: h.password });
    if (r.error?.code === 'INVALID_CREDENTIALS') {
      r = await lc.client.signUp({ email, password: h.password, displayName: `Load${nn}` });
      if (!r.error) console.log(`Created test user ${email}`);
    }
    if (r.error) throw new Error(`${lc.tag} could not sign in or sign up (${r.error.code}).`);
  }
}

async function run(o: LoadOptions): Promise<number> {
  const n = Math.max(...o.scenarios.map((s) => SCENARIOS[s].players));
  if (o.hosted) await hostedClients(n, o.hosted);
  else await localClients(n);
  for (const name of o.scenarios) {
    const { players, movers } = SCENARIOS[name];
    console.log(`\nRunning ${name} (${players} players, ${movers} moving) for ${o.durationMs / 1000} s at ${o.rateHz} Hz...`);
    const report = await runScenario(clients.slice(0, players), { name, movers, rateHz: o.rateHz, durationMs: o.durationMs }, probe);
    console.log(formatReport(report));
  }
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  process.once('SIGINT', () => {
    console.error('\nInterrupted; signing the load-check users out...');
    void cleanup().finally(() => process.exit(130));
  });
  try {
    process.exitCode = await run(parsed.options);
  } catch (e) {
    console.error(`Load check failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

void main();
