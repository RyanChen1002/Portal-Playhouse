import { describe, expect, it } from 'vitest';
import type { GameType, Vec3 } from '../../contracts';
import { POWER_UP_WORKSHOP_TARGETS } from '../../contracts';
import { POWER_UP_WORKSHOP as M, type PUWState } from './power-up-workshop';
import type { InteractOutcome, RoundView } from './types';

const v = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });
const POINTS: Record<string, [number, number]> = {
  'gear-0': [-6, -5], 'gear-1': [0, -5], 'gear-2': [6, -5],
  'socket-0': [-6, -2], 'socket-1': [0, -2], 'socket-2': [6, -2],
  'cable-0': [-6, 1], 'cable-1': [0, 1], 'cable-2': [6, 1],
  'power-right': [4, 5],
};
const LEFT_PAD: [number, number] = [-4, 5];

function viewAt(a: Vec3, b: Vec3, opts: { connectedB?: boolean } = {}): RoundView {
  const players = [
    { id: 'a', position: a, rotation: 0, connected: true },
    { id: 'b', position: b, rotation: 0, connected: opts.connectedB ?? true },
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

const at = (target: string, dx = 0): Vec3 => v(POINTS[target]![0] + dx, POINTS[target]![1]);
const near = (target: string): RoundView => viewAt(at(target), v(0, 6));
const fresh = (level = 0): PUWState => M.start(viewAt(v(-3, 6), v(0, 6)), level);
const ok = (o: InteractOutcome) => {
  expect(o).toEqual({ ok: true, effect: { stateChanged: true } });
};
const msg = (o: InteractOutcome): string => {
  if (o.ok) throw new Error('expected rejection');
  return o.message;
};

describe('Power-Up Workshop module', () => {
  it('has the configured static values', () => {
    expect(M.gameType).toBe('power-up-workshop' as GameType);
    expect(M.name).toBe('Power-Up Workshop');
    expect(M.roundMs).toBe(180_000);
    expect(M.arena).toEqual({ halfX: 9.6, halfZ: 7.7, speed: 4 });
    expect(M.spawns).toEqual([v(-3, 6), v(0, 6)]);
    expect(M.scoreMax).toBe(6);
    expect(M.correctionReasons).toEqual([]);
    expect(M.disconnect).toEqual({ duringGrace: 'keepRunning', onExpiry: 'cancel' });
    expect(M.targets).toEqual(POWER_UP_WORKSHOP_TARGETS);
    expect(M.checkMove(fresh(), viewAt(v(0, 0), v(1, 1)), 'a', v(0, 0), v(3, 3))).toBe('allow');
  });

  it('start rotates the level and uses the design table', () => {
    const table = [
      [[1, 2, 3], [0, 1, 2]],
      [[2, 3, 1], [0, 1, 2]],
      [[3, 1, 2], [1, 2, 0]],
      [[1, 3, 2], [2, 0, 1]],
      [[3, 2, 1], [2, 1, 0]],
    ];
    table.forEach(([targets, cables], i) => {
      const s = fresh(i);
      expect(s.level).toBe(i + 1);
      expect(s.gears).toEqual([0, 0, 0]);
      expect(s.gearTargets).toEqual(targets);
      expect(s.socketCables).toEqual(cables);
      expect(s.sockets).toEqual([false, false, false]);
      expect(s.mistakes).toBe(0);
    });
    expect(fresh(5).level).toBe(1);
    expect(fresh(7).level).toBe(3);
  });

  it.each(POWER_UP_WORKSHOP_TARGETS)('%s out of range by 2.0 is rejected; the edge is in range', (target) => {
    const s = fresh();
    const far = viewAt(at(target, 2.0), v(0, 6));
    expect(msg(M.interact(s, far, 'a', target))).toBe('Move closer to interact.');
    if (target === 'power-right') return;
    // 1.9 is exact only when the point's x is 0; elsewhere float rounding would push 1.9 just over.
    const edge = viewAt(at(target, POINTS[target]![0] === 0 ? 1.9 : 1.89), v(0, 6));
    const r = M.interact(s, edge, 'a', target);
    expect(!r.ok && r.message === 'Move closer to interact.').toBe(false);
  });

  it('rejects an unknown target', () => {
    expect(msg(M.interact(fresh(), near('gear-0'), 'a', 'power-left'))).toBe('Move closer to interact.');
  });

  it('gear turns 0,1,2,3,0 and a turn past a match lowers the score', () => {
    const s = fresh(); // level 1 targets 1,2,3
    const view = near('gear-0');
    for (const expected of [1, 2, 3, 0]) {
      ok(M.interact(s, view, 'a', 'gear-0'));
      expect(s.gears[0]).toBe(expected);
    }
    ok(M.interact(s, view, 'a', 'gear-0'));
    expect(M.score(s)).toBe(1);
    ok(M.interact(s, view, 'a', 'gear-0'));
    expect(s.gears[0]).toBe(2);
    expect(M.score(s)).toBe(0);
  });

  it('cable pickup and its rejections', () => {
    const s = fresh();
    ok(M.interact(s, near('cable-0'), 'a', 'cable-0'));
    expect(s.held.get('a')).toBe(0);
    expect(msg(M.interact(s, near('cable-1'), 'a', 'cable-1'))).toBe('Plug in the cable you are holding first.');
    expect(msg(M.interact(s, viewAt(v(0, 6), at('cable-0')), 'b', 'cable-0'))).toBe('Your teammate has that cable.');
    expect(s.held.has('b')).toBe(false);
    s.sockets[s.socketCables.indexOf(1)] = true;
    expect(msg(M.interact(s, viewAt(v(0, 6), at('cable-1')), 'b', 'cable-1'))).toBe('That cable is already plugged in.');
  });

  it('two players asking for the same cable: first gets it, second is told', () => {
    const s = fresh();
    const view = viewAt(at('cable-2'), at('cable-2'));
    ok(M.interact(s, view, 'a', 'cable-2'));
    expect(msg(M.interact(s, view, 'b', 'cable-2'))).toBe('Your teammate has that cable.');
    expect(s.held.get('a')).toBe(2);
    expect(s.held.has('b')).toBe(false);
  });

  it('socket handling', () => {
    const s = fresh(2); // level 3: sockets need B, C, A
    const sock = near('socket-0');
    expect(msg(M.interact(s, sock, 'a', 'socket-0'))).toBe('Bring a cable to this socket.');
    s.held.set('a', 0); // cable A, socket-0 needs B
    expect(msg(M.interact(s, sock, 'a', 'socket-0'))).toBe('This socket needs cable B.');
    expect(s.mistakes).toBe(1);
    expect(s.held.get('a')).toBe(0);
    expect(s.sockets[0]).toBe(false);
    expect(msg(M.interact(s, near('socket-1'), 'a', 'socket-1'))).toBe('This socket needs cable C.');
    s.held.set('a', 1);
    ok(M.interact(s, sock, 'a', 'socket-0'));
    expect(s.sockets[0]).toBe(true);
    expect(s.held.has('a')).toBe(false);
    expect(M.score(s)).toBe(1);
    s.held.set('a', 1);
    expect(msg(M.interact(s, sock, 'a', 'socket-0'))).toBe('That socket is already connected.');
  });

  describe('power-right', () => {
    const MSG = 'Match the gears and cables, then hold both power stations.';
    const solved = (): PUWState => {
      const s = fresh();
      s.gears = [...s.gearTargets];
      s.sockets = [true, true, true];
      return s;
    };
    const pads = (b: Vec3, opts?: { connectedB?: boolean }) => viewAt(at('power-right'), b, opts);

    it('is rejected for each missing condition', () => {
      const gearOff = solved();
      gearOff.gears[1] = 0;
      expect(msg(M.interact(gearOff, pads(v(...LEFT_PAD)), 'a', 'power-right'))).toBe(MSG);
      const socketEmpty = solved();
      socketEmpty.sockets[2] = false;
      expect(msg(M.interact(socketEmpty, pads(v(...LEFT_PAD)), 'a', 'power-right'))).toBe(MSG);
      expect(msg(M.interact(solved(), pads(v(LEFT_PAD[0] + 2.0, LEFT_PAD[1])), 'a', 'power-right'))).toBe(MSG);
      expect(msg(M.interact(solved(), pads(v(...LEFT_PAD), { connectedB: false }), 'a', 'power-right'))).toBe(MSG);
    });

    it('wins when everything holds, with score 6', () => {
      const s = solved();
      expect(M.interact(s, pads(v(LEFT_PAD[0] + 1.9, LEFT_PAD[1])), 'a', 'power-right')).toEqual({
        ok: true,
        effect: { end: 'win' },
      });
      expect(M.score(s)).toBe(6);
    });

    it('works when player b is the activator', () => {
      const view = viewAt(v(...LEFT_PAD), at('power-right'));
      expect(M.interact(solved(), view, 'b', 'power-right')).toEqual({ ok: true, effect: { end: 'win' } });
    });
  });

  describe('onConnection', () => {
    it('returns a held cable to its rack on disconnect', () => {
      const s = fresh();
      s.held.set('a', 1);
      expect(M.onConnection!(s, viewAt(v(0, 0), v(0, 0)), 'a', false)).toEqual({ stateChanged: true });
      expect(s.held.has('a')).toBe(false);
    });
    it('does nothing when empty-handed or on return', () => {
      const s = fresh();
      expect(M.onConnection!(s, viewAt(v(0, 0), v(0, 0)), 'a', false)).toEqual({});
      s.held.set('a', 1);
      expect(M.onConnection!(s, viewAt(v(0, 0), v(0, 0)), 'a', true)).toEqual({});
      expect(s.held.get('a')).toBe(1);
    });
  });

  it('view matches the wire fields and orders held by join order', () => {
    const s = fresh(3);
    s.gears = [1, 0, 2];
    s.sockets = [true, false, false];
    s.mistakes = 2;
    s.held.set('b', 2);
    expect(M.view(s, viewAt(v(0, 0), v(0, 0)))).toEqual({
      level: 4,
      gears: [1, 0, 2],
      gearTargets: [1, 3, 2],
      sockets: [true, false, false],
      socketCables: [2, 0, 1],
      held: [null, 2],
      mistakes: 2,
    });
  });

  it('every successful interact flags stateChanged', () => {
    const s = fresh(); // level 1: socket-0 needs A
    ok(M.interact(s, near('gear-1'), 'a', 'gear-1'));
    ok(M.interact(s, near('cable-0'), 'a', 'cable-0'));
    ok(M.interact(s, near('socket-0'), 'a', 'socket-0'));
  });
});
