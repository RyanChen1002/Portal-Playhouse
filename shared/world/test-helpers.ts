import type { AvatarId, PlayerCard, ServerMessage } from '../contracts';
import type { WorldConfig } from './config';
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
