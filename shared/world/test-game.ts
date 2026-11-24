// Test-only game module for the engine tests. Not exported from `index.ts`.
import { expect } from 'vitest';
import type { CorrectionReason, GameType } from '../contracts';
import { GRACE_MS, IDLE_MS, WORLD_LIMIT, type WorldConfig } from './config';
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
}

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
  start: () => ({
    calls: { checkMove: [], interact: [], tick: 0, onConnection: [] },
    score: 0,
    verdict: 'allow',
    speed: null,
    interactResult: { ok: true },
    nextAfterMove: {},
    nextTick: {},
    nextOnConnection: {},
  }),
  checkMove(s, _view, playerId) {
    s.calls.checkMove.push(playerId);
    return s.verdict;
  },
  speed: (s) => s.speed ?? 4,
  afterMove: (s) => take(s, 'nextAfterMove'),
  interact(s, _view, playerId, target) {
    s.calls.interact.push([playerId, target]);
    const r = s.interactResult;
    s.interactResult = { ok: true };
    return r;
  },
  tick(s) {
    s.calls.tick++;
    return take(s, 'nextTick');
  },
  onConnection(s, _view, playerId, connected) {
    s.calls.onConnection.push([playerId, connected]);
    return take(s, 'nextOnConnection');
  },
  view: (s) => ({ score: s.score }),
  score: (s) => s.score,
};

export interface TestRound {
  tw: TestWorld;
  sid: string;
  /** The module's round state (the same object the engine passes to the hooks). */
  state: TestState;
  /** Messages reported through `onModuleError`. */
  errors: string[];
}

/**
 * A world whose only game room is `test` (at the portal entrance) running TEST_GAME with
 * `overrides`; players 1 and 2 are admitted, joined and ready, so a round is running.
 */
export function testWorld(overrides: Partial<GameModule<TestState>> = {}): TestRound {
  let state: TestState | undefined;
  const base = { ...TEST_GAME, ...overrides };
  const game: GameModule<TestState> = {
    ...base,
    start(view) {
      state = base.start(view);
      return state;
    },
  };
  const config: WorldConfig = {
    worldLimit: WORLD_LIMIT,
    graceMs: GRACE_MS,
    idleMs: IDLE_MS,
    rooms: [{ id: 'test', game: game as GameModule, minPlayers: 2, maxPlayers: 2, entrance: ENTRANCE, joinRadius: 3.2 }],
  };
  const errors: string[] = [];
  const tw = makeWorld(config, (m) => errors.push(m));
  for (const n of [1, 2]) {
    expect(admit(tw, n).error).toBeNull();
    walk(tw, n, LOBBY_SPAWN, ENTRANCE);
    join(tw, n, 'test');
  }
  ready(tw, 1);
  ready(tw, 2);
  const snap = only(tw.messagesFor(conn(1)), 'room.snapshot').pop();
  const sid = snap?.payload.session?.sessionId;
  if (!sid || !state) throw new Error('testWorld: the round did not start');
  tw.clear();
  return { tw, sid, state, errors };
}
