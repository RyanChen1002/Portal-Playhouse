import { abortAllDurableObjects, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../shared/contracts';
import { FAILED_AFTER_MS, RETRY_FOREVER_MS } from '../src/results';
import type { WorldObject } from '../src/world-object';
import {
  card,
  closeAll,
  SECRET_KEY,
  installFakeSupabase,
  joinAs,
  recordIdempotently,
  sleep,
  type FakeSupabase,
  type TestSocket,
} from './helpers';

type Stub = DurableObjectStub<WorldObject>;

interface PendingRow extends Record<string, SqlStorageValue> {
  session_id: string;
  attempts: number;
  first_failed_at: number | null;
  next_attempt_at: number;
  failed_reported: number;
}

let fake: FakeSupabase;
let sockets: TestSocket[];
let stubs: Stub[];

beforeEach(async () => {
  fake = await installFakeSupabase();
  sockets = [];
  stubs = [];
});

afterEach(async () => {
  closeAll(sockets);
  // Leave no alarm behind to fire after the fake Supabase is gone.
  for (const stub of stubs) {
    await runInDurableObject(stub, (_i: WorldObject, state) => state.storage.deleteAlarm());
  }
  fake.restore();
  vi.restoreAllMocks();
});

function freshWorld(name = `results-${crypto.randomUUID()}`): Stub {
  const stub = env.WORLD.getByName(name);
  stubs.push(stub);
  return stub;
}

function newPlayer(): string {
  const id = crypto.randomUUID();
  fake.profiles.set(id, card(id));
  return id;
}

/** A controllable clock for result scheduling, starting a minute ahead so no real alarm fires mid-test. */
async function fakeClock(stub: Stub) {
  const clock = { t: Date.now() + 60_000 };
  const applied = await runInDurableObject(stub, (i: WorldObject) => i.setTestOverrides({ resultsNow: () => clock.t }));
  expect(applied).toBe(true);
  return clock;
}

function rows(stub: Stub): Promise<PendingRow[]> {
  return runInDurableObject(stub, (_i: WorldObject, state) =>
    state.storage.sql.exec<PendingRow>('SELECT * FROM pending_results').toArray(),
  );
}

function alarmAt(stub: Stub): Promise<number | null> {
  return runInDurableObject(stub, (_i: WorldObject, state) => state.storage.getAlarm());
}

function finishedOf(m: ServerMessage) {
  if (m.type !== 'game.finished') throw new Error(`expected game.finished, got ${m.type}`);
  return m.payload;
}

/**
 * Two players walk to the Portal Partners entrance, ready up, and A leaves: a cancelled round
 * (`left`). B gets `game.finished`; both stay connected as participants.
 */
async function playCancelledRound(stub: Stub) {
  const a = newPlayer();
  const b = newPlayer();
  const sa = await joinAs(stub, a);
  const sb = await joinAs(stub, b);
  sockets.push(sa, sb);
  // From spawn (0,0,4): 5.2 units now, then 3.3 more once the budget refills (6 units/s).
  for (const s of [sa, sb]) s.send({ type: 'player.move', payload: { sequence: 1, position: { x: -5, y: 0, z: 2.5 }, rotation: 0 } });
  await sleep(700);
  for (const s of [sa, sb]) {
    s.send({ type: 'player.move', payload: { sequence: 2, position: { x: -8, y: 0, z: 1.2 }, rotation: 0 } });
    s.send({ type: 'room.join', requestId: 'join', payload: { roomId: 'portal' } });
    await s.next('request.accepted', (m) => m.type === 'request.accepted' && m.requestId === 'join');
  }
  for (const s of [sa, sb]) s.send({ type: 'game.ready', requestId: 'ready', payload: { ready: true } });
  await sb.next('game.state');
  sa.send({ type: 'room.leave', requestId: 'leave', payload: {} });
  const finished = finishedOf(await sb.next('game.finished'));
  expect(finished).toMatchObject({ outcome: 'cancelled', reason: 'left', persistenceStatus: 'pending' });
  return { a, b, sa, sb, sessionId: finished.sessionId };
}

describe('result saving', () => {
  it('writes the pending row before game.finished is sent', async () => {
    const stub = freshWorld();
    const seen: number[] = [];
    await runInDurableObject(stub, (instance: WorldObject, state) => {
      const target = instance as unknown as { sendTo(conn: unknown, m: ServerMessage): void };
      const original = target.sendTo.bind(instance);
      target.sendTo = (conn, m) => {
        if (m.type === 'game.finished') {
          seen.push(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM pending_results').one().n);
        }
        original(conn, m);
      };
    });
    const { sb, sessionId } = await playCancelledRound(stub);
    expect(seen).toEqual([1]);
    await sb.next('result.saved');
    expect(fake.results.has(sessionId)).toBe(true);
  });

  it('a first-try success deletes the row and sends result.saved to connected participants', async () => {
    const stub = freshWorld();
    const { sa, sb, sessionId } = await playCancelledRound(stub);
    for (const s of [sa, sb]) {
      const saved = await s.next('result.saved');
      expect(saved.type === 'result.saved' && saved.payload).toEqual({ sessionId, resultId: fake.results.get(sessionId) });
    }
    expect(fake.results.get(sessionId)).toBeTruthy();
    expect(await rows(stub)).toEqual([]);
    expect(await alarmAt(stub)).toBeNull();
    expect(fake.recordCalls()).toHaveLength(1);
    expect(fake.recordCalls()[0]).toMatchObject({ session_id: sessionId, outcome: 'cancelled', cancel_reason: 'left' });
  });

  it('a participant who reconnects after result.saved sees saved in the snapshot', async () => {
    const stub = freshWorld();
    const { b, sb, sessionId } = await playCancelledRound(stub);
    await sb.next('result.saved');
    sb.ws.close(1000, 'gone');
    await sb.closed;
    const again = await joinAs(stub, b);
    sockets.push(again);
    const snap = again.received.find((m) => m.type === 'world.snapshot');
    expect(snap?.type === 'world.snapshot' && snap.payload.lastFinished).toEqual({
      sessionId,
      outcome: 'cancelled',
      score: 0,
      persistenceStatus: 'saved',
      reason: 'left',
    });
  });

  it('retries after 5 s, then 30 s, and saves on the third attempt', async () => {
    const stub = freshWorld();
    const clock = await fakeClock(stub);
    const t0 = clock.t;
    fake.resultsDown = true;
    const { sa, sb, sessionId } = await playCancelledRound(stub);

    await vi.waitFor(async () => expect((await rows(stub))[0]?.attempts).toBe(1));
    expect(await alarmAt(stub)).toBe(t0 + 5_000);

    clock.t = t0 + 5_000;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await rows(stub))[0]).toMatchObject({ attempts: 2, first_failed_at: t0, next_attempt_at: t0 + 35_000 });
    expect(await alarmAt(stub)).toBe(t0 + 35_000);

    fake.resultsDown = false;
    clock.t = t0 + 35_000;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await rows(stub)).toEqual([]);
    expect(await alarmAt(stub)).toBeNull();
    expect(fake.recordCalls()).toHaveLength(3);
    for (const s of [sa, sb]) {
      const saved = await s.next('result.saved');
      expect(saved.type === 'result.saved' && saved.payload).toEqual({ sessionId, resultId: fake.results.get(sessionId) });
    }
  });

  it('reports persistenceStatus failed once after 1 h of failures; retries continue every 10 min', async () => {
    const stub = freshWorld();
    const clock = await fakeClock(stub);
    const t0 = clock.t;
    fake.resultsDown = true;
    const { sa, sb, sessionId } = await playCancelledRound(stub);
    await vi.waitFor(async () => expect((await rows(stub))[0]?.attempts).toBe(1));

    const failedFor = (s: TestSocket) =>
      s.received.filter((m) => m.type === 'game.finished' && m.payload.persistenceStatus === 'failed');

    // Follow the alarm until the first failure at least an hour after the first one.
    const gaps: number[] = [];
    while (clock.t - t0 < FAILED_AFTER_MS) {
      expect(failedFor(sb)).toHaveLength(0);
      const at = (await alarmAt(stub))!;
      gaps.push(at - clock.t);
      clock.t = at;
      expect(await runDurableObjectAlarm(stub)).toBe(true);
    }
    expect(gaps.slice(0, 4)).toEqual([5_000, 30_000, 120_000, RETRY_FOREVER_MS]);
    for (const s of [sa, sb]) {
      const failed = await s.next('game.finished', (m) => m.type === 'game.finished' && m.payload.persistenceStatus === 'failed');
      expect(finishedOf(failed)).toEqual({ sessionId, outcome: 'cancelled', score: 0, persistenceStatus: 'failed', reason: 'left' });
    }

    // Retries keep going every 10 minutes, with no second `failed`.
    for (let i = 0; i < 3; i++) {
      const at = (await alarmAt(stub))!;
      expect(at - clock.t).toBe(RETRY_FOREVER_MS);
      clock.t = at;
      const before = fake.recordCalls().length;
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(fake.recordCalls()).toHaveLength(before + 1);
    }
    await sleep(50);
    expect(failedFor(sa)).toHaveLength(1);
    expect(failedFor(sb)).toHaveLength(1);
    expect((await rows(stub))[0]?.failed_reported).toBe(1);
  });

  it('survives a restart: the new instance re-arms the alarm and the save completes', async () => {
    const name = `results-${crypto.randomUUID()}`;
    const before = freshWorld(name);
    fake.resultsDown = true;
    const { sa, sb, sessionId } = await playCancelledRound(before);
    await vi.waitFor(async () => expect((await rows(before))[0]?.attempts).toBe(1));

    // Prove the constructor re-arms: remove the alarm, then restart the object.
    await runInDurableObject(before, (_i: WorldObject, state) => state.storage.deleteAlarm());
    closeAll([sa, sb]);
    await Promise.all([sa.closed, sb.closed]);
    // Tears every instance down without draining (like a deploy); storage is kept.
    await abortAllDurableObjects();
    stubs.length = 0; // stubs to aborted instances are broken

    // A new stub's first request constructs a new instance (in-memory state gone, rows kept).
    const stub = freshWorld(name);
    const clock = { t: Date.now() + 120_000 };
    await runInDurableObject(stub, (i: WorldObject) => i.setTestOverrides({ resultsNow: () => clock.t }));
    expect(await alarmAt(stub)).not.toBeNull();
    expect((await rows(stub)).map((r) => r.session_id)).toEqual([sessionId]);

    fake.resultsDown = false;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await rows(stub)).toEqual([]);
    expect(fake.results.has(sessionId)).toBe(true);
    expect(await alarmAt(stub)).toBeNull();
  });

  it('a lost response then a retry gives one saved result and one result.saved', async () => {
    const stub = freshWorld();
    const clock = await fakeClock(stub);
    // The database commits the first call, but the response never arrives.
    fake.onRecord = (body, f) => {
      recordIdempotently(body, f);
      f.onRecord = null;
      throw new TypeError('connection reset');
    };
    const { sa, sb, sessionId } = await playCancelledRound(stub);
    await vi.waitFor(async () => expect((await rows(stub))[0]?.attempts).toBe(1));
    expect(fake.results.has(sessionId)).toBe(true);

    clock.t = (await alarmAt(stub))!;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await rows(stub)).toEqual([]);
    expect(fake.recordCalls()).toHaveLength(2);
    expect(fake.results.size).toBe(1);

    await sleep(100);
    for (const s of [sa, sb]) {
      const saved = s.received.filter((m) => m.type === 'result.saved');
      expect(saved).toEqual([{ type: 'result.saved', payload: { sessionId, resultId: fake.results.get(sessionId) } }]);
    }
  });

  it('an alarm while the first attempt is still in flight does not call recordResult again', async () => {
    const stub = freshWorld();
    const clock = await fakeClock(stub);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.onRecord = async (body, f) => {
      await gate;
      return recordIdempotently(body, f);
    };
    const { sb, sessionId } = await playCancelledRound(stub);
    await vi.waitFor(() => expect(fake.recordCalls()).toHaveLength(1));

    clock.t = (await alarmAt(stub))!;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(fake.recordCalls()).toHaveLength(1);

    release();
    const saved = await sb.next('result.saved');
    expect(saved.type === 'result.saved' && saved.payload.sessionId).toBe(sessionId);
    expect(await rows(stub)).toEqual([]);
    expect(fake.recordCalls()).toHaveLength(1);
  });

  it('local test override: the first N saves use a key Supabase rejects, then the real key', async () => {
    const stub = freshWorld();
    const clock = await fakeClock(stub);
    expect(await runInDurableObject(stub, (i: WorldObject) => i.setTestOverrides({ resultSaveFailures: 1 }))).toBe(true);
    const { sb, sessionId } = await playCancelledRound(stub);
    await vi.waitFor(async () => expect((await rows(stub))[0]?.attempts).toBe(1));
    expect(fake.results.has(sessionId)).toBe(false);

    clock.t = (await alarmAt(stub))!;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const saved = await sb.next('result.saved');
    expect(saved.type === 'result.saved' && saved.payload.sessionId).toBe(sessionId);
    const keys = fake.rpcCalls.filter((c) => c.url.endsWith('/record_portal_partners_result')).map((c) => c.headers.get('apikey'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(SECRET_KEY);
    expect(keys[1]).toBe(SECRET_KEY);
    expect(await rows(stub)).toEqual([]);
  });
});
