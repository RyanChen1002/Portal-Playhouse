// The load-check runner against the local runtime and local Supabase (`npm run db:start`).
// Short runs with three players check that the script measures what it should.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, startLocalRuntime, type LocalRuntime } from '../../shared/test/runtime-env';
import { createTestAccounts } from '../create-test-accounts';
import { createLoadClient, runScenario, type LoadClient, type Probe } from './run';

const TEST_TIMEOUT_MS = 60_000;
let runtime: LocalRuntime;
const probe: Probe = { meter: null };
const signedIn: LoadClient[] = [];

function newClient(tag: string): LoadClient {
  return createLoadClient({
    tag,
    supabaseUrl: runtime.supabase.url,
    publishableKey: runtime.supabase.publishableKey,
    runtimeUrl: runtime.runtimeUrl,
    origin: TEST_ORIGIN,
    probe,
  });
}

beforeAll(async () => {
  runtime = await startLocalRuntime();
  const accounts = await createTestAccounts(3, runtime.supabase, { prefix: 'lc' });
  for (const [i, acc] of accounts.entries()) {
    const lc = newClient(`p${i + 1}`);
    const r = await lc.client.signIn({ email: acc.email, password: acc.password });
    if (r.error) throw new Error(`sign-in failed: ${r.error.code}`);
    signedIn.push(lc);
  }
}, 120_000);

afterAll(async () => {
  await Promise.all(signedIn.map((lc) => lc.client.signOut()));
  await runtime?.stop();
});

describe('runScenario', () => {
  it(
    '3 players, all moving, 2 s at 10 Hz',
    async () => {
      const r = await runScenario(signedIn, { name: 'three', movers: 3, rateHz: 10, durationMs: 2_000 }, probe);
      expect(r.players).toBe(3);
      expect(r.incomingPerSec).toBeGreaterThanOrEqual(20);
      expect(r.incomingPerSec).toBeLessThanOrEqual(40);
      expect(r.outgoingPerSec).toBeGreaterThanOrEqual(40);
      expect(r.outgoingPerSec).toBeLessThanOrEqual(80);
      expect(r.delayMs.count).toBeGreaterThan(0);
      expect(r.deliveryRatio).toBeGreaterThan(0.9);
      expect([r.corrections, r.requestErrors, r.reconnects]).toEqual([0, 0, 0]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '3 players, 1 moving',
    async () => {
      const r = await runScenario(signedIn, { name: 'one-mover', movers: 1, rateHz: 10, durationMs: 2_000 }, probe);
      expect(r.movers).toBe(1);
      expect(r.incomingPerSec).toBeGreaterThanOrEqual(5);
      expect(r.incomingPerSec).toBeLessThanOrEqual(15);
      expect(r.outgoingPerSec).toBeGreaterThanOrEqual(10);
      expect(r.outgoingPerSec).toBeLessThanOrEqual(30);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'warns when other players are in the lobby',
    async () => {
      const bystander = await signedIn[2]!.client.connectWorld();
      expect(bystander.error).toBeNull();
      try {
        const r = await runScenario(signedIn.slice(0, 2), { name: 'crowded', movers: 2, rateHz: 10, durationMs: 1_000 }, probe);
        expect(r.players).toBe(2);
        expect(r.extraPlayers).toBe(1);
        expect(r.warnings.join('\n')).toContain('1 other players');
      } finally {
        await bystander.data?.leaveWorld();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reports a connection that closes during the run, and why',
    async () => {
      // Signing out leaves the world: a final close with reason 'left'. Runs last for p3.
      setTimeout(() => void signedIn[2]!.client.signOut(), 500);
      const r = await runScenario(signedIn, { name: 'closing', movers: 3, rateHz: 10, durationMs: 1_500 }, probe);
      expect(r.closes).toEqual(['left']);
      expect(r.warnings.join('\n')).toContain('1 connection(s) closed during the run (left)');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a client that cannot connect stops the scenario',
    async () => {
      const notSignedIn = newClient('nosign');
      await expect(
        runScenario([signedIn[0]!, notSignedIn], { name: 'broken', movers: 2, rateHz: 10, durationMs: 1_000 }, probe),
      ).rejects.toThrow(/nosign.*UNAUTHORIZED/);
    },
    TEST_TIMEOUT_MS,
  );
});
