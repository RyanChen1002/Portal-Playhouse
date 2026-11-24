import { describe, expect, it } from 'vitest';
import {
  COURTYARD_AREA,
  checkMove,
  inBounds,
  newTracker,
  type MoveArea,
  type MoveCheck,
  type MoveTracker,
} from './movement';

const PORTAL_AREA: MoveArea = { bounds: { halfX: 9.6, halfZ: 7.7 }, speed: 4 };

const origin = { x: 0, y: 0, z: 0 };

function accepted(r: MoveCheck): MoveTracker {
  if (r.kind !== 'accepted') throw new Error(`expected accepted, got ${r.kind}`);
  return r.tracker;
}

describe('checkMove', () => {
  it('accepts a normal walk', () => {
    let t = newTracker(origin, 0, 0);
    for (let i = 1; i <= 30; i++) {
      t = accepted(checkMove(t, COURTYARD_AREA, i, { x: 0.48 * i, y: 0, z: 0 }, 0, i * 100));
    }
    expect(t.position.x).toBeCloseTo(14.4);
  });

  it('rejects a teleport after standing still', () => {
    const t = newTracker(origin, 0, 0);
    expect(checkMove(t, COURTYARD_AREA, 1, { x: 6, y: 0, z: 0 }, 0, 10_000).kind).toBe('rejected');
    expect(checkMove(t, COURTYARD_AREA, 1, { x: 5.2, y: 0, z: 0 }, 0, 10_000).kind).toBe('accepted');
  });

  it('tolerates bunched messages', () => {
    let t = newTracker(origin, 0, 0);
    for (let i = 1; i <= 5; i++) {
      t = accepted(checkMove(t, COURTYARD_AREA, i, { x: 0.48 * i, y: 0, z: 0 }, 0, 1000));
    }
  });

  it('budget refills at 1.25 x speed', () => {
    let t = newTracker(origin, 0, 0);
    t = accepted(checkMove(t, COURTYARD_AREA, 1, { x: 5.3, y: 0, z: 0 }, 0, 0));
    expect(t.budget).toBeCloseTo(0);
    expect(checkMove(t, COURTYARD_AREA, 2, { x: 11.3, y: 0, z: 0 }, 0, 1000).kind).toBe('rejected');
    const at500 = (d: number) =>
      checkMove(t, COURTYARD_AREA, 2, { x: 5.3 + d, y: 0, z: 0 }, 0, 500).kind;
    expect(at500(3.0)).toBe('accepted');
    expect(at500(3.1)).toBe('rejected');
  });

  it('enforces bounds', () => {
    const t = newTracker(origin, 0, 0);
    const kind = (area: MoveArea, p: { x: number; y: number; z: number }) =>
      checkMove(t, area, 1, p, 0, 0).kind;
    expect(inBounds(COURTYARD_AREA.bounds, { x: 23, y: 0, z: 0 })).toBe(true);
    expect(kind(COURTYARD_AREA, { x: 23.01, y: 0, z: 0 })).toBe('rejected');
    expect(kind(PORTAL_AREA, { x: 9.61, y: 0, z: 0 })).toBe('rejected');
    expect(kind(PORTAL_AREA, { x: 0, y: 0, z: -7.71 })).toBe('rejected');
    for (const area of [COURTYARD_AREA, PORTAL_AREA]) {
      expect(kind(area, { x: 0, y: 3.01, z: 0 })).toBe('rejected');
      expect(kind(area, { x: 0, y: -0.01, z: 0 })).toBe('rejected');
      expect(kind(area, { x: 0, y: 3, z: 0 })).toBe('accepted');
    }
  });

  it('ignores stale sequences and advances on rejection', () => {
    const t = accepted(checkMove(newTracker(origin, 0, 0), COURTYARD_AREA, 5, { x: 1, y: 0, z: 0 }, 0, 0));
    expect(checkMove(t, COURTYARD_AREA, 5, { x: 2, y: 0, z: 0 }, 0, 0)).toEqual({ kind: 'stale' });
    expect(checkMove(t, COURTYARD_AREA, 4, { x: 2, y: 0, z: 0 }, 0, 0)).toEqual({ kind: 'stale' });
    const r = checkMove(t, COURTYARD_AREA, 6, { x: 99, y: 0, z: 0 }, 0, 0);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') {
      expect(r.tracker.lastSequence).toBe(6);
      expect(r.tracker.position).toEqual(t.position);
    }
  });

  it('starts with the cap of its location', () => {
    expect(newTracker(origin, 0, 0).budget).toBeCloseTo(5.3);
    expect(newTracker(origin, 0, 0, COURTYARD_AREA).budget).toBeCloseTo(5.3);
    const arena = newTracker(origin, 0, 0, PORTAL_AREA);
    expect(arena.budget).toBeCloseTo(4.5);
    expect(checkMove(arena, PORTAL_AREA, 1, { x: 4.6, y: 0, z: 0 }, 0, 0).kind).toBe('rejected');
    expect(checkMove(arena, PORTAL_AREA, 1, { x: 4.5, y: 0, z: 0 }, 0, 0).kind).toBe('accepted');
  });

  it('rejects when the barrier blocks without spending budget', () => {
    const t = newTracker(origin, 0, 0);
    const r = checkMove(t, COURTYARD_AREA, 1, { x: 1, y: 0, z: 0 }, 0, 0, () => 'reject');
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.tracker.budget).toBeCloseTo(t.budget);
  });

  it('a path check of ignore returns ignored with the sequence recorded and the position kept', () => {
    const t = newTracker(origin, 0, 0);
    const r = checkMove(t, COURTYARD_AREA, 3, { x: 1, y: 0, z: 0 }, 1, 0, () => 'ignore');
    expect(r.kind).toBe('ignored');
    if (r.kind === 'ignored') {
      expect(r.tracker.lastSequence).toBe(3);
      expect(r.tracker.position).toEqual(origin);
      expect(r.tracker.rotation).toBe(0);
    }
    expect(checkMove(t, COURTYARD_AREA, 3, { x: 1, y: 0, z: 0 }, 0, 0).kind).toBe('accepted');
    if (r.kind === 'ignored') {
      expect(checkMove(r.tracker, COURTYARD_AREA, 3, { x: 1, y: 0, z: 0 }, 0, 0)).toEqual({ kind: 'stale' });
    }
  });

  it('a slower area speed shrinks the budget', () => {
    const slow: MoveArea = { bounds: { radius: 23 }, speed: 2 };
    const t = newTracker(origin, 0, 0, slow);
    expect(t.budget).toBeCloseTo(2.5);
    // The brief's 2.6 exceeds the cap of 2 + 0.5, so the boundary is 2.5 / 2.6.
    expect(checkMove(t, slow, 1, { x: 2.6, y: 0, z: 0 }, 0, 0).kind).toBe('rejected');
    const t1 = accepted(checkMove(t, slow, 1, { x: 2.5, y: 0, z: 0 }, 0, 0));
    expect(checkMove(t1, slow, 2, { x: 2.51, y: 0, z: 0 }, 0, 0).kind).toBe('rejected');
  });
});
