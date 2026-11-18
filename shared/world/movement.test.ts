import { describe, expect, it } from 'vitest';
import { checkMove, inBounds, newTracker, type MoveCheck, type MoveTracker } from './movement';

const origin = { x: 0, y: 0, z: 0 };

function accepted(r: MoveCheck): MoveTracker {
  if (r.kind !== 'accepted') throw new Error(`expected accepted, got ${r.kind}`);
  return r.tracker;
}

describe('checkMove', () => {
  it('accepts a normal walk', () => {
    let t = newTracker(origin, 0, 0);
    for (let i = 1; i <= 30; i++) {
      t = accepted(checkMove(t, 'courtyard', i, { x: 0.48 * i, y: 0, z: 0 }, 0, i * 100));
    }
    expect(t.position.x).toBeCloseTo(14.4);
  });

  it('rejects a teleport after standing still', () => {
    const t = newTracker(origin, 0, 0);
    expect(checkMove(t, 'courtyard', 1, { x: 6, y: 0, z: 0 }, 0, 10_000).kind).toBe('rejected');
    expect(checkMove(t, 'courtyard', 1, { x: 5.2, y: 0, z: 0 }, 0, 10_000).kind).toBe('accepted');
  });

  it('tolerates bunched messages', () => {
    let t = newTracker(origin, 0, 0);
    for (let i = 1; i <= 5; i++) {
      t = accepted(checkMove(t, 'courtyard', i, { x: 0.48 * i, y: 0, z: 0 }, 0, 1000));
    }
  });

  it('budget refills at 1.25 x speed', () => {
    let t = newTracker(origin, 0, 0);
    t = accepted(checkMove(t, 'courtyard', 1, { x: 5.3, y: 0, z: 0 }, 0, 0));
    expect(t.budget).toBeCloseTo(0);
    expect(checkMove(t, 'courtyard', 2, { x: 11.3, y: 0, z: 0 }, 0, 1000).kind).toBe('rejected');
    const at500 = (d: number) =>
      checkMove(t, 'courtyard', 2, { x: 5.3 + d, y: 0, z: 0 }, 0, 500).kind;
    expect(at500(3.0)).toBe('accepted');
    expect(at500(3.1)).toBe('rejected');
  });

  it('enforces bounds', () => {
    const t = newTracker(origin, 0, 0);
    const kind = (loc: 'courtyard' | 'arena', p: { x: number; y: number; z: number }) =>
      checkMove(t, loc, 1, p, 0, 0).kind;
    expect(inBounds('courtyard', { x: 23, y: 0, z: 0 })).toBe(true);
    expect(kind('courtyard', { x: 23.01, y: 0, z: 0 })).toBe('rejected');
    expect(kind('arena', { x: 9.61, y: 0, z: 0 })).toBe('rejected');
    expect(kind('arena', { x: 0, y: 0, z: -7.71 })).toBe('rejected');
    for (const loc of ['courtyard', 'arena'] as const) {
      expect(kind(loc, { x: 0, y: 3.01, z: 0 })).toBe('rejected');
      expect(kind(loc, { x: 0, y: -0.01, z: 0 })).toBe('rejected');
      expect(kind(loc, { x: 0, y: 3, z: 0 })).toBe('accepted');
    }
  });

  it('ignores stale sequences and advances on rejection', () => {
    const t = accepted(checkMove(newTracker(origin, 0, 0), 'courtyard', 5, { x: 1, y: 0, z: 0 }, 0, 0));
    expect(checkMove(t, 'courtyard', 5, { x: 2, y: 0, z: 0 }, 0, 0)).toEqual({ kind: 'stale' });
    expect(checkMove(t, 'courtyard', 4, { x: 2, y: 0, z: 0 }, 0, 0)).toEqual({ kind: 'stale' });
    const r = checkMove(t, 'courtyard', 6, { x: 99, y: 0, z: 0 }, 0, 0);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') {
      expect(r.tracker.lastSequence).toBe(6);
      expect(r.tracker.position).toEqual(t.position);
    }
  });

  it('rejects when the barrier blocks without spending budget', () => {
    const t = newTracker(origin, 0, 0);
    const r = checkMove(t, 'courtyard', 1, { x: 1, y: 0, z: 0 }, 0, 0, () => true);
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.tracker.budget).toBeCloseTo(t.budget);
  });
});
