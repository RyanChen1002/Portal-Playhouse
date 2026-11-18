import { describe, expect, it } from 'vitest';
import type { ServerMessage, Vec3 } from '../contracts';
import { DEFAULT_WORLD_CONFIG } from './config';
import {
  admit,
  admitAll,
  boards,
  card,
  conn,
  ENTRANCE,
  errorCode,
  interact,
  join,
  lastReply,
  leave,
  LOBBY_SPAWN,
  makeWorld,
  move,
  only,
  ready,
  setup,
  walk,
  type TestWorld,
} from './test-helpers';

const SPAWN1: Vec3 = { x: -3, y: 0, z: 6 };
const SPAWN2: Vec3 = { x: 0, y: 0, z: 6 };
const ON_PLATE: Vec3 = { x: -5, y: 0, z: 3 };
const iso = (ms: number) => new Date(ms).toISOString();
const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });

interface Game {
  tw: TestWorld;
  sid: string;
  t0: number;
}

/** Players 1 and 2 join the portal room and ready; players 3.. stay in the lobby. */
function startGame(count = 2, config?: Parameters<typeof setup>[2]): Game {
  const tw = setup(count, [1, 2], config);
  ready(tw, 1);
  ready(tw, 2);
  const state = only(tw.messagesFor(conn(1)), 'game.state');
  expect(state).toHaveLength(1);
  const sid = state[0]!.payload.sessionId;
  tw.clear();
  return { tw, sid, t0: tw.now() };
}

function snapshotOf(msgs: ServerMessage[]) {
  const snaps = only(msgs, 'world.snapshot');
  expect(snaps).toHaveLength(1);
  return snaps[0]!.payload;
}

/** Plate, bridge, lever, both crystals, and both players standing at the exit. */
function playToExit({ tw, sid }: Game): void {
  walk(tw, 1, SPAWN1, ON_PLATE);
  walk(tw, 2, SPAWN2, v(0, -4));
  walk(tw, 2, v(0, -4), v(1.5, -4));
  interact(tw, 2, sid, 'lever');
  walk(tw, 1, ON_PLATE, v(0, 2));
  walk(tw, 1, v(0, 2), v(0, -2));
  walk(tw, 1, v(0, -2), v(-5.5, -5));
  interact(tw, 1, sid, 'crystal-a');
  walk(tw, 2, v(1.5, -4), v(5.5, -5));
  interact(tw, 2, sid, 'crystal-b');
  walk(tw, 1, v(-5.5, -5), v(-0.5, -6.5));
  walk(tw, 2, v(5.5, -5), v(0.5, -6.5));
  for (const n of [1, 2]) expect(only(tw.messagesFor(conn(n)), 'player.corrected')).toEqual([]);
  tw.clear();
}

function finishedFor(tw: TestWorld, n: number) {
  return only(tw.messagesFor(conn(n)), 'game.finished').map((m) => m.payload);
}

describe('World rounds', () => {
  it('two ready players start exactly one round', () => {
    for (const order of [
      [1, 2],
      [2, 1],
    ] as const) {
      const tw = setup(3, [1, 2]);
      ready(tw, order[0]);
      for (const n of [1, 2, 3]) expect(only(tw.messagesFor(conn(n)), 'game.state')).toEqual([]);
      ready(tw, order[1]);

      const s1 = only(tw.messagesFor(conn(1)), 'game.state');
      const s2 = only(tw.messagesFor(conn(2)), 'game.state');
      expect(s1).toHaveLength(1);
      expect(s2).toEqual(s1);
      const sid = s1[0]!.payload.sessionId;
      expect(sid).toBeTruthy();
      expect(s1[0]!.payload.state).toEqual({
        bridgeOpen: false,
        latched: false,
        crystals: [false, false],
        startedAt: iso(tw.now()),
        durationSeconds: 180,
        serverTime: iso(tw.now()),
      });

      const b = boards(tw.messagesFor(conn(3)));
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({
        status: 'playing',
        sessionId: sid,
        startedAt: iso(tw.now()),
        durationSeconds: 180,
        score: 0,
        players: [card(1), card(2)],
      });

      // Readying again while playing starts nothing.
      ready(tw, 1);
      expect(errorCode(tw.messagesFor(conn(1)))).toBe('GAME_NOT_READY');
      ready(tw, 2, false);
      expect(errorCode(tw.messagesFor(conn(2)))).toBe('GAME_NOT_READY');
      tw.clear();

      // Spawn points in join order, and the round in the snapshot.
      tw.world.admit('c1b', card(1));
      const snap = snapshotOf(tw.messagesFor('c1b'));
      expect(snap.self.position).toEqual(SPAWN1);
      expect(snap.room.players.map((p) => [p.id, p.position])).toEqual([
        ['p1', SPAWN1],
        ['p2', SPAWN2],
      ]);
      expect(snap.room.session).toMatchObject({ sessionId: sid, bridgeOpen: false, durationSeconds: 180 });
      expect(tw.world.takeFinishedRounds()).toEqual([]);
    }
  });

  it('a third player gets ROOM_LOCKED but sees the score on the board', () => {
    const g = startGame(3);
    const { tw, sid } = g;
    walk(tw, 3, LOBBY_SPAWN, ENTRANCE);
    tw.clear();
    join(tw, 3);
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('ROOM_LOCKED');

    walk(tw, 1, SPAWN1, ON_PLATE);
    walk(tw, 2, SPAWN2, v(0, -4));
    walk(tw, 2, v(0, -4), v(5.5, -5));
    tw.clear();
    interact(tw, 2, sid, 'crystal-b');
    const b = boards(tw.messagesFor(conn(3)));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ status: 'playing', score: 1, sessionId: sid });
    // The lobby player never receives game state.
    expect(only(tw.messagesFor(conn(3)), 'game.state')).toEqual([]);
    const s = only(tw.messagesFor(conn(1)), 'game.state');
    expect(s).toHaveLength(1);
    expect(s[0]!.payload.state.crystals).toEqual([false, true]);
  });

  it('game.state at least once per second', () => {
    const { tw, t0 } = startGame(3);
    tw.advanceBy(1000);
    tw.world.advance();
    for (const n of [1, 2]) {
      const s = only(tw.messagesFor(conn(n)), 'game.state');
      expect(s).toHaveLength(1);
      expect(s[0]!.payload.state.serverTime).toBe(iso(t0 + 1000));
    }
    expect(tw.messagesFor(conn(3))).toEqual([]);
  });

  it('win', () => {
    const g = startGame(3);
    const { tw, sid, t0 } = g;

    // Invalid interactions change nothing.
    interact(tw, 1, sid, 'lever');
    expect(errorCode(tw.messagesFor(conn(1)))).toBe('INVALID_ACTION');
    interact(tw, 1, 'other-session', 'lever');
    expect(errorCode(tw.messagesFor(conn(1)))).toBe('NOT_IN_GAME');
    interact(tw, 3, sid, 'lever');
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('NOT_IN_GAME');
    expect(only(tw.messagesFor(conn(2)), 'game.state')).toEqual([]);

    playToExit(g);
    // A duplicate action id replays the original result without another state change.
    interact(tw, 1, sid, 'crystal-a', 'dup');
    expect(errorCode(tw.messagesFor(conn(1)))).toBe('INVALID_ACTION');
    interact(tw, 1, sid, 'crystal-a', 'dup');
    expect(errorCode(tw.messagesFor(conn(1)))).toBe('INVALID_ACTION');

    const winAt = tw.now();
    interact(tw, 2, sid, 'exit', 'exit-1');
    const expected = { sessionId: sid, outcome: 'win', score: 2, persistenceStatus: 'pending' };
    const m2 = tw.messagesFor(conn(2));
    expect(lastReply(m2)).toEqual({ type: 'request.accepted', requestId: 'i-exit-1', payload: null });
    expect(only(m2, 'game.finished').map((m) => m.payload)).toEqual([expected]);
    const m1 = tw.messagesFor(conn(1));
    expect(only(m1, 'game.finished').map((m) => m.payload)).toEqual([expected]);
    expect(tw.world.takeFinishedRounds()).toEqual([
      {
        sessionId: sid,
        playerIds: ['p1', 'p2'],
        outcome: 'win',
        cancelReason: null,
        score: 2,
        startedAt: iso(t0),
        completedAt: iso(winAt),
      },
    ]);

    // Back to waiting, readiness reset and announced, both still inside.
    expect(only(m1, 'player.ready').map((m) => [m.payload.playerId, m.payload.ready])).toEqual([
      ['p1', false],
      ['p2', false],
    ]);
    const b = boards(tw.messagesFor(conn(3)));
    expect(b[b.length - 1]).toMatchObject({ status: 'waiting', score: null, sessionId: null, players: [card(1), card(2)] });

    // The exit action again cannot finish the round twice.
    interact(tw, 2, sid, 'exit', 'exit-1');
    expect(errorCode(tw.messagesFor(conn(2)))).toBe('NOT_IN_GAME');
    expect(tw.world.takeFinishedRounds()).toEqual([]);

    tw.world.admit('c1b', card(1));
    const snap = snapshotOf(tw.messagesFor('c1b'));
    expect(snap.self).toMatchObject({ roomId: 'portal', position: null });
    expect(snap.room.session).toBeNull();
    expect(snap.lastFinished).toEqual(expected);

    // Replay: readying again starts a new session.
    tw.world.handle('c1b', { type: 'game.ready', requestId: 'again', payload: { ready: true } });
    ready(tw, 2);
    const next = only(tw.messagesFor('c1b'), 'game.state');
    expect(next).toHaveLength(1);
    expect(next[0]!.payload.sessionId).not.toBe(sid);
  });

  it('loss by time-out', () => {
    const { tw, sid, t0 } = startGame(3);
    tw.advanceBy(179_999);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
    tw.clear();

    tw.advanceBy(1);
    tw.world.advance();
    const expected = { sessionId: sid, outcome: 'loss', score: 0, persistenceStatus: 'pending' };
    for (const n of [1, 2]) expect(finishedFor(tw, n)).toEqual([expected]);
    expect(tw.world.takeFinishedRounds()).toEqual([
      {
        sessionId: sid,
        playerIds: ['p1', 'p2'],
        outcome: 'loss',
        cancelReason: null,
        score: 0,
        startedAt: iso(t0),
        completedAt: iso(t0 + 180_000),
      },
    ]);
    expect(boards(tw.messagesFor(conn(3)))[0]).toMatchObject({ status: 'waiting', score: null });

    // Positions are gone: moves do nothing.
    tw.advanceBy(100);
    move(tw, 1, v(-3, 5.8));
    expect(tw.messagesFor(conn(2))).toEqual([]);
  });

  it('late interaction is a loss', () => {
    const g = startGame();
    const { tw, sid, t0 } = g;
    playToExit(g);
    tw.advanceBy(t0 + 180_050 - tw.now());
    interact(tw, 2, sid, 'exit', 'late');
    expect(errorCode(tw.messagesFor(conn(2)))).toBe('NOT_IN_GAME');
    const rounds = tw.world.takeFinishedRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ outcome: 'loss', score: 2 });
    expect(finishedFor(tw, 1)).toEqual([{ sessionId: sid, outcome: 'loss', score: 2, persistenceStatus: 'pending' }]);
  });

  it('bridge closes under a player', () => {
    for (const disconnected of [false, true]) {
      const { tw, sid } = startGame();
      walk(tw, 1, SPAWN1, ON_PLATE);
      walk(tw, 2, SPAWN2, v(0, 0.5));
      expect(only(tw.messagesFor(conn(2)), 'player.corrected')).toEqual([]);
      const lastSeq2 = move(tw, 2, v(0, 0.5), 0.3);
      if (disconnected) tw.world.connectionLost(conn(2));
      tw.clear();

      // Player 1 steps off the plate.
      tw.advanceBy(500);
      move(tw, 1, v(-5, 4.5));
      const setBackPos = v(0, 1.35);
      const m2 = tw.messagesFor(conn(2));
      if (disconnected) {
        expect(m2).toEqual([]);
      } else {
        expect(only(m2, 'player.corrected')).toEqual([
          {
            type: 'player.corrected',
            payload: { sequence: lastSeq2, position: setBackPos, rotation: 0.3, reason: 'bridgeClosed' },
          },
        ]);
      }
      const m1 = tw.messagesFor(conn(1));
      const upd = only(m1, 'player.updated');
      expect(upd).toHaveLength(1);
      expect(upd[0]!.payload).toMatchObject({ playerId: 'p2', position: setBackPos, rotation: 0.3 });
      // A periodic game.state may come first (from advance()); the change is sent after the move.
      const st = only(m1, 'game.state').map((m) => m.payload.state.bridgeOpen);
      expect(st[st.length - 1]).toBe(false);
      expect(st.slice(0, -1).every((open) => open)).toBe(true);
      expect(only(m1, 'game.state').pop()!.payload.sessionId).toBe(sid);

      if (disconnected) {
        tw.world.admit('c2b', card(2));
        expect(snapshotOf(tw.messagesFor('c2b')).self.position).toEqual(setBackPos);
      }
      // Player 2 continues from the set-back position, and cannot re-enter the closed gap.
      const c2 = disconnected ? 'c2b' : conn(2);
      tw.advanceBy(100);
      move(tw, c2, v(0, 1.7));
      expect(only(tw.messagesFor(c2), 'player.corrected')).toEqual([]);
      tw.advanceBy(100);
      move(tw, c2, v(0, 1.2));
      expect(only(tw.messagesFor(c2), 'player.corrected').map((m) => m.payload.reason)).toEqual(['rejected']);
    }
  });

  it('leave cancels', () => {
    for (const how of ['room.leave', 'world.leave'] as const) {
      const { tw, sid } = startGame(3);
      if (how === 'room.leave') leave(tw, 1);
      else tw.world.handle(conn(1), { type: 'world.leave', requestId: 'w1', payload: {} });

      const expected = { sessionId: sid, outcome: 'cancelled', score: 0, persistenceStatus: 'pending', reason: 'left' };
      const m2 = tw.messagesFor(conn(2));
      expect(only(m2, 'game.finished').map((m) => m.payload)).toEqual([expected]);
      expect(only(m2, 'player.left').map((m) => m.payload.playerId)).toEqual(['p1']);
      expect(only(tw.messagesFor(conn(1)), 'game.finished')).toEqual([]);
      const rounds = tw.world.takeFinishedRounds();
      expect(rounds).toHaveLength(1);
      expect(rounds[0]).toMatchObject({ sessionId: sid, outcome: 'cancelled', cancelReason: 'left' });
      const b = boards(tw.messagesFor(conn(3)));
      expect(b[b.length - 1]).toMatchObject({ status: 'waiting', players: [card(2)] });
    }
  });

  it('grace keeps the round running', () => {
    const { tw, sid } = startGame(3);
    walk(tw, 1, SPAWN1, ON_PLATE);
    move(tw, 1, ON_PLATE, 1.25);
    tw.clear();

    const dropAt = tw.now();
    tw.world.connectionLost(conn(1));
    const conn2 = only(tw.messagesFor(conn(2)), 'player.connection');
    expect(conn2.map((m) => m.payload)).toEqual([{ playerId: 'p1', connected: false, revision: expect.any(Number) }]);
    expect(tw.messagesFor(conn(3))).toEqual([]);

    // The absent character still holds the plate: player 2 crosses.
    walk(tw, 2, SPAWN2, v(0, -2));
    expect(only(tw.messagesFor(conn(2)), 'player.corrected')).toEqual([]);

    tw.advanceBy(dropAt + 19_999 - tw.now());
    tw.clear();
    expect(tw.world.admit('c1b', card(1)).error).toBeNull();
    const snap = snapshotOf(tw.messagesFor('c1b'));
    expect(snap.self).toEqual({ playerId: 'p1', roomId: 'portal', position: ON_PLATE, rotation: 1.25 });
    expect(snap.room.session).toMatchObject({ sessionId: sid, bridgeOpen: true });
    expect(snap.room.players.find((p) => p.id === 'p2')?.position).toEqual(v(0, -2));
    expect(snap.lastFinished).toBeNull();
    expect(only(tw.messagesFor(conn(2)), 'player.connection').map((m) => m.payload)).toEqual([
      { playerId: 'p1', connected: true, revision: expect.any(Number) },
    ]);
    expect(tw.world.takeFinishedRounds()).toEqual([]);
    expect(tw.world.slotsUsed()).toBe(3);

    // Grace no longer runs out.
    tw.advanceBy(10_000);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
  });

  it('grace expiry cancels', () => {
    const { tw, sid } = startGame(3);
    tw.world.connectionLost(conn(1));
    tw.advanceBy(19_999);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.left')).toEqual([]);

    tw.advanceBy(1);
    tw.world.advance();
    const m2 = tw.messagesFor(conn(2)).filter((m) => m.type === 'game.finished' || m.type === 'player.left');
    expect(m2.map((m) => m.payload)).toEqual([
      { sessionId: sid, outcome: 'cancelled', score: 0, persistenceStatus: 'pending', reason: 'disconnected' },
      { playerId: 'p1', reason: 'disconnected', revision: expect.any(Number) },
    ]);
    const rounds = tw.world.takeFinishedRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ outcome: 'cancelled', cancelReason: 'disconnected' });
    expect(tw.world.slotsUsed()).toBe(2);
    expect(boards(tw.messagesFor(conn(3))).pop()).toMatchObject({ status: 'waiting', players: [card(2)] });
  });

  it('exit needs both connected', () => {
    const g = startGame();
    const { tw, sid } = g;
    playToExit(g);
    tw.world.connectionLost(conn(1));
    tw.clear();
    interact(tw, 2, sid, 'exit');
    expect(errorCode(tw.messagesFor(conn(2)))).toBe('INVALID_ACTION');
    expect(tw.world.takeFinishedRounds()).toEqual([]);
  });

  it('takeover mid-round is not a disconnect', () => {
    const { tw, sid } = startGame(3);
    walk(tw, 1, SPAWN1, v(-3, 5));
    move(tw, 1, v(-3, 5), 2);
    tw.clear();

    tw.world.admit('c1b', card(1));
    expect(tw.messagesFor(conn(1))).toEqual([{ type: 'session.replaced', payload: {} }]);
    const snap = snapshotOf(tw.messagesFor('c1b'));
    expect(snap.self).toEqual({ playerId: 'p1', roomId: 'portal', position: v(-3, 5), rotation: 2 });
    expect(snap.room.session?.sessionId).toBe(sid);
    // The old socket's close arrives afterwards: still not a disconnect.
    tw.world.connectionLost(conn(1));
    expect(tw.messagesFor(conn(2))).toEqual([]);

    tw.advanceBy(25_000);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.connection')).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.left')).toEqual([]);
    expect(tw.world.slotsUsed()).toBe(3);

    move(tw, 'c1b', v(-3, 4.6));
    expect(only(tw.messagesFor(conn(2)), 'player.updated')).toHaveLength(1);
  });

  it('both disconnect: time-out first is a single loss', () => {
    for (const steps of [[10_000, 10_000], [20_000]]) {
      const { tw, sid, t0 } = startGame();
      tw.advanceBy(170_000);
      tw.world.advance();
      tw.world.connectionLost(conn(1));
      tw.world.connectionLost(conn(2));
      for (const ms of steps) {
        tw.advanceBy(ms);
        tw.world.advance();
      }
      const rounds = tw.world.takeFinishedRounds();
      expect(rounds).toEqual([
        {
          sessionId: sid,
          playerIds: ['p1', 'p2'],
          outcome: 'loss',
          cancelReason: null,
          score: 0,
          startedAt: iso(t0),
          completedAt: expect.any(String),
        },
      ]);
      expect(tw.world.slotsUsed()).toBe(0);
      tw.advanceBy(60_000);
      tw.world.advance();
      expect(tw.world.takeFinishedRounds()).toEqual([]);
    }
  });

  it('both disconnect: grace first is a single cancellation', () => {
    const { tw, sid, t0 } = startGame();
    tw.advanceBy(10_000);
    tw.world.advance();
    tw.world.connectionLost(conn(1));
    tw.world.connectionLost(conn(2));
    tw.advanceBy(20_000);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([
      {
        sessionId: sid,
        playerIds: ['p1', 'p2'],
        outcome: 'cancelled',
        cancelReason: 'disconnected',
        score: 0,
        startedAt: iso(t0),
        completedAt: iso(t0 + 30_000),
      },
    ]);
    expect(tw.world.slotsUsed()).toBe(0);
    tw.advanceBy(200_000);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
  });

  it('reconnect after the round ended', () => {
    const { tw, sid, t0 } = startGame();
    tw.advanceBy(170_000);
    tw.world.connectionLost(conn(1));
    tw.advanceBy(15_000);
    tw.world.admit('c1b', card(1));
    const snap = snapshotOf(tw.messagesFor('c1b'));
    expect(snap.lastFinished).toEqual({ sessionId: sid, outcome: 'loss', score: 0, persistenceStatus: 'pending' });
    expect(snap.self).toMatchObject({ roomId: 'portal', position: null });
    expect(snap.room.session).toBeNull();
    expect(snap.room.summary?.status).toBe('waiting');
    expect(tw.world.takeFinishedRounds()).toHaveLength(1);
    expect(tw.now() - t0).toBe(185_000);
  });

  it('idle limit', () => {
    const tw = makeWorld();
    admitAll(tw, 2);
    tw.advanceBy(300_000);
    // Any handled message counts as activity.
    move(tw, 2, v(0, 4.2));
    tw.advanceBy(299_999);
    tw.world.advance();
    expect(tw.world.takeClosings()).toEqual([]);
    tw.clear();

    tw.advanceBy(1);
    tw.world.advance();
    expect(tw.world.takeClosings()).toEqual([{ conn: conn(1), reason: 'idle' }]);
    expect(tw.world.slotsUsed()).toBe(1);
    expect(only(tw.messagesFor(conn(2)), 'player.left').map((m) => m.payload)).toEqual([
      { playerId: 'p1', reason: 'idle', revision: expect.any(Number) },
    ]);
    expect(only(tw.messagesFor(conn(2)), 'player.connection')).toEqual([]);
    // No grace: the old connection is forgotten, and a reconnect is a fresh admission at spawn.
    tw.world.handle(conn(1), { type: 'room.join', requestId: 'x', payload: { roomId: 'portal' } });
    expect(tw.messagesFor(conn(1))).toEqual([]);
    tw.world.admit('c1b', card(1));
    expect(snapshotOf(tw.messagesFor('c1b')).self.position).toEqual(LOBBY_SPAWN);
  });

  it('idle during a round cancels it as disconnected', () => {
    const config = { ...DEFAULT_WORLD_CONFIG, idleMs: 60_000 };
    const { tw, sid } = startGame(2, config);
    let at = 0;
    for (let i = 0; i < 7; i++) {
      tw.advanceBy(9_000);
      at += 9_000;
      move(tw, 2, v(0, 6 - (i + 1) * 0.1));
    }
    expect(at).toBeGreaterThanOrEqual(60_000);
    expect(tw.world.takeClosings()).toEqual([{ conn: conn(1), reason: 'idle' }]);
    const m2 = tw.messagesFor(conn(2));
    expect(only(m2, 'game.finished').map((m) => m.payload)).toEqual([
      { sessionId: sid, outcome: 'cancelled', score: 0, persistenceStatus: 'pending', reason: 'disconnected' },
    ]);
    expect(only(m2, 'player.left').map((m) => m.payload.reason)).toEqual(['idle']);
    expect(tw.world.takeFinishedRounds()).toMatchObject([{ outcome: 'cancelled', cancelReason: 'disconnected' }]);
  });

  it('lobby grace', () => {
    const tw = makeWorld();
    admitAll(tw, 16);
    tw.clear();
    tw.world.connectionLost(conn(1));
    expect(only(tw.messagesFor(conn(2)), 'player.connection').map((m) => m.payload)).toEqual([
      { playerId: 'p1', connected: false, revision: expect.any(Number) },
    ]);
    expect(admit(tw, 17).error?.code).toBe('WORLD_FULL');
    tw.advanceBy(19_999);
    expect(admit(tw, 17).error?.code).toBe('WORLD_FULL');
    expect(tw.world.slotsUsed()).toBe(16);
    tw.advanceBy(1);
    expect(admit(tw, 17).error).toBeNull();
    expect(only(tw.messagesFor(conn(2)), 'player.left').map((m) => m.payload)).toEqual([
      { playerId: 'p1', reason: 'disconnected', revision: expect.any(Number) },
    ]);
    expect(tw.world.slotsUsed()).toBe(16);
  });

  it('lobby reconnect within grace keeps the position', () => {
    const tw = makeWorld();
    admitAll(tw, 2);
    walk(tw, 1, LOBBY_SPAWN, v(2, 4));
    tw.clear();
    tw.world.connectionLost(conn(1));
    tw.advanceBy(5_000);
    tw.world.admit('c1b', card(1));
    expect(snapshotOf(tw.messagesFor('c1b')).self.position).toEqual(v(2, 4));
    expect(only(tw.messagesFor(conn(2)), 'player.connection').map((m) => m.payload.connected)).toEqual([
      false,
      true,
    ]);
    tw.advanceBy(30_000);
    tw.world.advance();
    expect(tw.world.slotsUsed()).toBe(2);
  });
});
