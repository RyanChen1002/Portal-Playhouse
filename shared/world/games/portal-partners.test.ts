import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { PORTAL_PARTNERS as M, setBack, type PPState } from './portal-partners';
import type { RoundView } from './types';

const v = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

function viewOf(a: Vec3, b: Vec3, connected: [boolean, boolean] = [true, true]): RoundView {
  const players = [
    { id: 'a', position: a, rotation: 0, connected: connected[0] },
    { id: 'b', position: b, rotation: 0, connected: connected[1] },
  ] as const;
  return {
    players,
    now: 0,
    startedAt: 0,
    player(id) {
      const p = players.find((x) => x.id === id);
      if (!p) throw new Error(`unknown player ${id}`);
      return p;
    },
  };
}

const fresh = (): PPState => M.start(viewOf(v(-3, 6), v(0, 6)));
const far = v(0, 6);

describe('Portal Partners module', () => {
  it('spawns at the configured points', () => {
    expect(M.spawns).toEqual([v(-3, 6), v(0, 6)]);
  });

  it('start gives a closed bridge and spawn lastOutside', () => {
    const s = fresh();
    expect(s.latched).toBe(false);
    expect(s.crystals).toEqual([false, false]);
    expect(s.open).toBe(false);
    expect(s.lastOutside.get('a')).toEqual(v(-3, 6));
    expect(s.lastOutside.get('b')).toEqual(v(0, 6));
  });

  it('bridge closed blocks the gap', () => {
    const s = fresh();
    expect(M.checkMove(s, viewOf(v(-3, 6), v(0, 6)), 'a', v(0, 2), v(0, 0))).toBe('reject');
  });

  it('plate opens the bridge, only within |x| <= 1.2', () => {
    const s = fresh();
    const view = viewOf(v(-5, 3), far);
    expect(M.view(s, view).bridgeOpen).toBe(true);
    expect(M.checkMove(s, view, 'b', v(0, 2), v(0, 0))).toBe('allow');
    expect(M.checkMove(s, view, 'b', v(3, 2), v(3, 0))).toBe('reject');
  });

  it('lever latches', () => {
    const s = fresh();
    expect(M.interact(s, viewOf(v(2, -2), far), 'a', 'lever')).toEqual({ ok: false, message: 'Move closer to interact.' });
    expect(s.latched).toBe(false);
    expect(M.interact(s, viewOf(v(2, -2.2), far), 'a', 'lever')).toEqual({ ok: true, effect: { stateChanged: true } });
    expect(s.latched).toBe(true);
    expect(s.open).toBe(true);
    expect(M.view(s, viewOf(far, far)).bridgeOpen).toBe(true);
    expect(M.afterMove!(s, viewOf(far, far), 'a')).toEqual({});
    expect(M.interact(s, viewOf(v(2, -2.2), far), 'a', 'lever')).toEqual({
      ok: false,
      message: 'The lever is already pulled.',
    });
  });

  it('crystals and score', () => {
    const s = fresh();
    const view = viewOf(v(-6, -5), v(6, -5));
    expect(M.interact(s, view, 'a', 'crystal-a').ok).toBe(true);
    expect(M.interact(s, view, 'b', 'crystal-b').ok).toBe(true);
    expect(M.score(s)).toBe(2);
    expect(M.interact(s, view, 'a', 'crystal-a')).toEqual({ ok: false, message: 'That crystal is already collected.' });
  });

  it('exit needs crystals, both players within 2.3, and both connected', () => {
    const s = fresh();
    const atExit = viewOf(v(0, -7), v(1, -7));
    expect(M.interact(s, atExit, 'a', 'exit')).toEqual({ ok: false, message: 'Collect both crystals first.' });
    s.crystals = [true, true];
    expect(M.interact(s, viewOf(v(0, -7), v(0, -2)), 'a', 'exit')).toEqual({
      ok: false,
      message: 'Both players must be at the exit.',
    });
    expect(M.interact(s, viewOf(v(0, -7), v(1, -7), [true, false]), 'a', 'exit')).toEqual({
      ok: false,
      message: 'Both players must be connected.',
    });
    expect(M.interact(s, atExit, 'a', 'exit')).toEqual({ ok: true, effect: { end: 'win' } });
  });

  it('setBack', () => {
    expect(setBack(v(0.5, 0.3), v(0, 2))).toEqual(v(0.5, 1.35));
    expect(setBack(v(0.5, 0.3), v(0, -2))).toEqual(v(0.5, -1.35));
  });

  it('afterMove returns bridgeClosed overrides for players in the gap when the plate is left', () => {
    const s = fresh();
    expect(M.afterMove!(s, viewOf(v(-5, 3), v(0, 0)), 'a')).toEqual({ stateChanged: true });
    expect(s.open).toBe(true);
    const effect = M.afterMove!(s, viewOf(v(-5, 6), v(0, 0)), 'a');
    expect(s.lastOutside.get('b')!.z).toBeGreaterThan(0);
    expect(effect).toEqual({
      overrides: [{ playerId: 'b', position: v(0, 1.35), reason: 'bridgeClosed' }],
      stateChanged: true,
    });
    expect(s.open).toBe(false);
  });

  it('afterMove with no bridge change returns no effect', () => {
    const s = fresh();
    expect(M.afterMove!(s, viewOf(v(-3, 5), far), 'a')).toEqual({});
    expect(s.lastOutside.get('a')).toEqual(v(-3, 5));
  });

  it('view reports latched, crystals, and plate state', () => {
    const s = fresh();
    expect(M.view(s, viewOf(far, far))).toEqual({ bridgeOpen: false, latched: false, crystals: [false, false] });
  });
});
