// Real client against the local runtime and local Supabase, beyond the shared contract suite
// (spec §10 integration and concurrency rows). Requires the local stack (`npm run db:start`).
// Tests run in order and share one runtime; each leaves the world, because the `portal` room
// is shared. Tests that need different runtime vars reload the Worker with `restart()`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestAccounts } from '../../scripts/create-test-accounts';
import type { GameResult, PortalClient, Result, WorldConnection } from '../contracts/index';
import { PORTAL_ROOM } from '../world/config';
import { signedInRuntimeClient, startLocalRuntime, type LocalRuntime, type RuntimeClient } from './runtime-env';
import { playToWin, record, waitFor, walkTo } from './world-contract-suite';

const TEST_TIMEOUT_MS = 90_000;
let runtime: LocalRuntime;
const open: WorldConnection[] = [];

function ok<T>(r: Result<T>): T {
  expect(r.error, `unexpected error: ${JSON.stringify(r.error)}`).toBeNull();
  return r.data as T;
}

async function connect(rc: RuntimeClient): Promise<WorldConnection> {
  const conn = ok(await rc.client.connectWorld());
  open.push(conn);
  return conn;
}

async function twoPlayers(): Promise<[RuntimeClient, WorldConnection, RuntimeClient, WorldConnection]> {
  const ca = await signedInRuntimeClient(runtime);
  const cb = await signedInRuntimeClient(runtime);
  return [ca, await connect(ca), cb, await connect(cb)];
}

/** Both walk to the portal entrance, join, and ready; resolves with the round's session id. */
async function startRound(a: WorldConnection, b: WorldConnection): Promise<string> {
  await Promise.all([walkTo(a, PORTAL_ROOM.entrance), walkTo(b, PORTAL_ROOM.entrance)]);
  ok(await a.joinRoom(PORTAL_ROOM.id));
  ok(await b.joinRoom(PORTAL_ROOM.id));
  ok(await a.setReady(true));
  ok(await b.setReady(true));
  await waitFor(() => !!a.snapshot().room.session && !!b.snapshot().room.session, 'the round to start');
  return a.snapshot().room.session!.sessionId;
}

async function results(client: PortalClient): Promise<GameResult[]> {
  return ok(await client.getMyResults({ limit: 50 })).results;
}

async function winsTotal(client: PortalClient): Promise<number> {
  return ok(await client.getMe()).winsTotal;
}

async function leaveAll(): Promise<void> {
  await Promise.all(open.splice(0).map((c) => c.leaveWorld()));
}

beforeAll(async () => {
  runtime = await startLocalRuntime();
}, 120_000);

afterEach(leaveAll);

afterAll(async () => {
  await runtime?.stop();
});

describe('real runtime: rounds and results', () => {
  it(
    'a win and a loss each produce one row; winsTotal rises by exactly 1 for both players',
    async () => {
      const [ca, a, cb, b] = await twoPlayers();
      expect([await winsTotal(ca.client), await winsTotal(cb.client)]).toEqual([0, 0]);

      const win = await startRound(a, b);
      const seenA = record(a);
      await playToWin(a, b);
      await waitFor(() => seenA.some((e) => e.type === 'result.saved'), 'the win to be saved', 15_000);
      expect([await winsTotal(ca.client), await winsTotal(cb.client)]).toEqual([1, 1]);

      // The loss needs a short round: reload the runtime with ROUND_MS (honoured only for local Supabase).
      await leaveAll();
      await runtime.restart({ ROUND_MS: '3000' });
      try {
        const a2 = await connect(ca);
        const b2 = await connect(cb);
        const loss = await startRound(a2, b2);
        const seenB = record(b2);
        await waitFor(() => b2.snapshot().lastFinished?.sessionId === loss, 'the round to time out', 10_000);
        expect(b2.snapshot().lastFinished).toMatchObject({ outcome: 'loss', score: 0 });
        await waitFor(() => seenB.some((e) => e.type === 'result.saved'), 'the loss to be saved', 15_000);

        for (const rc of [ca, cb]) {
          const rows = await results(rc.client);
          expect(rows.map((r) => [r.sessionId, r.outcome]).sort()).toEqual(
            [
              [win, 'win'],
              [loss, 'loss'],
            ].sort(),
          );
          expect(await winsTotal(rc.client)).toBe(1);
        }
      } finally {
        await leaveAll();
        await runtime.restart();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a cancellation appears in history with reason left',
    async () => {
      const [ca, a, cb, b] = await twoPlayers();
      const sid = await startRound(a, b);
      const seenB = record(b);
      ok(await a.leaveRoom());
      await waitFor(() => seenB.some((e) => e.type === 'result.saved'), 'the cancellation to be saved', 15_000);
      for (const rc of [ca, cb]) {
        const rows = await results(rc.client);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sessionId: sid, outcome: 'cancelled', cancelReason: 'left', score: 0 });
        expect(await winsTotal(rc.client)).toBe(0);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'two players readying in the same tick start exactly one round',
    async () => {
      const [, a, , b] = await twoPlayers();
      await Promise.all([walkTo(a, PORTAL_ROOM.entrance), walkTo(b, PORTAL_ROOM.entrance)]);
      ok(await a.joinRoom(PORTAL_ROOM.id));
      ok(await b.joinRoom(PORTAL_ROOM.id));
      const seenA = record(a);
      const seenB = record(b);

      const [ra, rb] = await Promise.all([a.setReady(true), b.setReady(true)]);
      ok(ra);
      ok(rb);
      await waitFor(() => !!a.snapshot().room.session && !!b.snapshot().room.session, 'the round to start');
      // Let any second start, if there were one, arrive.
      await new Promise((r) => setTimeout(r, 1500));

      const sessions = (seen: typeof seenA) =>
        new Set(seen.filter((e) => e.type === 'game.state').map((e) => (e.payload as { sessionId: string }).sessionId));
      expect(sessions(seenA).size).toBe(1);
      expect(sessions(seenB)).toEqual(sessions(seenA));
      expect(a.snapshot().room.session!.sessionId).toBe(b.snapshot().room.session!.sessionId);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('real runtime: connections', () => {
  it(
    'a dropped socket reconnects within 20 s to the exact position, in the same round',
    async () => {
      const [ca, a, , b] = await twoPlayers();
      const sid = await startRound(a, b);
      await walkTo(a, { x: -3, y: 0, z: 4.6 });
      const before = a.snapshot().self;
      await waitFor(
        () => JSON.stringify(b.snapshot().room.players.find((p) => p.id === a.playerId)?.position) === JSON.stringify(before.position),
        'b to see a move',
      );
      const seenB = record(b);
      const states: string[] = [];
      a.onConnectionState((s) => states.push(s));

      // Drop a's socket without world.leave.
      ca.sockets.at(-1)!.close(4000, 'test drop');
      await waitFor(() => states.includes('reconnecting'), 'a to start reconnecting');
      await waitFor(() => a.state === 'connected', 'a to reconnect', 20_000);

      const after = a.snapshot();
      expect(after.self.roomId).toBe(PORTAL_ROOM.id);
      expect(after.self.position).toEqual(before.position);
      expect(after.self.rotation).toBe(before.rotation);
      expect(after.room.session?.sessionId).toBe(sid);
      await waitFor(
        () =>
          seenB.some(
            (e) => e.type === 'player.connection' && (e.payload as { connected: boolean }).connected === true,
          ),
        'b to see a reconnect',
      );
      expect(
        seenB.some((e) => e.type === 'player.connection' && (e.payload as { connected: boolean }).connected === false),
      ).toBe(true);
      expect(b.snapshot().room.session?.sessionId).toBe(sid);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '17 concurrent connects admit exactly 16; the 17th gets WORLD_FULL',
    async () => {
      const accounts = await createTestAccounts(17, runtime.supabase, { prefix: 'full' });
      const clients = await Promise.all(accounts.map((acc) => signedInRuntimeClient(runtime, acc)));
      const outcomes = await Promise.all(clients.map((rc) => rc.client.connectWorld()));
      const admitted = outcomes.filter((r) => r.data !== null).map((r) => r.data!);
      open.push(...admitted);
      const rejected = outcomes.filter((r) => r.error !== null);
      expect(admitted).toHaveLength(16);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.error!.code).toBe('WORLD_FULL');
      expect(new Set(admitted.map((c) => c.playerId)).size).toBe(16);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('real runtime: Supabase outage', () => {
  it(
    'a save that fails while Supabase rejects the runtime completes once when it recovers',
    async () => {
      // The first save attempt uses a key Supabase rejects; the 5 s retry uses the real key.
      await runtime.restart({ TEST_RESULT_SAVE_FAILURES: '1' });
      try {
        const [ca, a, cb, b] = await twoPlayers();
        const sid = await startRound(a, b);
        const seenB = record(b);
        ok(await a.leaveRoom());
        await waitFor(() => b.snapshot().lastFinished?.sessionId === sid, 'game.finished');
        expect(b.snapshot().lastFinished?.persistenceStatus).toBe('pending');
        // Still pending after the first (failed) attempt.
        await new Promise((r) => setTimeout(r, 2000));
        expect(seenB.some((e) => e.type === 'result.saved')).toBe(false);
        expect(await results(cb.client)).toEqual([]);

        await waitFor(() => seenB.some((e) => e.type === 'result.saved'), 'the retried save', 15_000);
        expect(seenB.filter((e) => e.type === 'result.saved')).toHaveLength(1);
        for (const rc of [ca, cb]) {
          const rows = await results(rc.client);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ sessionId: sid, outcome: 'cancelled', cancelReason: 'left' });
        }
      } finally {
        await leaveAll();
        await runtime.restart();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
