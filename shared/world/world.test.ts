import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts';
import { DEFAULT_WORLD_CONFIG } from './config';
import {
  admit,
  admitAll,
  boards,
  card,
  conn,
  ENTRANCE,
  errorCode,
  join,
  lastReply,
  leave,
  makeWorld,
  move,
  only,
  ready,
  setup,
  walk,
} from './test-helpers';

describe('World', () => {
  it('admits 16 and rejects the 17th with WORLD_FULL', () => {
    const tw = makeWorld();
    admitAll(tw, 16);
    tw.clear();
    const r = admit(tw, 17);
    expect(r.error?.code).toBe('WORLD_FULL');
    expect(tw.world.slotsUsed()).toBe(16);
    for (let n = 1; n <= 17; n++) expect(tw.messagesFor(conn(n))).toEqual([]);
    expect(tw.world.takeClosings()).toEqual([]);
  });

  it('admission sends world.snapshot', () => {
    const tw = makeWorld();
    admit(tw, 1);
    tw.clear();
    expect(admit(tw, 2)).toEqual({ data: null, error: null });

    const [snap, ...rest] = tw.messagesFor(conn(2));
    expect(rest).toEqual([]);
    if (snap?.type !== 'world.snapshot') throw new Error('expected world.snapshot');
    const s = snap.payload;
    expect(s.self).toEqual({ playerId: 'p2', roomId: 'lobby', position: { x: 0, y: 0, z: 4 }, rotation: 0 });
    expect(s.room.roomId).toBe('lobby');
    expect(s.room.summary).toBeNull();
    expect(s.room.session).toBeNull();
    expect(s.room.players.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(s.room.players.find((p) => p.id === 'p2')).toMatchObject({ connected: true, ready: false });
    expect(s.board.map((b) => b.id)).toEqual(DEFAULT_WORLD_CONFIG.rooms.map((r) => r.id));
    expect(s.lastFinished).toBeNull();

    const joined = tw.messagesFor(conn(1));
    expect(joined).toHaveLength(1);
    const j = joined[0];
    if (j?.type !== 'player.joined') throw new Error('expected player.joined');
    expect(j.payload.player).toMatchObject({ id: 'p2', position: { x: 0, y: 0, z: 4 }, connected: true });
    expect(j.payload.revision).toBe(s.room.revision);
  });

  it('join checks in order', () => {
    const tw = setup(3, [1, 2]);
    // Player 3 walks to the entrance; player 1 is in the room already.
    walk(tw, 3, { x: 0, y: 0, z: 4 }, { x: ENTRANCE.x + 3.3, y: 0, z: 0 });
    tw.clear();

    const expectNothingElse = () => {
      for (const n of [1, 2]) expect(tw.messagesFor(conn(n))).toEqual([]);
    };

    join(tw, 3, 'nowhere');
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('ROOM_NOT_FOUND');
    expectNothingElse();

    join(tw, 1);
    expect(errorCode(tw.messagesFor(conn(1)))).toBe('INVALID_ACTION');
    expectNothingElse();

    // 3.3 from the entrance: too far.
    join(tw, 3);
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('INVALID_ACTION');
    expectNothingElse();

    tw.advanceBy(1000);
    move(tw, 3, { x: ENTRANCE.x + 3.0, y: 0, z: 0 });
    ready(tw, 1);
    ready(tw, 2);
    tw.clear();
    join(tw, 3);
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('ROOM_LOCKED');
    expectNothingElse();

    // The round times out; the room is waiting again with both players inside.
    tw.advanceBy(180_000);
    tw.world.advance();
    tw.clear();
    join(tw, 3);
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('ROOM_FULL');
    expectNothingElse();

    // Player 3 is still in the lobby where they were, and can still move from there.
    tw.advanceBy(100);
    move(tw, 3, { x: ENTRANCE.x + 2.8, y: 0, z: 0 });
    expect(only(tw.messagesFor(conn(3)), 'player.corrected')).toEqual([]);
    // Players in the room never see lobby movement.
    expectNothingElse();
  });

  it('join and leave keep the slot', () => {
    const tw = setup(2);
    walk(tw, 1, { x: 0, y: 0, z: 4 }, ENTRANCE);
    tw.clear();

    join(tw, 1);
    expect(tw.world.slotsUsed()).toBe(2);
    const reply = lastReply(tw.messagesFor(conn(1)));
    if (reply?.type !== 'request.accepted') throw new Error('expected request.accepted');
    expect(reply.requestId).toBe('j1');
    const room = reply.payload as RoomSnapshot;
    expect(room.roomId).toBe('portal');
    expect(room.summary?.players.map((p) => p.id)).toEqual(['p1']);
    expect(room.players).toEqual([
      { ...card(1), position: null, rotation: 0, connected: true, ready: false },
    ]);

    const seenByLobby1 = tw.messagesFor(conn(2)).filter((m) => m.type !== 'room.updated');
    expect(seenByLobby1).toHaveLength(1);
    expect(seenByLobby1[0]).toMatchObject({ type: 'player.left', payload: { playerId: 'p1', reason: 'moved' } });

    leave(tw, 1);
    expect(tw.world.slotsUsed()).toBe(2);
    const back = lastReply(tw.messagesFor(conn(1)));
    if (back?.type !== 'request.accepted') throw new Error('expected request.accepted');
    const lobby = back.payload as RoomSnapshot;
    expect(lobby.roomId).toBe('lobby');
    expect(lobby.summary).toBeNull();
    expect(lobby.players.find((p) => p.id === 'p1')?.position).toEqual(ENTRANCE);

    const seenByLobby2 = tw.messagesFor(conn(2)).filter((m) => m.type !== 'room.updated');
    expect(seenByLobby2).toHaveLength(1);
    expect(seenByLobby2[0]).toMatchObject({
      type: 'player.joined',
      payload: { player: { id: 'p1', position: ENTRANCE } },
    });

    // Player 1 moves on from the entrance with a fresh tracker.
    tw.advanceBy(100);
    move(tw, 1, { x: ENTRANCE.x + 0.4, y: 0, z: 0 });
    expect(only(tw.messagesFor(conn(1)), 'player.corrected')).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.updated')).toHaveLength(1);
  });

  it('board', () => {
    const tw = setup(3);
    walk(tw, 1, { x: 0, y: 0, z: 4 }, ENTRANCE);
    walk(tw, 2, { x: 0, y: 0, z: 4 }, ENTRANCE);
    tw.clear();

    join(tw, 1);
    for (const n of [1, 2, 3]) {
      const b = boards(tw.messagesFor(conn(n)));
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({
        id: 'portal',
        name: 'Portal Partners',
        gameType: 'portal-partners',
        minPlayers: 2,
        maxPlayers: 2,
        status: 'waiting',
        players: [card(1)],
        sessionId: null,
        startedAt: null,
        durationSeconds: 180,
        score: null,
      });
      expect(Object.keys(b[0]!.players[0]!).sort()).toEqual(['avatarId', 'displayName', 'id']);
    }

    join(tw, 2);
    const afterJoin = boards(tw.messagesFor(conn(3)));
    expect(afterJoin).toHaveLength(1);
    expect(afterJoin[0]!.players).toEqual([card(1), card(2)]);
    tw.clear();

    // Readiness that does not change status sends no board update.
    ready(tw, 1);
    for (const n of [1, 2, 3]) expect(boards(tw.messagesFor(conn(n)))).toEqual([]);

    leave(tw, 2);
    for (const n of [1, 2, 3]) {
      const b = boards(tw.messagesFor(conn(n)));
      expect(b).toHaveLength(1);
      expect(b[0]!.players).toEqual([card(1)]);
      expect(b[0]!.revision).toBeGreaterThan(afterJoin[0]!.revision);
    }
  });

  it('movement routing', () => {
    const tw = setup(4, [3, 4]);

    tw.advanceBy(100);
    const s1 = move(tw, 1, { x: 0.4, y: 0, z: 4 }, 1.5);
    expect(tw.messagesFor(conn(1))).toEqual([]);
    const seen = tw.messagesFor(conn(2));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'player.updated',
      payload: { playerId: 'p1', position: { x: 0.4, y: 0, z: 4 }, rotation: 1.5, sequence: s1 },
    });
    for (const n of [3, 4]) expect(tw.messagesFor(conn(n))).toEqual([]);

    // A teleport is rejected and corrected to the last accepted position.
    tw.advanceBy(100);
    const s2 = move(tw, 1, { x: 15, y: 0, z: 4 }, 0);
    expect(tw.messagesFor(conn(1))).toEqual([
      {
        type: 'player.corrected',
        payload: { sequence: s2, position: { x: 0.4, y: 0, z: 4 }, rotation: 1.5, reason: 'rejected' },
      },
    ]);
    expect(tw.messagesFor(conn(2))).toEqual([]);

    // A move in a waiting room changes nothing and is not relayed.
    tw.advanceBy(100);
    move(tw, 3, { x: -3, y: 0, z: 6 });
    for (const n of [1, 2, 3, 4]) expect(tw.messagesFor(conn(n))).toEqual([]);
    leave(tw, 4);
    tw.clear();
    join(tw, 4);
    const snap = lastReply(tw.messagesFor(conn(4)));
    if (snap?.type !== 'request.accepted') throw new Error('expected request.accepted');
    expect((snap.payload as RoomSnapshot).players.find((p) => p.id === 'p3')?.position).toBeNull();
  });

  it('readiness', () => {
    const tw = setup(3, [1, 2]);

    ready(tw, 3);
    expect(errorCode(tw.messagesFor(conn(3)))).toBe('GAME_NOT_READY');

    ready(tw, 1);
    const reply = tw.messagesFor(conn(1));
    expect(lastReply(reply)).toEqual({ type: 'request.accepted', requestId: 'r1', payload: null });
    // player.ready goes to the whole room, sender included, with the same revision.
    const own = only(reply, 'player.ready');
    expect(own).toHaveLength(1);
    expect(own[0]!.payload).toMatchObject({ playerId: 'p1', ready: true });
    const seen = only(tw.messagesFor(conn(2)), 'player.ready');
    expect(seen).toEqual(own);
    expect(tw.messagesFor(conn(3))).toEqual([]);

    // Someone leaves: readiness resets for everyone in the room and is announced after the leave.
    leave(tw, 2);
    const afterLeave = tw.messagesFor(conn(1)).filter((m) => m.type !== 'room.updated');
    expect(afterLeave.map((m) => m.type)).toEqual(['player.left', 'player.ready']);
    const left = only(afterLeave, 'player.left')[0]!;
    expect(only(afterLeave, 'player.ready')[0]!.payload).toEqual({
      playerId: 'p1',
      ready: false,
      revision: left.payload.revision,
    });
    // The leaver's own flag was already false, so nothing is announced for them.
    expect(only(tw.messagesFor(conn(2)), 'player.ready')).toEqual([]);
    tw.world.admit('c1b', card(1));
    const fresh = tw.messagesFor('c1b')[0];
    if (fresh?.type !== 'world.snapshot') throw new Error('expected world.snapshot');
    expect(fresh.payload.room.players.map((p) => p.ready)).toEqual([false]);

    // Someone joins: readiness resets too.
    tw.world.handle('c1b', { type: 'game.ready', requestId: 'r1b', payload: { ready: true } });
    tw.clear();
    tw.advanceBy(100);
    join(tw, 2);
    const joinerMsgs = tw.messagesFor(conn(2));
    const snap = lastReply(joinerMsgs);
    if (snap?.type !== 'request.accepted') throw new Error('expected request.accepted');
    const roomSnap = snap.payload as RoomSnapshot;
    expect(roomSnap.players.map((p) => p.ready)).toEqual([false, false]);
    const resetEvent = { type: 'player.ready', payload: { playerId: 'p1', ready: false, revision: roomSnap.revision } };
    expect(only(joinerMsgs, 'player.ready')).toEqual([resetEvent]);
    const stayer = tw.messagesFor('c1b').filter((m) => m.type !== 'room.updated');
    expect(stayer.map((m) => m.type)).toEqual(['player.joined', 'player.ready']);
    expect(stayer[1]).toEqual(resetEvent);

    // Nobody is ready now: a leave resets nothing and announces nothing.
    leave(tw, 2);
    expect(only(tw.messagesFor('c1b'), 'player.ready')).toEqual([]);

    // Outside a waiting room again after leaving.
    ready(tw, 2);
    expect(errorCode(tw.messagesFor(conn(2)))).toBe('GAME_NOT_READY');
  });

  it('world.leave frees the slot at once', () => {
    const tw = setup(16, [1, 2]);
    ready(tw, 2);
    tw.clear();
    tw.world.handle(conn(1), { type: 'world.leave', requestId: 'w1', payload: {} });

    expect(tw.messagesFor(conn(1))).toEqual([{ type: 'request.accepted', requestId: 'w1', payload: null }]);
    expect(tw.world.takeClosings()).toEqual([{ conn: conn(1), reason: 'left' }]);
    expect(tw.world.slotsUsed()).toBe(15);

    const roommate = tw.messagesFor(conn(2));
    const leftEvt = only(roommate, 'player.left')[0]!;
    expect(leftEvt.payload).toMatchObject({ playerId: 'p1', reason: 'left' });
    expect(only(roommate, 'player.ready').map((m) => m.payload)).toEqual([
      { playerId: 'p2', ready: false, revision: leftEvt.payload.revision },
    ]);
    expect(boards(roommate)[0]!.players).toEqual([card(2)]);
    const lobby = tw.messagesFor(conn(3));
    expect(only(lobby, 'player.left')).toEqual([]);
    expect(boards(lobby)).toHaveLength(1);

    expect(admit(tw, 17).error).toBeNull();
    expect(tw.world.slotsUsed()).toBe(16);

    // The old connection is forgotten.
    tw.clear();
    tw.advanceBy(100);
    move(tw, 1, { x: 0, y: 0, z: 4.1 });
    for (const n of [1, 2, 3]) expect(tw.messagesFor(conn(n))).toEqual([]);
  });

  it('takeover', () => {
    const tw = setup(2);
    walk(tw, 1, { x: 0, y: 0, z: 4 }, { x: 2, y: 0, z: 4 });
    tw.advanceBy(100);
    move(tw, 1, { x: 2, y: 0, z: 4 }, 0.7);
    tw.clear();

    expect(tw.world.admit('c1b', card(1))).toEqual({ data: null, error: null });
    expect(tw.messagesFor(conn(1))).toEqual([{ type: 'session.replaced', payload: {} }]);
    expect(tw.world.takeClosings()).toEqual([{ conn: conn(1), reason: 'session.replaced' }]);
    expect(tw.world.slotsUsed()).toBe(2);

    const [snap, ...rest] = tw.messagesFor('c1b');
    expect(rest).toEqual([]);
    if (snap?.type !== 'world.snapshot') throw new Error('expected world.snapshot');
    expect(snap.payload.self).toEqual({ playerId: 'p1', roomId: 'lobby', position: { x: 2, y: 0, z: 4 }, rotation: 0.7 });
    expect(tw.messagesFor(conn(2))).toEqual([]);

    // The old connection is ignored; the new one moves on from the kept position.
    tw.advanceBy(100);
    tw.world.handle(conn(1), { type: 'player.move', payload: { sequence: 999, position: { x: 2.4, y: 0, z: 4 }, rotation: 0 } });
    expect(tw.messagesFor(conn(2))).toEqual([]);
    tw.world.handle('c1b', { type: 'player.move', payload: { sequence: 1, position: { x: 2.4, y: 0, z: 4 }, rotation: 0 } });
    expect(tw.messagesFor('c1b')).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.updated')).toHaveLength(1);
  });

  it('takeover inside a room keeps the room', () => {
    const tw = setup(2, [1]);
    tw.world.admit('c1b', card(1));
    const snap = tw.messagesFor('c1b')[0];
    if (snap?.type !== 'world.snapshot') throw new Error('expected world.snapshot');
    expect(snap.payload.self.roomId).toBe('portal');
    expect(snap.payload.self.position).toBeNull();
    expect(snap.payload.room.summary?.players).toEqual([card(1)]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
  });

  it('ignores unknown connections and reports timer need', () => {
    const tw = makeWorld();
    expect(tw.world.needsTimer()).toBe(false);
    tw.world.handle('ghost', { type: 'room.join', requestId: 'x', payload: { roomId: 'portal' } });
    expect(tw.messagesFor('ghost')).toEqual([]);
    admit(tw, 1);
    expect(tw.world.needsTimer()).toBe(true);
  });
});
