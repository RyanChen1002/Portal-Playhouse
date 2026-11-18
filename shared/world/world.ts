import type {
  CancelReason,
  ClientMessage,
  ErrorCode,
  GameFinished,
  Outcome,
  PlayerCard,
  Presence,
  Result,
  RoomId,
  RoomSnapshot,
  RoomSummary,
  ServerMessage,
  Vec3,
  WorldSnapshot,
} from '../contracts';
import {
  COURTYARD_SPAWN,
  COURTYARD_SPAWN_ROTATION,
  DEFAULT_WORLD_CONFIG,
  type GameRoomConfig,
  type Location,
  type WorldConfig,
} from './config';
import { checkMove, newTracker, type MoveTracker } from './movement';

export type ConnId = string;
export interface Outgoing {
  to: ConnId;
  message: ServerMessage;
}
export interface Closing {
  conn: ConnId;
  reason: 'session.replaced' | 'idle' | 'left';
}
export interface FinishedRound {
  sessionId: string;
  playerIds: [string, string];
  outcome: Outcome;
  cancelReason: CancelReason | null;
  score: number;
  startedAt: string;
  completedAt: string;
}
export interface WorldOptions {
  now: () => number;
  newId: () => string;
  config?: WorldConfig;
}

type Command = Exclude<ClientMessage, { type: 'auth' | 'auth.refresh' }>;
type Request = Exclude<Command, { type: 'player.move' }>;

const LOBBY: RoomId = 'lobby';

interface PlayerState {
  card: PlayerCard;
  conn: ConnId | null;
  roomId: RoomId;
  /** Null while in a waiting game room. */
  position: Vec3 | null;
  rotation: number;
  /** Null while there is no position to move from. */
  tracker: MoveTracker | null;
  ready: boolean;
  lastFinished: GameFinished | null;
}

interface RoomState {
  id: RoomId;
  /** Null for the lobby. */
  config: GameRoomConfig | null;
  /** Player ids in join order. */
  members: string[];
  revision: number;
  status: 'waiting' | 'playing';
  sessionId: string | null;
  startedAt: string | null;
  score: number | null;
}

/**
 * The platform-free world engine. Callers feed it admitted connections and parsed client
 * messages, then drain the outbox, closings and finished rounds. Time comes only from `now()`.
 */
export class World {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly config: WorldConfig;
  private readonly players = new Map<string, PlayerState>();
  private readonly conns = new Map<ConnId, string>();
  private readonly rooms = new Map<RoomId, RoomState>();
  private outbox: Outgoing[] = [];
  private closings: Closing[] = [];
  private finished: FinishedRound[] = [];

  constructor(opts: WorldOptions) {
    this.now = opts.now;
    this.newId = opts.newId;
    this.config = opts.config ?? DEFAULT_WORLD_CONFIG;
    this.rooms.set(LOBBY, this.newRoom(LOBBY, null));
    for (const rc of this.config.rooms) this.rooms.set(rc.id, this.newRoom(rc.id, rc));
  }

  admit(conn: ConnId, player: PlayerCard): Result<null> {
    this.advance();
    const existing = this.players.get(player.id);
    if (existing) {
      if (existing.conn !== null && existing.conn !== conn) {
        // One connection per account: the new connection takes over slot, room and position.
        this.send(existing.conn, { type: 'session.replaced', payload: {} });
        this.closings.push({ conn: existing.conn, reason: 'session.replaced' });
        this.conns.delete(existing.conn);
      }
      existing.conn = conn;
      // Move sequences are per connection, so the new one starts its own count.
      if (existing.tracker) existing.tracker = { ...existing.tracker, lastSequence: -1 };
      this.conns.set(conn, player.id);
      this.send(conn, { type: 'world.snapshot', payload: this.worldSnapshot(existing) });
      return { data: null, error: null };
    }

    if (this.players.size >= this.config.worldLimit) {
      return fail('WORLD_FULL', 'The world is full. Please try again later.');
    }

    const now = this.now();
    const p: PlayerState = {
      card: { id: player.id, displayName: player.displayName, avatarId: player.avatarId },
      conn,
      roomId: LOBBY,
      position: { ...COURTYARD_SPAWN },
      rotation: COURTYARD_SPAWN_ROTATION,
      tracker: newTracker({ ...COURTYARD_SPAWN }, COURTYARD_SPAWN_ROTATION, now),
      ready: false,
      lastFinished: null,
    };
    this.players.set(p.card.id, p);
    this.conns.set(conn, p.card.id);
    const lobby = this.lobby();
    lobby.members.push(p.card.id);
    lobby.revision++;
    this.toRoom(lobby, { type: 'player.joined', payload: { player: presence(p), revision: lobby.revision } }, p.card.id);
    this.send(conn, { type: 'world.snapshot', payload: this.worldSnapshot(p) });
    return { data: null, error: null };
  }

  handle(conn: ConnId, msg: Command): void {
    this.advance();
    const id = this.conns.get(conn);
    const p = id === undefined ? undefined : this.players.get(id);
    if (!p) return;

    if (msg.type === 'player.move') {
      this.move(p, msg.payload);
      return;
    }
    const err = this.request(p, msg);
    if (err) {
      this.send(conn, {
        type: 'request.error',
        requestId: msg.requestId,
        error: { code: err.code, message: err.message },
      });
    }
  }

  /** Unexpected loss of a connection. Grace handling arrives with Task 6. */
  connectionLost(_conn: ConnId): void {}

  /** Runs due timers (grace expiry, round time-out, idle limit). None exist yet. */
  advance(): void {}

  takeOutbox(): Outgoing[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  takeClosings(): Closing[] {
    const out = this.closings;
    this.closings = [];
    return out;
  }

  takeFinishedRounds(): FinishedRound[] {
    const out = this.finished;
    this.finished = [];
    return out;
  }

  needsTimer(): boolean {
    return this.players.size > 0;
  }

  slotsUsed(): number {
    return this.players.size;
  }

  // ---- commands ----

  private request(p: PlayerState, msg: Request): { code: ErrorCode; message: string } | null {
    switch (msg.type) {
      case 'room.join':
        return this.join(p, msg.requestId, msg.payload.roomId);
      case 'room.leave':
        return this.leaveRoom(p, msg.requestId);
      case 'game.ready':
        return this.setReady(p, msg.requestId, msg.payload.ready);
      case 'game.interact':
        return { code: 'NOT_IN_GAME', message: 'There is no round in progress.' };
      case 'world.leave':
        this.leaveWorld(p, msg.requestId);
        return null;
    }
  }

  private move(p: PlayerState, m: { sequence: number; position: Vec3; rotation: number }): void {
    const room = this.roomOf(p);
    const loc = locationOf(room);
    // Waiting rooms have no positions: there is nothing to move or correct to.
    if (loc === null || !p.tracker) return;
    const r = checkMove(p.tracker, loc, m.sequence, m.position, m.rotation, this.now());
    if (r.kind === 'stale') return;
    p.tracker = r.tracker;
    if (r.kind === 'rejected') {
      if (p.conn !== null) {
        this.send(p.conn, {
          type: 'player.corrected',
          payload: {
            sequence: m.sequence,
            position: { ...r.tracker.position },
            rotation: r.tracker.rotation,
            reason: 'rejected',
          },
        });
      }
      return;
    }
    p.position = { ...m.position };
    p.rotation = m.rotation;
    room.revision++;
    this.toRoom(
      room,
      {
        type: 'player.updated',
        payload: {
          playerId: p.card.id,
          position: { ...m.position },
          rotation: m.rotation,
          sequence: m.sequence,
          revision: room.revision,
        },
      },
      p.card.id,
    );
  }

  private join(p: PlayerState, requestId: string, roomId: RoomId) {
    const room = roomId === LOBBY ? undefined : this.rooms.get(roomId);
    if (!room?.config) return { code: 'ROOM_NOT_FOUND' as const, message: 'That room does not exist.' };
    if (p.roomId !== LOBBY || !p.position) {
      return { code: 'INVALID_ACTION' as const, message: 'Return to the courtyard before joining another room.' };
    }
    const e = room.config.entrance;
    if (Math.hypot(p.position.x - e.x, p.position.z - e.z) > room.config.joinRadius) {
      return { code: 'INVALID_ACTION' as const, message: 'Walk up to the room entrance to join.' };
    }
    if (room.status === 'playing') return { code: 'ROOM_LOCKED' as const, message: 'A round is in progress in that room.' };
    if (room.members.length >= room.config.maxPlayers) {
      return { code: 'ROOM_FULL' as const, message: 'That room is full.' };
    }

    const lobby = this.lobby();
    remove(lobby.members, p.card.id);
    lobby.revision++;
    room.members.push(p.card.id);
    this.resetReady(room);
    room.revision++;
    p.roomId = room.id;
    p.position = null;
    p.tracker = null;

    this.toRoom(lobby, { type: 'player.left', payload: { playerId: p.card.id, reason: 'moved', revision: lobby.revision } });
    this.toRoom(room, { type: 'player.joined', payload: { player: presence(p), revision: room.revision } }, p.card.id);
    this.reply(p, requestId, this.roomSnapshot(room));
    this.broadcastBoard(room);
    return null;
  }

  private leaveRoom(p: PlayerState, requestId: string) {
    const room = this.roomOf(p);
    if (!room.config) return { code: 'INVALID_ACTION' as const, message: 'You are not in a game room.' };

    remove(room.members, p.card.id);
    this.resetReady(room);
    room.revision++;
    const lobby = this.lobby();
    const entrance = { ...room.config.entrance };
    lobby.members.push(p.card.id);
    lobby.revision++;
    p.roomId = LOBBY;
    p.position = entrance;
    p.tracker = newTracker({ ...entrance }, p.rotation, this.now());
    p.ready = false;

    this.toRoom(room, { type: 'player.left', payload: { playerId: p.card.id, reason: 'moved', revision: room.revision } });
    this.toRoom(lobby, { type: 'player.joined', payload: { player: presence(p), revision: lobby.revision } }, p.card.id);
    this.reply(p, requestId, this.roomSnapshot(lobby));
    this.broadcastBoard(room);
    return null;
  }

  private setReady(p: PlayerState, requestId: string, ready: boolean) {
    const room = this.roomOf(p);
    if (!room.config || room.status !== 'waiting') {
      return { code: 'GAME_NOT_READY' as const, message: 'You can only get ready in a waiting game room.' };
    }
    if (p.ready !== ready) {
      p.ready = ready;
      room.revision++;
      this.toRoom(room, { type: 'player.ready', payload: { playerId: p.card.id, ready, revision: room.revision } }, p.card.id);
    }
    this.reply(p, requestId, null);
    return null;
  }

  private leaveWorld(p: PlayerState, requestId: string): void {
    const conn = p.conn;
    this.reply(p, requestId, null);
    if (conn !== null) {
      this.closings.push({ conn, reason: 'left' });
      this.conns.delete(conn);
    }
    this.removePlayer(p, 'left');
  }

  // ---- state helpers ----

  private removePlayer(p: PlayerState, reason: 'left' | 'disconnected' | 'idle'): void {
    const room = this.roomOf(p);
    remove(room.members, p.card.id);
    if (room.config) this.resetReady(room);
    room.revision++;
    this.players.delete(p.card.id);
    this.toRoom(room, { type: 'player.left', payload: { playerId: p.card.id, reason, revision: room.revision } });
    if (room.config) this.broadcastBoard(room);
  }

  private newRoom(id: RoomId, config: GameRoomConfig | null): RoomState {
    return { id, config, members: [], revision: 0, status: 'waiting', sessionId: null, startedAt: null, score: null };
  }

  private lobby(): RoomState {
    return this.rooms.get(LOBBY)!;
  }

  private roomOf(p: PlayerState): RoomState {
    return this.rooms.get(p.roomId)!;
  }

  private resetReady(room: RoomState): void {
    for (const id of room.members) {
      const m = this.players.get(id);
      if (m) m.ready = false;
    }
  }

  private members(room: RoomState): PlayerState[] {
    const out: PlayerState[] = [];
    for (const id of room.members) {
      const m = this.players.get(id);
      if (m) out.push(m);
    }
    return out;
  }

  // ---- views ----

  private summary(room: RoomState): RoomSummary {
    const c = room.config!;
    return {
      id: c.id,
      name: c.name,
      gameType: c.gameType,
      minPlayers: c.minPlayers,
      maxPlayers: c.maxPlayers,
      status: room.status,
      players: this.members(room).map((m) => ({ ...m.card })),
      sessionId: room.sessionId,
      startedAt: room.startedAt,
      durationSeconds: Math.round(this.config.roundMs / 1000),
      score: room.status === 'waiting' ? null : room.score,
      revision: room.revision,
    };
  }

  private board(): RoomSummary[] {
    return this.config.rooms.map((rc) => this.summary(this.rooms.get(rc.id)!));
  }

  private roomSnapshot(room: RoomState): RoomSnapshot {
    return {
      roomId: room.id,
      summary: room.config ? this.summary(room) : null,
      players: this.members(room).map(presence),
      session: null,
      revision: room.revision,
    };
  }

  private worldSnapshot(p: PlayerState): WorldSnapshot {
    return {
      self: {
        playerId: p.card.id,
        roomId: p.roomId,
        position: p.position ? { ...p.position } : null,
        rotation: p.rotation,
      },
      room: this.roomSnapshot(this.roomOf(p)),
      board: this.board(),
      lastFinished: p.lastFinished,
    };
  }

  // ---- delivery ----

  private send(to: ConnId, message: ServerMessage): void {
    this.outbox.push({ to, message });
  }

  private reply(p: PlayerState, requestId: string, payload: unknown): void {
    if (p.conn !== null) this.send(p.conn, { type: 'request.accepted', requestId, payload });
  }

  /** Sends to every connected member of `room`, optionally skipping one player. */
  private toRoom(room: RoomState, message: ServerMessage, except?: string): void {
    for (const m of this.members(room)) {
      if (m.card.id !== except && m.conn !== null) this.send(m.conn, message);
    }
  }

  /** Sends a game room's summary to every admitted, connected player. */
  private broadcastBoard(room: RoomState): void {
    const message: ServerMessage = { type: 'room.updated', payload: { room: this.summary(room) } };
    for (const p of this.players.values()) {
      if (p.conn !== null) this.send(p.conn, message);
    }
  }
}

function fail(code: ErrorCode, message: string): Result<null> {
  return { data: null, error: { code, message } };
}

function presence(p: PlayerState): Presence {
  return {
    ...p.card,
    position: p.position ? { ...p.position } : null,
    rotation: p.rotation,
    connected: p.conn !== null,
    ready: p.ready,
  };
}

/** Where a room's players move; null when they have no position (a waiting game room). */
function locationOf(room: RoomState): Location | null {
  if (!room.config) return 'courtyard';
  return room.status === 'playing' ? 'arena' : null;
}

function remove(list: string[], id: string): void {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}
