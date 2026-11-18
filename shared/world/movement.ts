import type { Vec3 } from '../contracts';
import {
  ARENA_HALF_X,
  ARENA_HALF_Z,
  ARENA_SPEED,
  BUDGET_REFILL_FACTOR,
  BUDGET_SLACK,
  COURTYARD_RADIUS,
  COURTYARD_SPEED,
  Y_MAX,
  Y_MIN,
  type Location,
} from './config';

const EPSILON = 1e-9;

export interface MoveTracker {
  position: Vec3;
  rotation: number;
  budget: number;
  lastAt: number;
  lastSequence: number;
}

export type Barrier = (from: Vec3, to: Vec3) => boolean; // true = path blocked

export type MoveCheck =
  | { kind: 'accepted'; tracker: MoveTracker }
  | { kind: 'stale' }
  | { kind: 'rejected'; tracker: MoveTracker };

function speedOf(loc: Location): number {
  return loc === 'courtyard' ? COURTYARD_SPEED : ARENA_SPEED;
}

function budgetCap(loc: Location): number {
  return speedOf(loc) * 1 + BUDGET_SLACK;
}

export function newTracker(position: Vec3, rotation: number, now: number, loc: Location = 'courtyard'): MoveTracker {
  // A full budget for the location the tracker starts in.
  return { position, rotation, budget: budgetCap(loc), lastAt: now, lastSequence: -1 };
}

export function inBounds(loc: Location, p: Vec3): boolean {
  if (!(p.y >= Y_MIN && p.y <= Y_MAX)) return false;
  if (loc === 'courtyard') return Math.hypot(p.x, p.z) <= COURTYARD_RADIUS + EPSILON;
  return Math.abs(p.x) <= ARENA_HALF_X + EPSILON && Math.abs(p.z) <= ARENA_HALF_Z + EPSILON;
}

export function checkMove(
  t: MoveTracker,
  loc: Location,
  seq: number,
  to: Vec3,
  rotation: number,
  now: number,
  barrier?: Barrier,
): MoveCheck {
  if (seq <= t.lastSequence) return { kind: 'stale' };

  const cap = budgetCap(loc);
  const elapsed = Math.max(0, now - t.lastAt);
  const refilled = Math.min(
    cap,
    t.budget + (elapsed / 1000) * BUDGET_REFILL_FACTOR * speedOf(loc),
  );
  const base: MoveTracker = { ...t, budget: refilled, lastAt: now, lastSequence: seq };
  const reject = (): MoveCheck => ({ kind: 'rejected', tracker: base });

  if (!inBounds(loc, to)) return reject();
  const distance = Math.hypot(to.x - t.position.x, to.z - t.position.z);
  if (distance > refilled + EPSILON) return reject();
  if (barrier?.(t.position, to)) return reject();

  return {
    kind: 'accepted',
    tracker: {
      ...base,
      position: to,
      rotation,
      budget: Math.max(0, refilled - distance),
    },
  };
}
