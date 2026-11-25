// Test-only game module for the engine tests. Not exported from `index.ts`.
import { expect } from 'vitest';
import type { CorrectionReason, GameType, Vec3 } from '../contracts';
import { GRACE_MS, IDLE_MS, WORLD_LIMIT, type GameRoomConfig, type WorldConfig } from './config';
import type { Effect, GameModule, InteractOutcome } from './games/types';
import type { MoveVerdict } from './movement';
import { ENTRANCE, LOBBY_SPAWN, admit, conn, join, makeWorld, only, ready, walk, type TestWorld } from './test-helpers';

/** Records every hook call; the `next*` effects are returned once, then reset to `{}`. */
export interface TestState {
  calls: {
    checkMove: string[];
    interact: [string, string][];
    tick: number;
    onConnection: [string, boolean][];
  };
  score: number;
  verdict: MoveVerdict;
  /** Null: the arena speed. */
  speed: number | null;
  interactResult: InteractOutcome;
  nextAfterMove: Effect;
  nextTick: Effect;
  nextOnConnection: Effect;
  /** The hook (by name) that throws `new Error('boom')`; null: none. */
  throwIn: string | null;
  /** The `roundNumber` `start` received. */
  roundNumber: number;
}

/** `start` has no state yet, so it throws when this module-level flag is set. */
let throwOnStart = false;
export function setThrowOnStart(value: boolean): void {
  throwOnStart = value;
}

const maybeThrow = (s: TestState, hook: string): void => {
  if (s.throwIn === hook) throw new Error('boom');
};

const take = (s: TestState, key: 'nextAfterMove' | 'nextTick' | 'nextOnConnection'): Effect => {
  const e = s[key];
  s[key] = {};
  return e;
};

export const TEST_GAME: GameModule<TestState> = {
  gameType: 'test-game' as GameType,
  name: 'Test Game',
  roundMs: 10_000,
  arena: { halfX: 9, halfZ: 9, speed: 4 },
  spawns: [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  scoreMax: 3,
  targets: ['push', 'win'],
  correctionReasons: ['pushed' as CorrectionReason],
  disconnect: { duringGrace: 'keepRunning', onExpiry: 'cancel' },
  start: (_view, roundNumber) => {
    if (throwOnStart) throw new Error('boom');
    return {
      calls: { checkMove: [], interact: [], tick: 0, onConnection: [] },
      score: 0,
      verdict: 'allow',
      speed: null,
      interactResult: { ok: true },
      nextAfterMove: {},
      nextTick: {},
      nextOnConnection: {},
      throwIn: null,
      roundNumber,
    };
  },
  checkMove(s, _view, playerId) {
    maybeThrow(s, 'checkMove');
    s.calls.checkMove.push(playerId);
    return s.verdict;
  },
  speed(s) {
    maybeThrow(s, 'speed');
    return s.speed ?? 4;
  },
  afterMove(s) {
    maybeThrow(s, 'afterMove');
    return take(s, 'nextAfterMove');
  },
  interact(s, _view, playerId, target) {
    maybeThrow(s, 'interact');
    s.calls.interact.push([playerId, target]);
    const r = s.interactResult;
    s.interactResult = { ok: true };
    return r;
  },
  tick(s) {
    maybeThrow(s, 'tick');
    s.calls.tick++;
    return take(s, 'nextTick');
  },
  onConnection(s, _view, playerId, connected) {
    maybeThrow(s, 'onConnection');
    s.calls.onConnection.push([playerId, connected]);
    return take(s, 'nextOnConnection');
  },
  view(s) {
    maybeThrow(s, 'view');
    return { score: s.score };
  },
  score(s) {
    maybeThrow(s, 'score');
    return s.score;
  },
};

export interface TestRound {
  tw: TestWorld;
  sid: string;
  /** The module's round state (the same object the engine passes to the hooks). */
  state: TestState;
  /** Messages reported through `onModuleError`. */
  errors: string[];
  /** Every state `start` returned, per room, in start order. */
  started: { test: TestState[]; test2: TestState[] };
}

/** The entrance of the `extraRoom` room `test2`, across the courtyard from `test`. */
export const ENTRANCE_2: Vec3 = { x: 10.5, y: 0, z: 0 };

/**
 * A world whose game room `test` (at the portal entrance) runs TEST_GAME with `overrides`;
 * players 1 and 2 are admitted, joined and ready, so a round is running. With `extraRoom`, a
 * second room `test2` (at ENTRANCE_2) runs an unmodified TEST_GAME for players 3 and 4, started
 * the same way.
 */
export function testWorld(
  overrides: Partial<GameModule<TestState>> = {},
  { extraRoom = false }: { extraRoom?: boolean } = {},
): TestRound {
  let state: TestState | undefined;
  const started: TestRound['started'] = { test: [], test2: [] };
  const base = { ...TEST_GAME, ...overrides };
  const game: GameModule<TestState> = {
    ...base,
    start(view, roundNumber) {
      state = base.start(view, roundNumber);
      started.test.push(state);
      return state;
    },
  };
  const game2: GameModule<TestState> = {
    ...TEST_GAME,
    start(view, roundNumber) {
      const s = TEST_GAME.start(view, roundNumber);
      started.test2.push(s);
      return s;
    },
  };
  const room = (id: string, g: GameModule, entrance: Vec3): GameRoomConfig => ({
    id,
    game: g,
    minPlayers: 2,
    maxPlayers: 2,
    entrance,
    joinRadius: 3.2,
  });
  const config: WorldConfig = {
    worldLimit: WORLD_LIMIT,
    graceMs: GRACE_MS,
    idleMs: IDLE_MS,
    rooms: [
      room('test', game as GameModule, ENTRANCE),
      ...(extraRoom ? [room('test2', game2 as GameModule, ENTRANCE_2)] : []),
    ],
  };
  const errors: string[] = [];
  const tw = makeWorld(config, (m) => errors.push(m));
  const rooms: [string, Vec3, number[]][] = [['test', ENTRANCE, [1, 2]]];
  if (extraRoom) rooms.push(['test2', ENTRANCE_2, [3, 4]]);
  // Everyone walks and joins first, so both rounds start at the same time.
  for (const [roomId, entrance, ns] of rooms) {
    for (const n of ns) {
      expect(admit(tw, n).error).toBeNull();
      walk(tw, n, LOBBY_SPAWN, entrance);
      join(tw, n, roomId);
    }
  }
  for (const [, , ns] of rooms) for (const n of ns) ready(tw, n);
  const snap = only(tw.messagesFor(conn(1)), 'room.snapshot').pop();
  const sid = snap?.payload.session?.sessionId;
  if (!sid || !state) throw new Error('testWorld: the round did not start');
  tw.clear();
  return { tw, sid, state, errors, started };
}
