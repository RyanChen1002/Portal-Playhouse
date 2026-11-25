import { describe, expect, it } from 'vitest';
import { admit, card, conn, ENTRANCE, join, leave, LOBBY_SPAWN, makeWorld, move, walk } from './test-helpers';
import { DEFAULT_WORLD_CONFIG, PORTAL_ROOM } from './config';
import type { Outgoing } from './world';

describe('lobby transcript', () => {
  it('lobby transcript is unchanged', () => {
    // The recorded transcript predates the workshop room; its board lists only the portal.
    const tw = makeWorld({ ...DEFAULT_WORLD_CONFIG, rooms: [PORTAL_ROOM] });
    const log: unknown[] = [];
    const record = (step: string) => {
      tw.world.advance();
      const out: Outgoing[] = tw.world.takeOutbox();
      log.push({
        step,
        out: out.map((o) => ({ to: o.to, message: o.message })),
        slotsUsed: tw.world.slotsUsed(),
        closings: tw.world.takeClosings(),
      });
    };
    const tick = () => tw.advanceBy(100);

    for (const n of [1, 2, 3]) {
      admit(tw, n);
      tick();
      record(`admit ${n}`);
    }
    walk(tw, 1, LOBBY_SPAWN, { x: 3, y: 0, z: 4 });
    record('walk 1 around the courtyard');
    walk(tw, 1, { x: 3, y: 0, z: 4 }, { x: 3, y: 0, z: 0 });
    record('walk 1 further');

    tick();
    move(tw, 1, { x: 20, y: 0, z: 0 });
    record('too-fast move');
    tick();
    move(tw, 1, { x: 23.5, y: 0, z: 0 });
    record('out-of-bounds move');
    tw.world.handle(conn(1), { type: 'player.move', payload: { sequence: 1, position: { x: 3, y: 0, z: 0 }, rotation: 0 } });
    record('stale sequence');
    tick();
    move(tw, 1, { x: 3, y: 3.5, z: 0 });
    record('y of 3.5');

    // Back to a known legal spot, then try to join from too far away.
    tick();
    move(tw, 1, { x: 3, y: 0, z: 0 });
    record('move back to a legal spot');
    join(tw, 1);
    record('join portal from too far away');

    walk(tw, 1, { x: 3, y: 0, z: 0 }, ENTRANCE);
    record('walk 1 to the entrance');
    join(tw, 1);
    record('join portal with 1');
    walk(tw, 2, LOBBY_SPAWN, ENTRANCE);
    record('walk 2 to the entrance');
    join(tw, 2);
    record('join portal with 2');
    walk(tw, 3, LOBBY_SPAWN, ENTRANCE);
    join(tw, 3);
    record('join portal with 3 (full room)');

    leave(tw, 1);
    record('1 leaves the room');
    walk(tw, 1, ENTRANCE, { x: 2, y: 0, z: 2 });
    record('walk 1 again');

    expect(tw.world.admit('c2b', card(2)).error).toBeNull();
    record('takeover of 2');

    tick();
    tw.world.connectionLost(conn(3));
    record('connection lost for 3');
    tw.advanceBy(1000);
    expect(tw.world.admit('c3b', card(3)).error).toBeNull();
    record('3 returns within grace');
    tw.world.handle('c3b', { type: 'world.leave', requestId: 'wl3', payload: {} });
    record('3 leaves the world');

    tw.advanceBy(600_000);
    record('idle expiry of 1');

    expect(log).toMatchSnapshot();
  });
});
