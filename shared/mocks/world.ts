// The mock's world (spec §8.1, §9): the same World engine the runtime runs, in-process, behind
// an in-memory socket that follows the runtime's protocol (auth first, the same close codes).
// The shared connection code in shared/client/world.ts runs on top of it, so the mock and the
// real client behave the same. Results are "saved" at once: after every flush, finished rounds
// are stored in memory, then `result.saved` is delivered.
// Mock tokens are player ids: sample data only, never a real credential.
import { parseClientMessage } from '../contracts/index';
import type { ClientMessage, ErrorCode, GameResult, PlayerCard, ServerMessage } from '../contracts/index';
import { CLOSE_CODES, type SocketLike } from '../client/world';
import type { ConnId, FinishedRound, World } from '../world/index';

/** A finished round, kept as the runtime would save it. */
export interface MockResult {
  id: string;
  round: FinishedRound;
}

/** The part of MockStore the world hub needs. */
export interface MockWorldStore {
  readonly world: World;
  readonly results: MockResult[];
  /** The player's current card, or undefined for an unknown id. */
  cardFor(playerId: string): PlayerCard | undefined;
}

/** World.advance() cadence while anyone holds a slot, as in the runtime. */
const TICK_MS = 100;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHORIZED: 'Your session is not valid. Please sign in again.',
  VALIDATION_ERROR: 'The message is not valid.',
  WORLD_FULL: 'The world is full. Please try again later.',
  INVALID_ACTION: 'You are already signed in on this connection.',
};

interface ServerSide {
  id: ConnId;
  phase: 'pending' | 'admitted' | 'closed';
  playerId: string | null;
  client: MockSocket;
}

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  /** Set when the server closed: messages it queued before closing are still delivered. */
  private serverClosing = false;

  constructor(private readonly hub: Hub, readonly server: ServerSide) {}

  send(data: string): void {
    if (this.closed) return;
    // Asynchronous and in order, like a network.
    queueMicrotask(() => this.hub.receive(this.server, data));
  }

  close(code = 1005, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.hub.socketGone(this.server);
      this.onclose?.({ code, reason });
    });
  }

  /** Server side: deliver a message to the client. */
  deliver(message: ServerMessage): void {
    if (this.closed) return;
    const data = JSON.stringify(message);
    queueMicrotask(() => {
      if (!this.closed || this.serverClosing) this.onmessage?.({ data });
    });
  }

  /** Server side: close the connection with a code. */
  serverClose(code: number, reason: string): void {
    if (this.closed) return;
    this.serverClosing = true;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

class Hub {
  private readonly conns = new Map<ConnId, ServerSide>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly store: MockWorldStore) {}

  open(): SocketLike {
    const server: ServerSide = { id: crypto.randomUUID(), phase: 'pending', playerId: null, client: null as never };
    const socket = new MockSocket(this, server);
    server.client = socket;
    this.conns.set(server.id, server);
    queueMicrotask(() => {
      if (!socket.closed) socket.onopen?.();
    });
    return socket;
  }

  receive(conn: ServerSide, data: string): void {
    if (conn.phase === 'closed') return;
    const parsed = parseClientMessage(data);
    if (parsed.error) {
      this.send(conn, errorMessage(null, 'VALIDATION_ERROR'));
      return;
    }
    const msg = parsed.data;
    if (conn.phase === 'pending') {
      if (msg.type !== 'auth') {
        this.reject(conn, msg.requestId ?? null, 'UNAUTHORIZED');
        return;
      }
      const card = this.store.cardFor(msg.payload.token);
      if (!card) {
        this.reject(conn, msg.requestId, 'UNAUTHORIZED');
        return;
      }
      const admitted = this.store.world.admit(conn.id, card);
      if (admitted.error) {
        this.flush();
        this.reject(conn, msg.requestId, admitted.error.code);
        return;
      }
      conn.phase = 'admitted';
      conn.playerId = card.id;
      this.flush();
      return;
    }

    switch (msg.type) {
      case 'auth':
        this.send(conn, errorMessage(msg.requestId, 'INVALID_ACTION'));
        return;
      case 'auth.refresh':
        if (msg.payload.token !== conn.playerId) {
          this.send(conn, errorMessage(msg.requestId, 'UNAUTHORIZED'));
          return;
        }
        this.send(conn, { type: 'request.accepted', requestId: msg.requestId, payload: {} });
        return;
      default:
        this.store.world.handle(conn.id, msg as Exclude<ClientMessage, { type: 'auth' | 'auth.refresh' }>);
        this.flush();
    }
  }

  /** The client closed its socket: an unexpected disconnect for the engine. */
  socketGone(conn: ServerSide): void {
    if (conn.phase === 'closed') return;
    const wasAdmitted = conn.phase === 'admitted';
    this.forget(conn);
    if (wasAdmitted) {
      this.store.world.connectionLost(conn.id);
      this.flush();
    }
  }

  private reject(conn: ServerSide, requestId: string | null, code: ErrorCode): void {
    this.send(conn, errorMessage(requestId, code));
    this.forget(conn);
    conn.client.serverClose(closeCodeFor(code), code);
  }

  private forget(conn: ServerSide): void {
    conn.phase = 'closed';
    this.conns.delete(conn.id);
  }

  private send(conn: ServerSide, message: ServerMessage): void {
    conn.client.deliver(message);
  }

  /** Outbox, closings, then immediate "saving" of finished rounds, then the timer. */
  flush(): void {
    const world = this.store.world;
    const finished = world.takeFinishedRounds();
    for (const { to, message } of world.takeOutbox()) {
      const conn = this.conns.get(to);
      if (conn) this.send(conn, message);
    }
    for (const { conn: id, reason } of world.takeClosings()) {
      const conn = this.conns.get(id);
      if (!conn) continue;
      this.forget(conn);
      conn.client.serverClose(CLOSE_CODES.normal, reason);
    }
    for (const round of finished) {
      const id = crypto.randomUUID();
      this.store.results.push({ id, round });
      world.notePersistence(round.sessionId, 'saved');
      for (const conn of this.conns.values()) {
        if (conn.phase === 'admitted' && conn.playerId !== null && round.playerIds.includes(conn.playerId)) {
          this.send(conn, { type: 'result.saved', payload: { sessionId: round.sessionId, resultId: id } });
        }
      }
    }
    this.syncTicker();
  }

  private syncTicker(): void {
    if (this.store.world.needsTimer()) {
      if (this.ticker === null) {
        this.ticker = setInterval(() => {
          this.store.world.advance();
          this.flush();
        }, TICK_MS);
        // In Node, do not keep the process alive just for the mock world.
        (this.ticker as { unref?: () => void }).unref?.();
      }
    } else if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

const hubs = new WeakMap<MockWorldStore, Hub>();

/** Opens an in-memory socket to the store's world. */
export function openMockSocket(store: MockWorldStore): SocketLike {
  let hub = hubs.get(store);
  if (!hub) hubs.set(store, (hub = new Hub(store)));
  return hub.open();
}

/** Results for `playerId`, newest first (completedAt, then id, descending), as GameResults. */
export function resultsFor(store: MockWorldStore, playerId: string): GameResult[] {
  return store.results
    .filter((r) => r.round.playerIds.includes(playerId))
    .sort((a, b) => compareDesc(a, b))
    .map((r) => toGameResult(store, r));
}

export function compareDesc(a: MockResult, b: MockResult): number {
  if (a.round.completedAt !== b.round.completedAt) return a.round.completedAt < b.round.completedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function toGameResult(store: MockWorldStore, r: MockResult): GameResult {
  const { round } = r;
  const players = [...round.playerIds]
    .sort()
    .map((id) => store.cardFor(id))
    .filter((c): c is PlayerCard => c !== undefined)
    .map((c) => ({ id: c.id, displayName: c.displayName, avatarId: c.avatarId }));
  return {
    id: r.id,
    sessionId: round.sessionId,
    gameType: round.gameType,
    outcome: round.outcome,
    cancelReason: round.cancelReason,
    score: round.score,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    durationSeconds: Math.floor((Date.parse(round.completedAt) - Date.parse(round.startedAt)) / 1000),
    players,
  };
}

function errorMessage(requestId: string | null, code: ErrorCode): ServerMessage {
  return { type: 'request.error', requestId, error: { code, message: MESSAGES[code] ?? code } };
}

function closeCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return CLOSE_CODES.unauthorized;
    case 'WORLD_FULL':
      return CLOSE_CODES.worldFull;
    case 'SERVICE_UNAVAILABLE':
      return CLOSE_CODES.unavailable;
    default:
      return CLOSE_CODES.invalid;
  }
}
