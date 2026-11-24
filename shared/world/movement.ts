import type { Vec3 } from '../contracts';
import {
  BUDGET_REFILL_FACTOR,
  BUDGET_SLACK,
  COURTYARD_RADIUS,
  COURTYARD_SPEED,
  Y_MAX,
  Y_MIN,
} from './config';

const EPSILON = 1e-9;

export interface MoveTracker {
  position: Vec3;
  rotation: number;
  budget: number;
  lastAt: number;
  lastSequence: number;
}

export type Bounds = { radius: number } | { halfX: number; halfZ: number };

export interface MoveArea {
  bounds: Bounds;
  speed: number;
}

export const COURTYARD_AREA: MoveArea = { bounds: { radius: COURTYARD_RADIUS }, speed: COURTYARD_SPEED };

export type Barrier = (from: Vec3, to: Vec3) => boolean; // true = path blocked

export type MoveVerdict = 'allow' | 'reject' | 'ignore';
export type PathCheck = (from: Vec3, to: Vec3) => MoveVerdict;

export type MoveCheck =
  | { kind: 'accepted'; tracker: MoveTracker }
  | { kind: 'stale' }
  | { kind: 'rejected'; tracker: MoveTracker }
  | { kind: 'ignored'; tracker: MoveTracker };

function budgetCap(area: MoveArea): number {
  return area.speed + BUDGET_SLACK;
}

export function newTracker(
  position: Vec3,
  rotation: number,
  now: number,
  area: MoveArea = COURTYARD_AREA,
): MoveTracker {
  // A full budget for the area the tracker starts in.
  return { position, rotation, budget: budgetCap(area), lastAt: now, lastSequence: -1 };
}

export function inBounds(bounds: Bounds, p: Vec3): boolean {
  if (!(p.y >= Y_MIN && p.y <= Y_MAX)) return false;
  if ('radius' in bounds) return Math.hypot(p.x, p.z) <= bounds.radius + EPSILON;
  return Math.abs(p.x) <= bounds.halfX + EPSILON && Math.abs(p.z) <= bounds.halfZ + EPSILON;
}

export function checkMove(
  t: MoveTracker,
  area: MoveArea,
  seq: number,
  to: Vec3,
  rotation: number,
  now: number,
  path?: PathCheck,
): MoveCheck {
  if (seq <= t.lastSequence) return { kind: 'stale' };

  const cap = budgetCap(area);
  const elapsed = Math.max(0, now - t.lastAt);
  const refilled = Math.min(cap, t.budget + (elapsed / 1000) * BUDGET_REFILL_FACTOR * area.speed);
  const base: MoveTracker = { ...t, budget: refilled, lastAt: now, lastSequence: seq };
  const reject = (): MoveCheck => ({ kind: 'rejected', tracker: base });

  if (!inBounds(area.bounds, to)) return reject();
  const distance = Math.hypot(to.x - t.position.x, to.z - t.position.z);
  if (distance > refilled + EPSILON) return reject();
  const verdict = path?.(t.position, to) ?? 'allow';
  if (verdict === 'reject') return reject();
  if (verdict === 'ignore') return { kind: 'ignored', tracker: base };

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
