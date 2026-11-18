import { expect } from 'vitest';
import type { AvatarId, PlayerCard, PortalPartnersTarget, RoomSummary, ServerMessage, Vec3 } from '../contracts';
import { PORTAL_ROOM, type WorldConfig } from './config';
import { World, type ConnId, type Outgoing } from './world';

export interface TestWorld {
  world: World;
  /** Moves the controllable clock forward. */
  advanceBy(ms: number): void;
  now(): number;
  /** Messages sent to `conn` since the last call for that conn (drains the world outbox). */
  messagesFor(conn: ConnId): ServerMessage[];
  /** Drains the outbox and discards every pending message. */
  clear(): void;
}

export function makeWorld(config?: WorldConfig): TestWorld {
  let clock = 0;
  let nextId = 0;
  const world = new World({
    now: () => clock,
    newId: () => `id-${++nextId}`,
    ...(config ? { config } : {}),
  });
  let pending: Outgoing[] = [];

  const flush = () => {
    pending.push(...world.takeOutbox());
  };

  return {
    world,
    advanceBy(ms) {
      clock += ms;
    },
    now: () => clock,
    messagesFor(conn) {
      flush();
      const mine = pending.filter((o) => o.to === conn).map((o) => o.message);
      pending = pending.filter((o) => o.to !== conn);
      return mine;
    },
    clear() {
      flush();
      pending = [];
    },
  };
}

/** A sample player card: player `n` is `p<n>` on connection `c<n>`. */
export function card(n: number): PlayerCard {
  const avatar = `avatar-${String(((n - 1) % 20) + 1).padStart(2, '0')}` as AvatarId;
  return { id: `p${n}`, displayName: `Player ${n}`, avatarId: avatar };
}

export function conn(n: number): ConnId {
  return `c${n}`;
}

// ---- drivers shared by the world tests ----

export const ENTRANCE = PORTAL_ROOM.entrance;
export const LOBBY_SPAWN: Vec3 = { x: 0, y: 0, z: 4 };

const seqs = new WeakMap<TestWorld, Map<string, number>>();

function nextSeq(tw: TestWorld, c: ConnId): number {
  let m = seqs.get(tw);
  if (!m) seqs.set(tw, (m = new Map()));
  const s = (m.get(c) ?? 0) + 1;
  m.set(c, s);
  return s;
}

/** Sends a move for player `n` (or an explicit connection id) with the next sequence number. */
export function move(tw: TestWorld, n: number | ConnId, position: Vec3, rotation = 0): number {
  const c = typeof n === 'number' ? conn(n) : n;
  const sequence = nextSeq(tw, c);
  tw.world.handle(c, { type: 'player.move', payload: { sequence, position, rotation } });
  return sequence;
}

/** Walks player n from `from` to `to` at a legal pace in both locations (0.4 units per 100 ms). */
export function walk(tw: TestWorld, n: number | ConnId, from: Vec3, to: Vec3): void {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.ceil(dist / 0.4);
  for (let i = 1; i <= steps; i++) {
    tw.advanceBy(100);
    const f = i / steps;
    move(tw, n, { x: from.x + (to.x - from.x) * f, y: 0, z: from.z + (to.z - from.z) * f });
  }
}

export function admit(tw: TestWorld, n: number) {
  return tw.world.admit(conn(n), card(n));
}

export function admitAll(tw: TestWorld, count: number) {
  for (let n = 1; n <= count; n++) expect(admit(tw, n).error).toBeNull();
}

export function join(tw: TestWorld, n: number, roomId = 'portal') {
  tw.world.handle(conn(n), { type: 'room.join', requestId: `j${n}`, payload: { roomId } });
}

export function leave(tw: TestWorld, n: number) {
  tw.world.handle(conn(n), { type: 'room.leave', requestId: `l${n}`, payload: {} });
}

export function ready(tw: TestWorld, n: number, value = true) {
  tw.world.handle(conn(n), { type: 'game.ready', requestId: `r${n}`, payload: { ready: value } });
}

export function interact(
  tw: TestWorld,
  n: number | ConnId,
  sessionId: string,
  target: PortalPartnersTarget,
  actionId = `a-${target}-${tw.now()}`,
) {
  const c = typeof n === 'number' ? conn(n) : n;
  tw.world.handle(c, { type: 'game.interact', requestId: `i-${actionId}`, payload: { sessionId, actionId, target } });
}

/** Admits players 1..count, walks the given ones to the portal entrance and joins them. */
export function setup(count: number, joiners: number[] = [], config?: WorldConfig): TestWorld {
  const tw = makeWorld(config);
  admitAll(tw, count);
  for (const n of joiners) {
    walk(tw, n, LOBBY_SPAWN, ENTRANCE);
    join(tw, n);
  }
  tw.clear();
  return tw;
}

export function only<T extends ServerMessage['type']>(msgs: ServerMessage[], type: T) {
  return msgs.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
}

export function lastReply(msgs: ServerMessage[]) {
  const replies = msgs.filter((m) => m.type === 'request.accepted' || m.type === 'request.error');
  return replies[replies.length - 1];
}

export function errorCode(msgs: ServerMessage[]) {
  const r = lastReply(msgs);
  return r?.type === 'request.error' ? r.error.code : null;
}

export function boards(msgs: ServerMessage[]): RoomSummary[] {
  return only(msgs, 'room.updated').map((m) => m.payload.room);
}
