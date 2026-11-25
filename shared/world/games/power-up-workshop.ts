import type { GameStateBase, GameType, PowerUpWorkshopState, Vec3 } from '../../contracts';
import { POWER_UP_WORKSHOP_TARGETS } from '../../contracts';
import type { GameModule, InteractOutcome, RoundView } from './types';

export const PUW_ROUND_MS = 180_000;
export const PUW_SPAWNS: readonly [Vec3, Vec3] = [
  { x: -3, y: 0, z: 6 },
  { x: 0, y: 0, z: 6 },
];
export const PUW_INTERACT_RADIUS = 1.9;
export const GEAR_POINTS = [{ x: -6, z: -5 }, { x: 0, z: -5 }, { x: 6, z: -5 }] as const;
export const SOCKET_POINTS = [{ x: -6, z: -2 }, { x: 0, z: -2 }, { x: 6, z: -2 }] as const;
export const CABLE_POINTS = [{ x: -6, z: 1 }, { x: 0, z: 1 }, { x: 6, z: 1 }] as const;
export const POWER_RIGHT = { x: 4, z: 5 } as const;
export const POWER_LEFT = { x: -4, z: 5 } as const;

/** Gear targets and the cable each socket needs (0 = A, 1 = B, 2 = C), per level 1..5. */
export const LEVELS: readonly { gearTargets: [number, number, number]; socketCables: [number, number, number] }[] = [
  { gearTargets: [1, 2, 3], socketCables: [0, 1, 2] },
  { gearTargets: [2, 3, 1], socketCables: [0, 1, 2] },
  { gearTargets: [3, 1, 2], socketCables: [1, 2, 0] },
  { gearTargets: [1, 3, 2], socketCables: [2, 0, 1] },
  { gearTargets: [3, 2, 1], socketCables: [2, 1, 0] },
];

const CABLE_LETTERS = ['A', 'B', 'C'] as const;

export interface PUWState {
  level: number;
  gears: [number, number, number];
  gearTargets: [number, number, number];
  sockets: [boolean, boolean, boolean];
  socketCables: [number, number, number];
  /** Cable held, by player id; absent when empty-handed. */
  held: Map<string, number>;
  mistakes: number;
}

type PUWView = Omit<PowerUpWorkshopState, keyof GameStateBase>;

const dist2d = (p: Vec3, o: { x: number; z: number }): number => Math.hypot(p.x - o.x, p.z - o.z);
const invalid = (message: string): InteractOutcome => ({ ok: false, message });
const changed: InteractOutcome = { ok: true, effect: { stateChanged: true } };

function targetPoint(target: string): { x: number; z: number } | null {
  const m = /^(gear|socket|cable)-([012])$/.exec(target);
  if (m) {
    const i = Number(m[2]);
    return (m[1] === 'gear' ? GEAR_POINTS : m[1] === 'socket' ? SOCKET_POINTS : CABLE_POINTS)[i]!;
  }
  return target === 'power-right' ? POWER_RIGHT : null;
}

const cablePlugged = (s: PUWState, cable: number): boolean => s.sockets.some((filled, i) => filled && s.socketCables[i] === cable);
const score = (s: PUWState): number => s.gears.filter((g, i) => g === s.gearTargets[i]).length + s.sockets.filter(Boolean).length;

export const POWER_UP_WORKSHOP: GameModule<PUWState, PUWView> = {
  gameType: 'power-up-workshop' as GameType,
  name: 'Power-Up Workshop',
  roundMs: PUW_ROUND_MS,
  arena: { halfX: 9.6, halfZ: 7.7, speed: 4 },
  spawns: PUW_SPAWNS,
  scoreMax: 6,
  targets: POWER_UP_WORKSHOP_TARGETS,
  correctionReasons: [],
  disconnect: { duringGrace: 'keepRunning', onExpiry: 'cancel' },

  start(_view, roundNumber) {
    const index = roundNumber % LEVELS.length;
    const level = LEVELS[index]!;
    return {
      level: index + 1,
      gears: [0, 0, 0],
      gearTargets: [...level.gearTargets],
      sockets: [false, false, false],
      socketCables: [...level.socketCables],
      held: new Map(),
      mistakes: 0,
    };
  },

  checkMove: () => 'allow',

  interact(s, view, playerId, target): InteractOutcome {
    const point = targetPoint(target);
    const me = view.player(playerId);
    if (!point || dist2d(me.position, point) > PUW_INTERACT_RADIUS) return invalid('Move closer to interact.');
    const n = Number(target.slice(-1));
    if (target.startsWith('gear-')) {
      s.gears[n] = (s.gears[n]! + 1) % 4;
      return changed;
    }
    const holding = s.held.get(playerId);
    if (target.startsWith('cable-')) {
      if (holding !== undefined) return invalid('Plug in the cable you are holding first.');
      if (cablePlugged(s, n)) return invalid('That cable is already plugged in.');
      if ([...s.held.values()].includes(n)) return invalid('Your teammate has that cable.');
      s.held.set(playerId, n);
      return changed;
    }
    if (target.startsWith('socket-')) {
      if (s.sockets[n]) return invalid('That socket is already connected.');
      if (holding === undefined) return invalid('Bring a cable to this socket.');
      if (holding !== s.socketCables[n]) {
        s.mistakes += 1;
        return invalid(`This socket needs cable ${CABLE_LETTERS[s.socketCables[n]!]}.`);
      }
      s.sockets[n] = true;
      s.held.delete(playerId);
      return changed;
    }
    const partner = view.players.find((p) => p.id !== playerId)!;
    const ready =
      s.gears.every((g, i) => g === s.gearTargets[i]) &&
      s.sockets.every(Boolean) &&
      partner.connected &&
      dist2d(partner.position, POWER_LEFT) <= PUW_INTERACT_RADIUS;
    if (!ready) return invalid('Match the gears and cables, then hold both power stations.');
    return { ok: true, effect: { end: 'win' } };
  },

  onConnection(s, _view, playerId, connected) {
    if (connected || !s.held.delete(playerId)) return {};
    return { stateChanged: true };
  },

  view(s, view: RoundView): PUWView {
    return {
      level: s.level,
      gears: [...s.gears],
      gearTargets: [...s.gearTargets],
      sockets: [...s.sockets],
      socketCables: [...s.socketCables],
      held: [s.held.get(view.players[0].id) ?? null, s.held.get(view.players[1].id) ?? null],
      mistakes: s.mistakes,
    };
  },

  score,
};
