import { describe, expect, it } from 'vitest';
import type { CorrectionReason } from '../contracts';
import { admit, boards, card, conn, interact, move, only } from './test-helpers';
import { testWorld } from './test-game';

const PUSHED = 'pushed' as CorrectionReason;
const SPAWN_1 = { x: -1, y: 0, z: 0 };
const SPAWN_2 = { x: 1, y: 0, z: 0 };

describe('game module hooks', () => {
  it('checkMove reject sends player.corrected rejected', () => {
    const { tw, state } = testWorld();
    state.verdict = 'reject';
    tw.advanceBy(100);
    const seq = move(tw, 1, { x: -0.6, y: 0, z: 0 });
    expect(tw.messagesFor(conn(1))).toEqual([
      { type: 'player.corrected', payload: { sequence: seq, position: SPAWN_1, rotation: 0, reason: 'rejected' } },
    ]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
    expect(state.calls.checkMove).toEqual(['p1']);
  });

  it('checkMove ignore drops the move without a reply', () => {
    const { tw, state } = testWorld();
    state.verdict = 'ignore';
    tw.advanceBy(100);
    move(tw, 1, { x: -0.6, y: 0, z: 0 });
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
    // The partner's next snapshot (a takeover) still shows player 1 at the spawn.
    expect(tw.world.admit('c2b', card(2)).error).toBeNull();
    const snap = only(tw.messagesFor('c2b'), 'world.snapshot')[0]!;
    expect(snap.payload.room.players.find((p) => p.id === 'p1')?.position).toEqual(SPAWN_1);
  });

  it('speed hook changes the movement budget', () => {
    const { tw, state } = testWorld();
    state.speed = 1;
    tw.advanceBy(100);
    const s1 = move(tw, 1, { x: 0.6, y: 0, z: 0 }); // 1.6 units
    expect(only(tw.messagesFor(conn(1)), 'player.corrected')).toEqual([
      { type: 'player.corrected', payload: { sequence: s1, position: SPAWN_1, rotation: 0, reason: 'rejected' } },
    ]);
    tw.advanceBy(100);
    move(tw, 1, { x: 0.4, y: 0, z: 0 }); // 1.4 units
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.updated').map((m) => m.payload.position)).toEqual([{ x: 0.4, y: 0, z: 0 }]);
  });

  it('a bad speed falls back to the arena speed and is reported', () => {
    const { tw, state, errors } = testWorld();
    state.speed = NaN;
    tw.advanceBy(100);
    const s1 = move(tw, 1, { x: 4, y: 0, z: 0 }); // 5 units: over arena.speed + 0.5
    expect(only(tw.messagesFor(conn(1)), 'player.corrected')).toEqual([
      { type: 'player.corrected', payload: { sequence: s1, position: SPAWN_1, rotation: 0, reason: 'rejected' } },
    ]);
    tw.advanceBy(100);
    move(tw, 1, { x: 4, y: 0, z: 0.1 }); // still NaN, over 4.5 units: rejected again, reported only once
    expect(only(tw.messagesFor(conn(1)), 'player.corrected').map((m) => m.payload.reason)).toEqual(['rejected']);
    expect(errors).toHaveLength(1);

    state.speed = 2;
    tw.advanceBy(100);
    move(tw, 1, { x: -0.6, y: 0, z: 0 });
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(only(tw.messagesFor(conn(2)), 'player.updated').map((m) => m.payload.position)).toEqual([{ x: -0.6, y: 0, z: 0 }]);
    expect(errors).toHaveLength(1);
  });

  it('afterMove override moves the partner', () => {
    const { tw, state } = testWorld();
    tw.advanceBy(100);
    const partnerSeq = move(tw, 2, { x: 1, y: 0, z: 0.4 });
    tw.clear();
    const pushedTo = { x: 8, y: 0, z: 8 };
    state.nextAfterMove = { overrides: [{ playerId: 'p2', position: pushedTo, reason: 'pushed' }] };
    tw.advanceBy(100);
    move(tw, 1, { x: -0.6, y: 0, z: 0 });

    expect(only(tw.messagesFor(conn(2)), 'player.corrected')).toEqual([
      { type: 'player.corrected', payload: { sequence: partnerSeq, position: pushedTo, rotation: 0, reason: PUSHED } },
    ]);
    const toMover = only(tw.messagesFor(conn(1)), 'player.updated');
    expect(toMover.map((m) => [m.payload.playerId, m.payload.position])).toEqual([['p2', pushedTo]]);

    // The partner's next move is measured from the override (10+ units from the old position).
    tw.advanceBy(100);
    move(tw, 2, { x: 8, y: 0, z: 7.6 });
    expect(tw.messagesFor(conn(2))).toEqual([]);
    expect(only(tw.messagesFor(conn(1)), 'player.updated').map((m) => m.payload.position)).toEqual([{ x: 8, y: 0, z: 7.6 }]);
  });

  describe('interact, tick and onConnection overrides reach the right players', () => {
    it('interact', () => {
      const { tw, sid, state } = testWorld();
      state.interactResult = { ok: true, effect: { overrides: [{ playerId: 'p2', position: { x: 3, y: 0, z: 3 }, reason: 'pushed' }] } };
      interact(tw, 1, sid, 'push', 'a1');
      const m1 = tw.messagesFor(conn(1));
      expect(m1[0]).toMatchObject({ type: 'request.accepted', requestId: 'i-a1' });
      expect(only(m1, 'player.updated').map((m) => [m.payload.playerId, m.payload.position])).toEqual([['p2', { x: 3, y: 0, z: 3 }]]);
      expect(only(m1, 'player.corrected')).toEqual([]);
      expect(only(tw.messagesFor(conn(2)), 'player.corrected').map((m) => m.payload)).toEqual([
        { sequence: -1, position: { x: 3, y: 0, z: 3 }, rotation: 0, reason: PUSHED },
      ]);
      expect(state.calls.interact).toEqual([['p1', 'push']]);
    });

    it('tick', () => {
      const { tw, state } = testWorld();
      state.nextTick = { overrides: [{ playerId: 'p1', position: { x: -3, y: 0, z: 0 }, rotation: 1, reason: 'pushed' }] };
      tw.world.advance();
      expect(only(tw.messagesFor(conn(1)), 'player.corrected').map((m) => m.payload)).toEqual([
        { sequence: -1, position: { x: -3, y: 0, z: 0 }, rotation: 1, reason: PUSHED },
      ]);
      expect(only(tw.messagesFor(conn(2)), 'player.updated').map((m) => [m.payload.playerId, m.payload.position, m.payload.rotation])).toEqual([
        ['p1', { x: -3, y: 0, z: 0 }, 1],
      ]);
    });

    it('onConnection', () => {
      const { tw, state } = testWorld();
      // The disconnected player's character is moved; only the partner hears about it.
      state.nextOnConnection = { overrides: [{ playerId: 'p2', position: { x: 2, y: 0, z: 2 }, reason: 'pushed' }] };
      tw.world.connectionLost(conn(2));
      const m1 = tw.messagesFor(conn(1));
      expect(m1.map((m) => m.type)).toEqual(['player.connection', 'player.updated']);
      expect(only(m1, 'player.updated')[0]!.payload).toMatchObject({ playerId: 'p2', position: { x: 2, y: 0, z: 2 } });
      expect(tw.messagesFor(conn(2))).toEqual([]);
      // The returning player's snapshot shows the moved position.
      admit(tw, 2);
      const snap = only(tw.messagesFor(conn(2)), 'world.snapshot')[0]!;
      expect(snap.payload.self.position).toEqual({ x: 2, y: 0, z: 2 });
    });
  });

  it('an override outside the arena is skipped and reported', () => {
    const { tw, state, errors } = testWorld();
    state.nextTick = { overrides: [{ playerId: 'p1', position: { x: 20, y: 0, z: 0 }, reason: 'pushed' }] };
    tw.world.advance();
    expect(errors).toHaveLength(1);
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
  });

  it('an override with a non-finite rotation is skipped and reported', () => {
    const { tw, state, errors } = testWorld();
    state.nextTick = { overrides: [{ playerId: 'p1', position: { x: -3, y: 0, z: 0 }, rotation: NaN, reason: 'pushed' }] };
    tw.world.advance();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('rotation');
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
  });

  it('an override with an undeclared reason is skipped and reported', () => {
    const { tw, state, errors } = testWorld();
    state.nextTick = { overrides: [{ playerId: 'p1', position: { x: -3, y: 0, z: 0 }, reason: 'bridgeClosed' }] };
    tw.world.advance();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bridgeClosed');
    expect(tw.messagesFor(conn(1))).toEqual([]);
    expect(tw.messagesFor(conn(2))).toEqual([]);
  });

  it('tick end finishes exactly one round', () => {
    const { tw, state, sid } = testWorld({ tick: () => ({ end: 'win' }) });
    tw.world.advance();
    for (const n of [1, 2]) {
      expect(only(tw.messagesFor(conn(n)), 'game.finished').map((m) => [m.payload.sessionId, m.payload.outcome])).toEqual([
        [sid, 'win'],
      ]);
    }
    expect(tw.world.takeFinishedRounds()).toMatchObject([{ sessionId: sid, outcome: 'win' }]);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toEqual([]);
    expect(state.calls.tick).toBe(0); // the override replaced the recording hook
  });

  it('tick win at the round deadline counts as a win', () => {
    const { tw } = testWorld({ tick: (_s, v) => (v.now >= v.startedAt + 10_000 ? { end: 'win' } : {}) });
    tw.advanceBy(10_000);
    tw.world.advance();
    expect(tw.world.takeFinishedRounds()).toMatchObject([{ outcome: 'win', cancelReason: null }]);
  });

  it('interact end win finishes the round', () => {
    const { tw, sid, state } = testWorld();
    state.interactResult = { ok: true, effect: { end: 'win' } };
    interact(tw, 2, sid, 'win', 'w1');
    const m2 = tw.messagesFor(conn(2));
    expect(m2[0]).toMatchObject({ type: 'request.accepted', requestId: 'i-w1' });
    expect(only(m2, 'game.finished').map((m) => m.payload.outcome)).toEqual(['win']);
    expect(tw.world.takeFinishedRounds()).toMatchObject([{ sessionId: sid, outcome: 'win' }]);
  });

  it('unknown target is VALIDATION_ERROR with the requestId', () => {
    const { tw, sid, state } = testWorld();
    interact(tw, 1, sid, 'door', 'd1');
    expect(tw.messagesFor(conn(1))).toEqual([
      { type: 'request.error', requestId: 'i-d1', error: { code: 'VALIDATION_ERROR', message: 'Interaction target is invalid.' } },
    ]);
    expect(state.calls.interact).toEqual([]);
  });

  it('onConnection is called on disconnect and on return within grace', () => {
    const { tw, state } = testWorld();
    tw.world.connectionLost(conn(1));
    expect(state.calls.onConnection).toEqual([['p1', false]]);
    tw.advanceBy(5_000);
    expect(admit(tw, 1).error).toBeNull();
    expect(state.calls.onConnection).toEqual([
      ['p1', false],
      ['p1', true],
    ]);
  });

  it('score reaches the board and is clamped to scoreMax', () => {
    const { tw, sid, state, errors } = testWorld();
    // An interaction with no effect that changes the score still publishes it.
    state.score = 2;
    interact(tw, 1, sid, 'push', 's1');
    expect(boards(tw.messagesFor(conn(2))).map((b) => [b.id, b.score])).toEqual([['test', 2]]);
    expect(errors).toEqual([]);

    state.score = 9;
    interact(tw, 1, sid, 'push', 's2');
    expect(boards(tw.messagesFor(conn(2))).map((b) => b.score)).toEqual([3]);
    expect(errors).toHaveLength(1);
  });

  it('stateChanged from tick bumps the revision once and sends game.state', () => {
    const { tw, state } = testWorld();
    state.nextTick = { stateChanged: true };
    tw.world.advance();
    const first = only(tw.messagesFor(conn(1)), 'game.state');
    expect(first).toHaveLength(1);
    expect(only(tw.messagesFor(conn(2)), 'game.state')).toHaveLength(1);
    state.nextTick = { stateChanged: true };
    tw.world.advance();
    const second = only(tw.messagesFor(conn(1)), 'game.state');
    expect(second).toHaveLength(1);
    expect(second[0]!.payload.revision).toBe(first[0]!.payload.revision + 1);
  });
});
