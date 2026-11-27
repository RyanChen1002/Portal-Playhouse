import { describe, expect, it } from 'vitest';
import type { GameStatePayload, PowerUpWorkshopState, ServerMessage, Vec3 } from '../contracts';
import { WORKSHOP_ROOM } from './config';
import { CABLE_POINTS, GEAR_POINTS, POWER_LEFT, POWER_RIGHT, SOCKET_POINTS } from './games/power-up-workshop';
import {
  admit,
  admitAll,
  boards,
  conn,
  interact,
  join,
  lastReply,
  LOBBY_SPAWN,
  makeWorld,
  only,
  ready,
  walk,
  type TestWorld,
} from './test-helpers';

const SPAWNS: [Vec3, Vec3] = [
  { x: -3, y: 0, z: 6 },
  { x: 0, y: 0, z: 6 },
];
const v = (p: { x: number; z: number }): Vec3 => ({ x: p.x, y: 0, z: p.z });

function workshopStates(msgs: ServerMessage[]): PowerUpWorkshopState[] {
  return only(msgs, 'game.state')
    .map((m) => m.payload)
    .filter((p): p is Extract<GameStatePayload, { gameType: 'power-up-workshop' }> => p.gameType === 'power-up-workshop')
    .map((p) => p.state);
}

/** A workshop round in progress, tracking where each player stands. */
interface Round {
  tw: TestWorld;
  sid: string;
  state: PowerUpWorkshopState;
  pos: [Vec3, Vec3];
  nextAction: number;
}

/** Players 1 and 2 ready in the workshop (already joined); returns the started round. */
function readyUp(tw: TestWorld): Round {
  ready(tw, 1);
  ready(tw, 2);
  const states = only(tw.messagesFor(conn(1)), 'game.state');
  expect(states).toHaveLength(1);
  const payload = states[0]!.payload;
  expect(payload.gameType).toBe('power-up-workshop');
  if (payload.gameType !== 'power-up-workshop') throw new Error('not a workshop round');
  tw.clear();
  return { tw, sid: payload.sessionId, state: payload.state, pos: [{ ...SPAWNS[0] }, { ...SPAWNS[1] }], nextAction: 0 };
}

/** Admits players 1..count, walks 1 and 2 to the workshop entrance, joins and readies them. */
function startWorkshop(count = 2): Round {
  const tw = makeWorld();
  admitAll(tw, count);
  for (const n of [1, 2]) {
    walk(tw, n, LOBBY_SPAWN, WORKSHOP_ROOM.entrance);
    join(tw, n, 'workshop');
    expect(lastReply(tw.messagesFor(conn(n)))?.type).toBe('request.accepted');
  }
  tw.clear();
  return readyUp(tw);
}

function goTo(r: Round, n: 1 | 2, to: { x: number; z: number }): void {
  walk(r.tw, n, r.pos[n - 1]!, v(to));
  r.pos[n - 1] = v(to);
}

function use(r: Round, n: 1 | 2, target: string): ServerMessage[] {
  interact(r.tw, n, r.sid, target, `act-${++r.nextAction}`);
  return r.tw.messagesFor(conn(n));
}

describe('Power-Up Workshop in the world', () => {
  it('the default board lists portal then workshop', () => {
    const tw = makeWorld();
    admit(tw, 1);
    const snap = only(tw.messagesFor(conn(1)), 'world.snapshot')[0]!.payload;
    expect(snap.board.map((b) => b.id)).toEqual(['portal', 'workshop']);
    const workshop = snap.board[1]!;
    expect(workshop).toMatchObject({ name: 'Power-Up Workshop', gameType: 'power-up-workshop', status: 'waiting' });
  });

  it('two players join the workshop and start a level 1 round', () => {
    const r = startWorkshop();
    expect(r.state.level).toBe(1);
    expect(r.state.durationSeconds).toBe(180);
    expect(r.state.gears).toEqual([0, 0, 0]);
    expect(r.state.held).toEqual([null, null]);
  });

  it('a second round in the same room is level 2', () => {
    const r = startWorkshop();
    // The round runs out of time (a loss); both players stay in the room for the next one.
    r.tw.advanceBy(180_000);
    r.tw.world.advance();
    const fin = only(r.tw.messagesFor(conn(1)), 'game.finished');
    expect(fin).toHaveLength(1);
    expect(fin[0]!.payload.outcome).toBe('loss');
    r.tw.clear();
    const second = readyUp(r.tw);
    expect(second.state.level).toBe(2);
    expect(second.sid).not.toBe(r.sid);
  });

  it('the workshop board score follows plugged cables', () => {
    const r = startWorkshop(3);
    const cable = r.state.socketCables[0]!;
    goTo(r, 1, CABLE_POINTS[cable]!);
    use(r, 1, `cable-${cable}`);
    goTo(r, 1, SOCKET_POINTS[0]!);
    expect(lastReply(use(r, 1, 'socket-0'))?.type).toBe('request.accepted');
    const workshop = boards(r.tw.messagesFor(conn(3))).filter((b) => b.id === 'workshop');
    expect(workshop.at(-1)).toMatchObject({ name: 'Power-Up Workshop', score: 1, status: 'playing' });
  });

  it('a wrong cable is accepted and reaches both players at once', () => {
    const r = startWorkshop();
    const needed = r.state.socketCables[0]!;
    const wrong = (needed + 1) % 3;
    goTo(r, 1, CABLE_POINTS[wrong]!);
    use(r, 1, `cable-${wrong}`);
    goTo(r, 1, SOCKET_POINTS[0]!);
    r.tw.clear();
    // No clock advance: the state must come with the action, not the once-a-second refresh.
    const msgs1 = use(r, 1, 'socket-0');
    expect(lastReply(msgs1)?.type).toBe('request.accepted');
    const expected = { mistakes: 1, feedback: `Socket 1 needs cable ${'ABC'[needed]}.`, sockets: [false, false, false] };
    for (const msgs of [msgs1, r.tw.messagesFor(conn(2))]) {
      expect(workshopStates(msgs).at(-1)).toMatchObject(expected);
    }
  });

  it('a full scripted round is a win with score 6', () => {
    const r = startWorkshop();
    const { gearTargets, socketCables } = r.state;
    for (const i of [0, 1, 2]) {
      goTo(r, 1, GEAR_POINTS[i]!);
      for (let k = 0; k < gearTargets[i]!; k++) expect(lastReply(use(r, 1, `gear-${i}`))?.type).toBe('request.accepted');
    }
    for (const i of [0, 1, 2]) {
      const cable = socketCables[i]!;
      goTo(r, 1, CABLE_POINTS[cable]!);
      expect(lastReply(use(r, 1, `cable-${cable}`))?.type).toBe('request.accepted');
      goTo(r, 1, SOCKET_POINTS[i]!);
      expect(lastReply(use(r, 1, `socket-${i}`))?.type).toBe('request.accepted');
    }
    goTo(r, 2, POWER_LEFT);
    goTo(r, 1, POWER_RIGHT);
    for (const n of [1, 2]) expect(only(r.tw.messagesFor(conn(n)), 'player.corrected')).toEqual([]);
    r.tw.clear();
    expect(lastReply(use(r, 1, 'power-right'))?.type).toBe('request.accepted');
    const rounds = r.tw.world.takeFinishedRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ outcome: 'win', score: 6, gameType: 'power-up-workshop', sessionId: r.sid });
  });

  it('a timeout at 180 s is a loss carrying the score at that moment', () => {
    const r = startWorkshop();
    const cable = r.state.socketCables[0]!;
    goTo(r, 1, CABLE_POINTS[cable]!);
    use(r, 1, `cable-${cable}`);
    goTo(r, 1, SOCKET_POINTS[0]!);
    expect(lastReply(use(r, 1, 'socket-0'))?.type).toBe('request.accepted');
    r.tw.clear();
    r.tw.advanceBy(180_001);
    r.tw.world.advance();
    const fin = only(r.tw.messagesFor(conn(1)), 'game.finished');
    expect(fin).toHaveLength(1);
    expect(fin[0]!.payload).toMatchObject({ outcome: 'loss', score: 1 });
    const rounds = r.tw.world.takeFinishedRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ outcome: 'loss', score: 1, gameType: 'power-up-workshop', sessionId: r.sid });
  });

  it('a repeated actionId on a gear press turns the gear once (Review Focus 3)', () => {
    const r = startWorkshop();
    goTo(r, 1, GEAR_POINTS[0]!);
    r.tw.clear();
    interact(r.tw, 1, r.sid, 'gear-0', 'same-action');
    const first = r.tw.messagesFor(conn(1));
    interact(r.tw, 1, r.sid, 'gear-0', 'same-action');
    const second = r.tw.messagesFor(conn(1));
    expect(lastReply(first)?.type).toBe('request.accepted');
    expect(lastReply(second)?.type).toBe('request.accepted');
    expect(workshopStates(first).at(-1)?.gears).toEqual([1, 0, 0]);
    expect(workshopStates(second)).toEqual([]);
    // A fresh action turns it again, from 1.
    interact(r.tw, 1, r.sid, 'gear-0', 'next-action');
    expect(workshopStates(r.tw.messagesFor(conn(1))).at(-1)?.gears).toEqual([2, 0, 0]);
  });

  it('a disconnect while holding a cable empties that hand for the partner', () => {
    const r = startWorkshop();
    goTo(r, 1, CABLE_POINTS[1]!);
    use(r, 1, 'cable-1');
    expect(workshopStates(r.tw.messagesFor(conn(2))).at(-1)?.held).toEqual([1, null]);
    r.tw.world.connectionLost(conn(1));
    const states = workshopStates(r.tw.messagesFor(conn(2)));
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1)?.held).toEqual([null, null]);
  });
});
