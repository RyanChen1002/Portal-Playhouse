import { describe, expect, it } from 'vitest';
import { COURTYARD_SPAWN, checkMove, newTracker, type MoveTracker } from '../../shared/world/index';
import { WALK_RADIUS, WALK_SPEED, createWalker } from './walker';

/** mulberry32: a small deterministic PRNG so the walks are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = 5_000;

/** Feeds the walk through the engine's movement check, advancing the clock by `gap(i)` ms per step. */
function rejectedSteps(rateHz: number, gap: (i: number) => number, seed: number): number {
  const walker = createWalker(COURTYARD_SPAWN, WALK_SPEED / rateHz, seeded(seed));
  let tracker: MoveTracker = newTracker(COURTYARD_SPAWN, 0, 0, 'courtyard');
  let now = 0;
  let rejected = 0;
  for (let i = 0; i < STEPS; i++) {
    now += gap(i);
    const step = walker.next();
    const r = checkMove(tracker, 'courtyard', i, step.position, step.rotation, now);
    if (r.kind !== 'accepted') rejected++;
    if (r.kind !== 'stale') tracker = r.tracker;
  }
  return rejected;
}

describe('createWalker', () => {
  it('every step is accepted by the engine at 10 Hz', () => {
    expect(rejectedSteps(10, () => 100, 1)).toBe(0);
  });

  it('every step is accepted with uneven 50/150 ms gaps at 20 Hz', () => {
    expect(rejectedSteps(20, (i) => (i % 2 === 0 ? 50 : 150), 2)).toBe(0);
  });

  it('stays within WALK_RADIUS', () => {
    const walker = createWalker(COURTYARD_SPAWN, WALK_SPEED / 10, seeded(3));
    for (let i = 0; i < STEPS; i++) {
      const { position } = walker.next();
      expect(Math.hypot(position.x, position.z)).toBeLessThanOrEqual(WALK_RADIUS);
    }
  });

  it('moves each step by stepLength on the ground', () => {
    const stepLength = WALK_SPEED / 10;
    const walker = createWalker(COURTYARD_SPAWN, stepLength, seeded(4));
    let prev = COURTYARD_SPAWN;
    for (let i = 0; i < 1_000; i++) {
      const { position } = walker.next();
      expect(Math.hypot(position.x - prev.x, position.z - prev.z)).toBeCloseTo(stepLength, 9);
      expect(position.y).toBe(0);
      prev = position;
    }
  });

  it('rotation is the heading of the step', () => {
    const walker = createWalker(COURTYARD_SPAWN, WALK_SPEED / 10, seeded(5));
    let prev = COURTYARD_SPAWN;
    for (let i = 0; i < 1_000; i++) {
      const { position, rotation } = walker.next();
      expect(rotation).toBeCloseTo(Math.atan2(position.x - prev.x, position.z - prev.z), 9);
      prev = position;
    }
  });
});
