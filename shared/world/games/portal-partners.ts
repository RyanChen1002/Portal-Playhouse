import type { GameStateBase, PortalPartnersState, Vec3 } from '../../contracts';
import type { MoveVerdict } from '../movement';
import type { Effect, GameModule, InteractOutcome, Override, RoundView } from './types';

export const PP_ROUND_MS = 180_000;
export const ARENA_SPEED = 4;
export const ARENA_HALF_X = 9.6;
export const ARENA_HALF_Z = 7.7;
export const ARENA_SPAWNS: readonly [Vec3, Vec3] = [
  { x: -3, y: 0, z: 6 },
  { x: 0, y: 0, z: 6 },
];
export const ARENA_GAP_HALF_Z = 1.25;
export const ARENA_BRIDGE_HALF_X = 1.2;
export const ARENA_SETBACK_Z = 1.35;
export const PLATE = { x: -5, z: 3 } as const;
export const PLATE_RADIUS = 1.3;
export const LEVER = { x: 2, z: -4 } as const;
export const CRYSTAL_A = { x: -6, z: -5 } as const;
export const CRYSTAL_B = { x: 6, z: -5 } as const;
export const EXIT = { x: 0, z: -7 } as const;
export const EXIT_RADIUS = 2.3;
export const INTERACT_RADIUS = 1.9;

const SAMPLE_STEP = 0.1;

export interface PPState {
  latched: boolean;
  crystals: [boolean, boolean];
  open: boolean;
  lastOutside: Map<string, Vec3>;
}

type PPView = Omit<PortalPartnersState, keyof GameStateBase>;

const dist2d = (p: Vec3, o: { x: number; z: number }): number => Math.hypot(p.x - o.x, p.z - o.z);
const onPlate = (view: RoundView): boolean => view.players.some((p) => dist2d(p.position, PLATE) <= PLATE_RADIUS);
const computeOpen = (s: PPState, view: RoundView): boolean => s.latched || onPlate(view);

export function setBack(position: Vec3, lastOutside: Vec3): Vec3 {
  return { x: position.x, y: position.y, z: lastOutside.z > 0 ? ARENA_SETBACK_Z : -ARENA_SETBACK_Z };
}

const invalid = (message: string): InteractOutcome => ({ ok: false, message });

function targetPoint(target: string): { x: number; z: number } | null {
  switch (target) {
    case 'lever':
      return LEVER;
    case 'crystal-a':
      return CRYSTAL_A;
    case 'crystal-b':
      return CRYSTAL_B;
    case 'exit':
      return EXIT;
    default:
      return null;
  }
}

export const PORTAL_PARTNERS: GameModule<PPState, PPView> = {
  gameType: 'portal-partners',
  name: 'Portal Partners',
  roundMs: PP_ROUND_MS,
  arena: { halfX: ARENA_HALF_X, halfZ: ARENA_HALF_Z, speed: ARENA_SPEED },
  spawns: ARENA_SPAWNS,
  scoreMax: 2,
  targets: ['lever', 'crystal-a', 'crystal-b', 'exit'],
  correctionReasons: ['rejected', 'bridgeClosed'],
  disconnect: { duringGrace: 'keepRunning', onExpiry: 'cancel' },

  start(view) {
    const lastOutside = new Map<string, Vec3>();
    view.players.forEach((p, i) => lastOutside.set(p.id, { ...ARENA_SPAWNS[i]! }));
    const s: PPState = { latched: false, crystals: [false, false], open: false, lastOutside };
    s.open = computeOpen(s, view);
    return s;
  },

  checkMove(s, view, _playerId, from, to): MoveVerdict {
    const open = computeOpen(s, view);
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      if (Math.abs(z) < ARENA_GAP_HALF_Z && (!open || Math.abs(x) > ARENA_BRIDGE_HALF_X)) return 'reject';
    }
    return 'allow';
  },

  afterMove(s, view, playerId): Effect {
    const mover = view.player(playerId);
    if (Math.abs(mover.position.z) >= ARENA_GAP_HALF_Z) s.lastOutside.set(playerId, { ...mover.position });
    const open = computeOpen(s, view);
    if (open === s.open) return {};
    s.open = open;
    if (open) return { stateChanged: true };
    const overrides: Override[] = [];
    for (const p of view.players) {
      const last = s.lastOutside.get(p.id);
      if (!last || Math.abs(p.position.z) >= ARENA_GAP_HALF_Z) continue;
      overrides.push({ playerId: p.id, position: setBack(p.position, last), reason: 'bridgeClosed' });
    }
    return { overrides, stateChanged: true };
  },

  interact(s, view, playerId, target): InteractOutcome {
    const point = targetPoint(target);
    const me = view.player(playerId);
    if (!point || dist2d(me.position, point) > INTERACT_RADIUS) return invalid('Move closer to interact.');
    switch (target) {
      case 'lever':
        if (s.latched) return invalid('The lever is already pulled.');
        s.latched = true;
        s.open = true;
        return { ok: true, effect: { stateChanged: true } };
      case 'crystal-a':
      case 'crystal-b': {
        const i = target === 'crystal-a' ? 0 : 1;
        if (s.crystals[i]) return invalid('That crystal is already collected.');
        s.crystals[i] = true;
        return { ok: true, effect: { stateChanged: true } };
      }
      default: {
        if (!s.crystals[0] || !s.crystals[1]) return invalid('Collect both crystals first.');
        const [p1, p2] = view.players;
        if (!p1.connected || !p2.connected) return invalid('Both players must be connected.');
        if (dist2d(p1.position, EXIT) > EXIT_RADIUS || dist2d(p2.position, EXIT) > EXIT_RADIUS) {
          return invalid('Both players must be at the exit.');
        }
        return { ok: true, effect: { end: 'win' } };
      }
    }
  },

  view(s, view): PPView {
    return { bridgeOpen: computeOpen(s, view), latched: s.latched, crystals: [s.crystals[0], s.crystals[1]] };
  },

  score(s) {
    return s.crystals.filter(Boolean).length;
  },
};
