import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../contracts';
import {
  arenaBarrier,
  bridgeOpen,
  interact,
  score,
  setBack,
  spawnPositions,
  startRound,
  timeUp,
} from './portal-partners';

const v = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });
const conn = (a = true, b = true) =>
  new Map([
    ['a', a],
    ['b', b],
  ]);

function pos(a: Vec3, b: Vec3) {
  return new Map([
    ['a', a],
    ['b', b],
  ]);
}

describe('Portal Partners rules', () => {
  it('spawns at the configured points', () => {
    expect(spawnPositions()).toEqual([v(-3, 6), v(0, 6)]);
  });

  it('bridge closed blocks the gap', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const barrier = arenaBarrier(r, [v(-3, 6), v(0, 6)]);
    expect(barrier(v(0, 2), v(0, 0))).toBe(true);
  });

  it('plate opens the bridge, only within |x| <= 1.2', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const barrier = arenaBarrier(r, [v(-5, 3), v(0, 6)]);
    expect(bridgeOpen(r, [v(-5, 3)])).toBe(true);
    expect(barrier(v(0, 2), v(0, 0))).toBe(false);
    expect(barrier(v(3, 2), v(3, 0))).toBe(true);
  });

  it('lever latches', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const far = v(0, 6);
    expect(interact(r, 'a', 'x1', 'lever', pos(v(2, -2), far), conn())).toMatchObject({
      ok: false,
      code: 'INVALID_ACTION',
    });
    expect(r.latched).toBe(false);
    expect(interact(r, 'a', 'x2', 'lever', pos(v(2, -2.2), far), conn())).toEqual({ ok: true });
    expect(r.latched).toBe(true);
    expect(bridgeOpen(r, [far])).toBe(true);
    expect(interact(r, 'a', 'x3', 'lever', pos(v(2, -2.2), far), conn())).toMatchObject({
      ok: false,
      code: 'INVALID_ACTION',
    });
  });

  it('crystals and score', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const p = pos(v(-6, -5), v(6, -5));
    expect(interact(r, 'a', '1', 'crystal-a', p, conn()).ok).toBe(true);
    expect(interact(r, 'b', '2', 'crystal-b', p, conn()).ok).toBe(true);
    expect(score(r)).toBe(2);
    expect(interact(r, 'a', '3', 'crystal-a', p, conn())).toMatchObject({
      ok: false,
      code: 'INVALID_ACTION',
    });
  });

  it('exit needs crystals, both players within 2.3, and both connected', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const atExit = pos(v(0, -7), v(1, -7));
    expect(interact(r, 'a', 'e1', 'exit', atExit, conn())).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    r.crystals = [true, true];
    expect(interact(r, 'a', 'e2', 'exit', pos(v(0, -7), v(0, -2)), conn())).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    expect(interact(r, 'a', 'e3', 'exit', atExit, conn(true, false))).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    expect(r.ended).toBe(false);
    const res = interact(r, 'a', 'e4', 'exit', atExit, conn());
    expect(res).toEqual({ ok: true, won: true });
    expect(r.ended).toBe(true);
  });

  it('NOT_IN_GAME after the round ends or for non-participants', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const p = pos(v(-6, -5), v(6, -5));
    expect(interact(r, 'z', '1', 'crystal-a', p, conn())).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    r.ended = true;
    expect(interact(r, 'a', '2', 'crystal-a', p, conn())).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
  });

  it('duplicate actionId returns the first result and has no effect', () => {
    const r = startRound('s', ['a', 'b'], 0);
    const p = pos(v(-6, -5), v(6, -5));
    const first = interact(r, 'a', 'dup', 'crystal-a', p, conn());
    expect(first.ok).toBe(true);
    r.crystals = [false, false];
    expect(interact(r, 'a', 'dup', 'crystal-a', p, conn())).toEqual(first);
    expect(score(r)).toBe(0);
    const fail = interact(r, 'a', 'dupf', 'lever', p, conn());
    expect(fail.ok).toBe(false);
    expect(interact(r, 'a', 'dupf', 'crystal-a', p, conn())).toEqual(fail);
  });

  it('setBack', () => {
    expect(setBack(v(0.5, 0.3), v(0, 2))).toEqual(v(0.5, 1.35));
    expect(setBack(v(0.5, 0.3), v(0, -2))).toEqual(v(0.5, -1.35));
  });

  it('timeUp at exactly 180 s', () => {
    const r = startRound('s', ['a', 'b'], 1000);
    expect(timeUp(r, 180_999, 180_000)).toBe(false);
    expect(timeUp(r, 181_000, 180_000)).toBe(true);
  });
});
