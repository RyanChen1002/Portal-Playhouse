import type { CorrectionReason, GameType, Vec3 } from '../../contracts';
import type { MoveVerdict } from '../movement';

export interface RoundPlayer {
  id: string;
  position: Vec3;
  rotation: number;
  connected: boolean;
}
export interface RoundView {
  players: readonly [RoundPlayer, RoundPlayer]; // join order
  now: number;
  startedAt: number;
  /** Throws on an unknown id (engine bug). */
  player(id: string): RoundPlayer;
}
export interface Override {
  playerId: string;
  position: Vec3;
  rotation?: number;
  reason: string;
}
export interface Effect {
  overrides?: Override[];
  end?: 'win' | 'loss';
  stateChanged?: boolean;
}
export type InteractOutcome = { ok: true; effect?: Effect } | { ok: false; message: string }; // engine sends INVALID_ACTION
export interface DisconnectSettings {
  duringGrace: 'keepRunning';
  onExpiry: 'cancel';
}
/** Modules mutate `s` in place; `start` returns the initial value. */
export interface GameModule<S = unknown, V extends object = object> {
  gameType: GameType;
  name: string;
  roundMs: number;
  arena: { halfX: number; halfZ: number; speed: number };
  spawns: readonly [Vec3, Vec3];
  scoreMax: number;
  targets: readonly string[];
  correctionReasons: readonly CorrectionReason[];
  disconnect: DisconnectSettings;
  start(view: RoundView): S;
  checkMove(s: S, view: RoundView, playerId: string, from: Vec3, to: Vec3): MoveVerdict;
  speed?(s: S, view: RoundView, playerId: string): number;
  afterMove?(s: S, view: RoundView, playerId: string): Effect;
  interact(s: S, view: RoundView, playerId: string, target: string): InteractOutcome;
  tick?(s: S, view: RoundView): Effect;
  onConnection?(s: S, view: RoundView, playerId: string, connected: boolean): Effect;
  /** Game fields only; the engine adds startedAt, durationSeconds, serverTime. */
  view(s: S, view: RoundView): V;
  score(s: S): number;
}
