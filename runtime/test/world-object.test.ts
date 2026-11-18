import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../shared/contracts';
import type { World } from '../../shared/world';
import { isLocalUrl, testVarsFrom, type WorldObject } from '../src/world-object';
import {
  ALLOWED_ORIGIN,
  card,
  closeAll,
  connect,
  installFakeSupabase,
  joinAs,
  sleep,
  tokenFor,
  type FakeSupabase,
  type TestSocket,
} from './helpers';

let fake: FakeSupabase;
let sockets: TestSocket[];

/** A fresh World object per test, so in-memory state never leaks between tests. */
function freshWorld() {
  return env.WORLD.getByName(`test-${crypto.randomUUID()}`);
}

/** A new player id with a profile in the fake Supabase. */
function newPlayer(): string {
  const id = crypto.randomUUID();
  fake.profiles.set(id, card(id));
  return id;
}

async function open(target: Parameters<typeof connect>[0]) {
  const s = await connect(target);
  sockets.push(s);
  return s;
}

async function join(target: Parameters<typeof joinAs>[0], playerId: string) {
  const s = await joinAs(target, playerId);
  sockets.push(s);
  return s;
}

function errorOf(m: ServerMessage) {
  if (m.type !== 'request.error') throw new Error(`expected request.error, got ${m.type}`);
  return m;
}

function slotsUsed(stub: DurableObjectStub<WorldObject>): Promise<number> {
  return runInDurableObject(stub, (instance: WorldObject) => (instance as unknown as { world: World }).world.slotsUsed());
}

beforeEach(async () => {
  fake = await installFakeSupabase();
  sockets = [];
});

afterEach(() => {
  closeAll(sockets);
  fake.restore();
  vi.restoreAllMocks();
});

describe('Worker routing', () => {
  it('returns 403 for a disallowed or missing Origin', async () => {
    const evil = await exports.default.fetch('http://runtime.test/connect', {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
    });
    expect(evil.status).toBe(403);
    const none = await exports.default.fetch('http://runtime.test/connect', { headers: { Upgrade: 'websocket' } });
    expect(none.status).toBe(403);
  });

  it('returns 426 without a WebSocket upgrade', async () => {
    const res = await exports.default.fetch('http://runtime.test/connect', { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.status).toBe(426);
  });

  it('returns 404 for other paths', async () => {
    const res = await exports.default.fetch('http://runtime.test/other', {
      headers: { Upgrade: 'websocket', Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it('forwards an allowed upgrade to the world; valid auth gives world.snapshot', async () => {
    const id = newPlayer();
    const s = await open(exports.default);
    s.send({ type: 'auth', requestId: 'r1', payload: { token: await tokenFor(id) } });
    const snap = await s.next('world.snapshot');
    expect(snap.type === 'world.snapshot' && snap.payload.self.playerId).toBe(id);
    expect(snap.type === 'world.snapshot' && snap.payload.self.roomId).toBe('lobby');
  });
});

describe('authentication', () => {
  it('closes with UNAUTHORIZED when no auth arrives before the deadline', async () => {
    const stub = freshWorld();
    const applied = await runInDurableObject(stub, (instance: WorldObject) =>
      instance.setTestOverrides({ authDeadlineMs: 200 }),
    );
    expect(applied).toBe(true);
    const s = await open(stub);
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('UNAUTHORIZED');
    expect(err.requestId).toBeNull();
    expect((await s.closed).code).toBe(4401);
  });

  it('honours test overrides only for a local Supabase URL', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalUrl('http://localhost:54321')).toBe(true);
    expect(isLocalUrl('https://abc.supabase.co')).toBe(false);
    expect(isLocalUrl('https://127.0.0.1.evil.example')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });

  it('reads ROUND_MS and TEST_RESULT_SAVE_FAILURES only for a local Supabase URL', () => {
    const local = 'http://127.0.0.1:54321';
    expect(testVarsFrom({ SUPABASE_URL: local })).toEqual({ roundMs: null, resultSaveFailures: 0 });
    expect(testVarsFrom({ SUPABASE_URL: local, ROUND_MS: '3000', TEST_RESULT_SAVE_FAILURES: '2' })).toEqual({
      roundMs: 3000,
      resultSaveFailures: 2,
    });
    expect(
      testVarsFrom({ SUPABASE_URL: 'https://abc.supabase.co', ROUND_MS: '3000', TEST_RESULT_SAVE_FAILURES: '2' }),
    ).toEqual({ roundMs: null, resultSaveFailures: 0 });
    for (const bad of ['0', '-5', '2.5', 'abc', '']) {
      expect(testVarsFrom({ SUPABASE_URL: local, ROUND_MS: bad, TEST_RESULT_SAVE_FAILURES: bad })).toEqual({
        roundMs: null,
        resultSaveFailures: 0,
      });
    }
  });

  it('a non-auth first message gives UNAUTHORIZED and closes', async () => {
    const s = await open(freshWorld());
    s.send({ type: 'world.leave', requestId: 'r1', payload: {} });
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('UNAUTHORIZED');
    expect(err.requestId).toBe('r1');
    expect((await s.closed).code).toBe(4401);
  });

  it('an invalid token gives UNAUTHORIZED and closes', async () => {
    const s = await open(freshWorld());
    s.send({ type: 'auth', requestId: 'r1', payload: { token: 'garbage.token.value' } });
    expect(errorOf(await s.next('request.error')).error.code).toBe('UNAUTHORIZED');
    expect((await s.closed).code).toBe(4401);
  });

  it('closes the 33rd pending connection with SERVICE_UNAVAILABLE', async () => {
    const stub = freshWorld();
    for (let i = 0; i < 32; i++) await open(stub);
    const extra = await open(stub);
    const err = errorOf(await extra.next('request.error'));
    expect(err.error.code).toBe('SERVICE_UNAVAILABLE');
    expect((await extra.closed).code).toBe(4503);
    // The first 32 are still open.
    expect(sockets.slice(0, 32).every((s) => !s.isClosed())).toBe(true);
  });

  it('a missing profile gives SERVICE_UNAVAILABLE and closes', async () => {
    const s = await open(freshWorld());
    s.send({ type: 'auth', requestId: 'r1', payload: { token: await tokenFor(crypto.randomUUID()) } });
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.requestId).toBe('r1');
    expect((await s.closed).code).toBe(4503);
  });

  it('a Supabase outage gives SERVICE_UNAVAILABLE and closes', async () => {
    const id = newPlayer();
    fake.down = true;
    const s = await open(freshWorld());
    s.send({ type: 'auth', requestId: 'r1', payload: { token: await tokenFor(id) } });
    expect(errorOf(await s.next('request.error')).error.code).toBe('SERVICE_UNAVAILABLE');
    expect((await s.closed).code).toBe(4503);
  });

  it('calls get_runtime_profile with the secret key as apikey', async () => {
    const id = newPlayer();
    await join(freshWorld(), id);
    const call = fake.rpcCalls.find((c) => c.url.endsWith('/rest/v1/rpc/get_runtime_profile'));
    expect(call?.body).toEqual({ player_id: id });
    expect(call?.headers.get('apikey')).toBe('test-secret-key');
  });
});

describe('message limits', () => {
  it('answers a 5000-byte message with VALIDATION_ERROR and keeps the connection', async () => {
    const stub = freshWorld();
    const s = await join(stub, newPlayer());
    s.send('x'.repeat(5000));
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('VALIDATION_ERROR');
    expect(err.requestId).toBeNull();
    // Still served afterwards.
    s.send({ type: 'game.ready', requestId: 'r2', payload: { ready: true } });
    expect(errorOf(await s.next('request.error')).requestId).toBe('r2');
    expect(s.isClosed()).toBe(false);
  });

  it('answers invalid JSON with VALIDATION_ERROR before authentication too', async () => {
    const s = await open(freshWorld());
    s.send('{not json');
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('VALIDATION_ERROR');
    expect(err.requestId).toBeNull();
  });

  it('relays at most 20 of 30 moves sent within one second', async () => {
    const stub = freshWorld();
    const a = newPlayer();
    const b = newPlayer();
    const sa = await join(stub, a);
    const sb = await join(stub, b);
    for (let seq = 1; seq <= 30; seq++) {
      sa.send({ type: 'player.move', payload: { sequence: seq, position: { x: seq * 0.01, y: 0, z: 4 }, rotation: 0 } });
    }
    // After the bucket refills a little, one more move marks the end of the burst on B's stream.
    await sleep(300);
    sa.send({ type: 'player.move', payload: { sequence: 31, position: { x: 0.31, y: 0, z: 4 }, rotation: 0 } });
    await sb.next('player.updated', (m) => m.type === 'player.updated' && m.payload.sequence === 31);
    const relayed = sb.received.filter(
      (m) => m.type === 'player.updated' && m.payload.playerId === a && m.payload.sequence <= 30,
    );
    expect(relayed.length).toBeLessThanOrEqual(20);
    expect(relayed.length).toBeGreaterThanOrEqual(18);
  });

  it('closes the connection after 101 invalid messages', async () => {
    const s = await join(freshWorld(), newPlayer());
    for (let i = 0; i < 100; i++) s.send('nope');
    for (let i = 0; i < 100; i++) await s.next('request.error');
    expect(s.isClosed()).toBe(false);
    s.send('nope');
    expect((await s.closed).code).toBe(4400);
  });
});

describe('token refresh and expiry', () => {
  it('a valid refresh for the same user is accepted and extends the deadline', async () => {
    const id = newPlayer();
    const s = await open(freshWorld());
    // Effective deadline: exp + 30 s tolerance, so this token lapses about 1 s from now.
    s.send({ type: 'auth', requestId: 'r1', payload: { token: await tokenFor(id, -29) } });
    await s.next('world.snapshot');
    s.send({ type: 'auth.refresh', requestId: 'r2', payload: { token: await tokenFor(id) } });
    const ok = await s.next('request.accepted');
    expect(ok.type === 'request.accepted' && ok.requestId).toBe('r2');
    await sleep(1500);
    expect(s.isClosed()).toBe(false);
  });

  it('an invalid refresh token gives UNAUTHORIZED and keeps the connection', async () => {
    const id = newPlayer();
    const s = await join(freshWorld(), id);
    s.send({ type: 'auth.refresh', requestId: 'r2', payload: { token: 'garbage' } });
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('UNAUTHORIZED');
    expect(err.requestId).toBe('r2');
    s.send({ type: 'auth.refresh', requestId: 'r3', payload: { token: await tokenFor(id) } });
    await s.next('request.accepted');
    expect(s.isClosed()).toBe(false);
  });

  it('a valid refresh token for another user gives UNAUTHORIZED and closes', async () => {
    const s = await join(freshWorld(), newPlayer());
    s.send({ type: 'auth.refresh', requestId: 'r2', payload: { token: await tokenFor(newPlayer()) } });
    const err = errorOf(await s.next('request.error'));
    expect(err.error.code).toBe('UNAUTHORIZED');
    expect(err.requestId).toBe('r2');
    expect((await s.closed).code).toBe(4401);
  });

  it('token expiry closes the connection and starts grace (the slot is still held)', async () => {
    const stub = freshWorld();
    const a = newPlayer();
    const b = newPlayer();
    const sa = await open(stub);
    sa.send({ type: 'auth', requestId: 'r1', payload: { token: await tokenFor(a, -29) } });
    await sa.next('world.snapshot');
    const sb = await join(stub, b);

    const err = errorOf(await sa.next('request.error'));
    expect(err.error.code).toBe('UNAUTHORIZED');
    expect((await sa.closed).code).toBe(4401);
    const conn = await sb.next('player.connection');
    expect(conn.type === 'player.connection' && conn.payload).toMatchObject({ playerId: a, connected: false });
    expect(await slotsUsed(stub)).toBe(2);
  });
});

describe('relay and logs', () => {
  it("player A's accepted move reaches B as player.updated", async () => {
    const stub = freshWorld();
    const a = newPlayer();
    const sa = await join(stub, a);
    const sb = await join(stub, newPlayer());
    sa.send({ type: 'player.move', payload: { sequence: 1, position: { x: 0.5, y: 0, z: 4 }, rotation: 1 } });
    const up = await sb.next('player.updated');
    expect(up.type === 'player.updated' && up.payload).toMatchObject({
      playerId: a,
      position: { x: 0.5, y: 0, z: 4 },
      rotation: 1,
      sequence: 1,
    });
  });

  it('never logs a token', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const stub = freshWorld();
    const known = newPlayer();
    const unknown = crypto.randomUUID();
    const tokens = [await tokenFor(known), await tokenFor(unknown), await tokenFor(newPlayer()), 'garbage-token-xyz'];

    // Bad auth, missing profile, good auth, bad refresh, other-user refresh.
    const bad = await open(stub);
    bad.send({ type: 'auth', requestId: 'r1', payload: { token: tokens[3] } });
    await bad.closed;
    const missing = await open(stub);
    missing.send({ type: 'auth', requestId: 'r1', payload: { token: tokens[1] } });
    await missing.closed;
    const s = await open(stub);
    s.send({ type: 'auth', requestId: 'r1', payload: { token: tokens[0] } });
    await s.next('world.snapshot');
    s.send({ type: 'auth.refresh', requestId: 'r2', payload: { token: tokens[3] } });
    await s.next('request.error');
    s.send({ type: 'auth.refresh', requestId: 'r3', payload: { token: tokens[2] } });
    await s.closed;

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes(unknown) && l.includes('SERVICE_UNAVAILABLE'))).toBe(true);
    for (const line of lines) {
      for (const t of tokens) expect(line).not.toContain(t);
      expect(line).not.toContain('test-secret-key');
    }
  });
});
