import type {
  CancelReason,
  ClientMessage,
  ErrorCode,
  GameFinished,
  Outcome,
  PlayerCard,
  PortalPartnersState,
  PortalPartnersTarget,
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
  ARENA_GAP_HALF_Z,
  COURTYARD_SPAWN,
  COURTYARD_SPAWN_ROTATION,
  DEFAULT_WORLD_CONFIG,
  type GameRoomConfig,
  type Location,
  type WorldConfig,
} from './config';
import { checkMove, newTracker, type MoveTracker } from './movement';
import {
  arenaBarrier,
  bridgeOpen,
  interact,
  score,
  setBack,
  spawnPositions,
  startRound,
  timeUp,
  type PPRound,
} from './portal-partners';

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
  /** Last accepted arena position outside the bridge gap; decides the side of a set-back. */
  lastOutside: Vec3 | null;
  /** Time of the last handled message, for the idle limit. */
  lastActive: number;
  /** While disconnected: when the grace period runs out. */
  graceUntil: number | null;
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
  round: PPRound | null;
  /** When `game.state` was last sent to the round's players. */
  lastStateAt: number;
}

const STATE_INTERVAL_MS = 1000;

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
        // A takeover is not a disconnect, so nobody else hears about it.
        this.send(existing.conn, { type: 'session.replaced', payload: {} });
        this.closings.push({ conn: existing.conn, reason: 'session.replaced' });
        this.conns.delete(existing.conn);
      }
      const restored = existing.conn === null;
      existing.conn = conn;
      existing.graceUntil = null;
      existing.lastActive = this.now();
      // Move sequences are per connection, so the new one starts its own count.
      if (existing.tracker) existing.tracker = { ...existing.tracker, lastSequence: -1 };
      this.conns.set(conn, player.id);
      if (restored) this.announceConnection(existing, true);
      this.send(conn, { type: 'world.snapshot', payload: this.worldSnapshot(existing) });
      // A ready player in grace blocked the start; their return may complete it.
      if (restored) this.maybeStartRound(this.roomOf(existing));
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
      lastOutside: null,
      lastActive: now,
      graceUntil: null,
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
    p.lastActive = this.now();

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

  /**
   * Unexpected loss of a connection: the player keeps slot, room, position and round for the
   * grace period. Connections already replaced or closed by the world are ignored.
   */
  connectionLost(conn: ConnId): void {
    this.advance();
    const id = this.conns.get(conn);
    const p = id === undefined ? undefined : this.players.get(id);
    if (!p) return;
    this.conns.delete(conn);
    p.conn = null;
    p.graceUntil = this.now() + this.config.graceMs;
    this.announceConnection(p, false);
  }

  /**
   * Runs every due deadline (round time-out, grace expiry, idle limit) in time order, so the
   * earliest one decides, then sends the once-per-second `game.state` for running rounds.
   */
  advance(): void {
    const now = this.now();
    for (let due = this.nextDeadline(now); due; due = this.nextDeadline(now)) due.run();
    for (const room of this.rooms.values()) {
      if (room.round && now - room.lastStateAt >= STATE_INTERVAL_MS) this.sendState(room);
    }
  }

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

  /**
   * Records the save outcome in the participants' `lastFinished`, so a later snapshot shows
   * it. Sends nothing (the adapter sends `result.saved` / `failed`); never downgrades `saved`.
   */
  notePersistence(sessionId: string, status: 'saved' | 'failed'): void {
    for (const p of this.players.values()) {
      const last = p.lastFinished;
      if (!last || last.sessionId !== sessionId || last.persistenceStatus === 'saved') continue;
      p.lastFinished = { ...last, persistenceStatus: status };
    }
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
        return this.handleInteract(p, msg.requestId, msg.payload);
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
    const round = room.round;
    // Every character counts for the plate, including disconnected ones.
    const positions = this.positions(room);
    const openBefore = round ? bridgeOpen(round, positions) : false;
    const barrier = round ? arenaBarrier(round, positions) : undefined;
    const r = checkMove(p.tracker, loc, m.sequence, m.position, m.rotation, this.now(), barrier);
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
    if (round && Math.abs(m.position.z) >= ARENA_GAP_HALF_Z) p.lastOutside = { ...m.position };
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
    if (round) this.bridgeCheck(room, round, openBefore);
  }

  private handleInteract(
    p: PlayerState,
    requestId: string,
    m: { sessionId: string; actionId: string; target: PortalPartnersTarget },
  ) {
    const room = this.roomOf(p);
    const round = room.round;
    if (!round || round.ended || !round.playerIds.includes(p.card.id) || m.sessionId !== round.sessionId) {
      return { code: 'NOT_IN_GAME' as const, message: 'There is no round in progress for you.' };
    }
    const positions = new Map<string, Vec3>();
    const connected = new Map<string, boolean>();
    for (const member of this.members(room)) {
      if (member.position) positions.set(member.card.id, member.position);
      connected.set(member.card.id, member.conn !== null);
    }
    const latchedBefore = round.latched;
    const scoreBefore = score(round);
    const r = interact(round, p.card.id, m.actionId, m.target, positions, connected);
    if (!r.ok) return { code: r.code, message: r.message };

    this.reply(p, requestId, null);
    if (r.won) {
      this.finishRound(room, 'win', null);
      return null;
    }
    const scored = score(round) !== scoreBefore;
    if (scored || round.latched !== latchedBefore) {
      room.revision++;
      this.sendState(room);
    }
    if (scored) {
      room.score = score(round);
      this.broadcastBoard(room);
    }
    return null;
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
    const cleared = this.resetReady(room);
    room.revision++;
    p.roomId = room.id;
    p.position = null;
    p.tracker = null;

    this.toRoom(lobby, { type: 'player.left', payload: { playerId: p.card.id, reason: 'moved', revision: lobby.revision } });
    this.toRoom(room, { type: 'player.joined', payload: { player: presence(p), revision: room.revision } }, p.card.id);
    // The joiner's reply (the new room's snapshot) goes before the resets, so they follow it.
    this.reply(p, requestId, this.roomSnapshot(room));
    this.announceReset(room, cleared);
    this.broadcastBoard(room);
    return null;
  }

  private leaveRoom(p: PlayerState, requestId: string) {
    const room = this.roomOf(p);
    if (!room.config) return { code: 'INVALID_ACTION' as const, message: 'You are not in a game room.' };

    this.cancelRoundOf(p, 'left');
    remove(room.members, p.card.id);
    const cleared = this.resetReady(room);
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
    this.announceReset(room, cleared);
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
      this.toRoom(room, { type: 'player.ready', payload: { playerId: p.card.id, ready, revision: room.revision } });
    }
    this.reply(p, requestId, null);
    this.maybeStartRound(room);
    return null;
  }

  private leaveWorld(p: PlayerState, requestId: string): void {
    const conn = p.conn;
    this.reply(p, requestId, null);
    if (conn !== null) {
      this.closings.push({ conn, reason: 'left' });
      this.conns.delete(conn);
    }
    this.cancelRoundOf(p, 'left');
    this.removePlayer(p, 'left');
  }

  // ---- rounds ----

  /** Starts exactly one round when a waiting room holds two players who are all ready and connected. */
  private maybeStartRound(room: RoomState): void {
    const c = room.config;
    const ms = this.members(room);
    if (!c || room.status !== 'waiting' || ms.length < c.minPlayers || !ms.every((m) => m.ready && m.conn !== null)) return;
    const [a, b] = ms;
    if (!a || !b || ms.length !== 2) return;

    const now = this.now();
    const sessionId = this.newId();
    room.round = startRound(sessionId, [a.card.id, b.card.id], now);
    room.status = 'playing';
    room.sessionId = sessionId;
    room.startedAt = iso(now);
    room.score = 0;
    const spawns = spawnPositions();
    [a, b].forEach((m, i) => {
      const at = spawns[i]!;
      m.position = { ...at };
      m.tracker = newTracker({ ...at }, m.rotation, now, 'arena');
      m.lastOutside = { ...at };
    });
    room.revision++;
    const snapshot: ServerMessage = { type: 'room.snapshot', payload: this.roomSnapshot(room) };
    for (const m of [a, b]) if (m.conn !== null) this.send(m.conn, snapshot);
    this.sendState(room);
    this.broadcastBoard(room);
  }

  /**
   * Ends the room's round: tells its connected players (except `except`), records the
   * FinishedRound, and returns the room to waiting with readiness reset and positions cleared.
   */
  private finishRound(room: RoomState, outcome: Outcome, cancelReason: CancelReason | null, except?: string): void {
    const round = room.round!;
    round.ended = true;
    const result: GameFinished = {
      sessionId: round.sessionId,
      outcome,
      score: score(round),
      persistenceStatus: 'pending',
      ...(cancelReason ? { reason: cancelReason } : {}),
    };
    for (const id of round.playerIds) {
      const m = this.players.get(id);
      if (!m) continue;
      m.lastFinished = { ...result };
      if (m.conn !== null && id !== except) this.send(m.conn, { type: 'game.finished', payload: { ...result } });
    }
    this.finished.push({
      sessionId: round.sessionId,
      playerIds: [...round.playerIds],
      outcome,
      cancelReason,
      score: result.score,
      startedAt: room.startedAt!,
      completedAt: iso(this.now()),
    });

    room.round = null;
    room.status = 'waiting';
    room.sessionId = null;
    room.startedAt = null;
    room.score = null;
    for (const m of this.members(room)) {
      m.position = null;
      m.tracker = null;
      m.lastOutside = null;
    }
    const cleared = this.resetReady(room);
    room.revision++;
    this.announceReset(room, cleared);
    this.broadcastBoard(room);
  }

  /** Cancels the round `p` is playing in, if any; `p` is not sent the result. */
  private cancelRoundOf(p: PlayerState, reason: CancelReason): void {
    const room = this.roomOf(p);
    if (room.round?.playerIds.includes(p.card.id)) this.finishRound(room, 'cancelled', reason, p.card.id);
  }

  /**
   * After something that may change the bridge: on open -> closed, every character in the gap
   * is set back to the side it entered from. Any change sends `game.state`.
   */
  private bridgeCheck(room: RoomState, round: PPRound, openBefore: boolean): void {
    const openNow = bridgeOpen(round, this.positions(room));
    if (openNow === openBefore) return;
    if (!openNow) {
      for (const m of this.members(room)) {
        if (!m.position || !m.tracker || !m.lastOutside || Math.abs(m.position.z) >= ARENA_GAP_HALF_Z) continue;
        const to = setBack(m.position, m.lastOutside);
        m.position = to;
        m.tracker = { ...m.tracker, position: { ...to } };
        room.revision++;
        const sequence = m.tracker.lastSequence;
        if (m.conn !== null) {
          this.send(m.conn, {
            type: 'player.corrected',
            payload: { sequence, position: { ...to }, rotation: m.rotation, reason: 'bridgeClosed' },
          });
        }
        this.toRoom(
          room,
          {
            type: 'player.updated',
            payload: { playerId: m.card.id, position: { ...to }, rotation: m.rotation, sequence, revision: room.revision },
          },
          m.card.id,
        );
      }
    }
    this.sendState(room);
  }

  private sendState(room: RoomState): void {
    const round = room.round!;
    const now = this.now();
    room.lastStateAt = now;
    const message: ServerMessage = {
      type: 'game.state',
      payload: { sessionId: round.sessionId, revision: room.revision, state: this.gameState(room) },
    };
    for (const id of round.playerIds) {
      const m = this.players.get(id);
      if (m?.conn) this.send(m.conn, message);
    }
  }

  // ---- deadlines ----

  /** The earliest due deadline; ties go to round time-outs, then grace, then idle. */
  private nextDeadline(now: number): { run: () => void } | null {
    let best: { at: number; rank: number; run: () => void } | null = null;
    const consider = (at: number, rank: number, run: () => void) => {
      if (at > now) return;
      if (!best || at < best.at || (at === best.at && rank < best.rank)) best = { at, rank, run };
    };
    for (const room of this.rooms.values()) {
      const round = room.round;
      if (round && timeUp(round, now, this.config.roundMs)) {
        consider(round.startedAt + this.config.roundMs, 0, () => this.finishRound(room, 'loss', null));
      }
    }
    for (const p of this.players.values()) {
      if (p.graceUntil !== null) consider(p.graceUntil, 1, () => this.expireGrace(p));
      else if (p.conn !== null) consider(p.lastActive + this.config.idleMs, 2, () => this.expireIdle(p));
    }
    return best;
  }

  private expireGrace(p: PlayerState): void {
    p.graceUntil = null;
    this.cancelRoundOf(p, 'disconnected');
    this.removePlayer(p, 'disconnected');
  }

  /** The idle limit frees the slot at once, with no grace. */
  private expireIdle(p: PlayerState): void {
    const conn = p.conn!;
    this.closings.push({ conn, reason: 'idle' });
    this.conns.delete(conn);
    p.conn = null;
    this.cancelRoundOf(p, 'disconnected');
    this.removePlayer(p, 'idle');
  }

  private announceConnection(p: PlayerState, connected: boolean): void {
    const room = this.roomOf(p);
    room.revision++;
    this.toRoom(
      room,
      { type: 'player.connection', payload: { playerId: p.card.id, connected, revision: room.revision } },
      p.card.id,
    );
  }

  // ---- state helpers ----

  private removePlayer(p: PlayerState, reason: 'left' | 'disconnected' | 'idle'): void {
    const room = this.roomOf(p);
    remove(room.members, p.card.id);
    const cleared = room.config ? this.resetReady(room) : [];
    room.revision++;
    this.players.delete(p.card.id);
    this.toRoom(room, { type: 'player.left', payload: { playerId: p.card.id, reason, revision: room.revision } });
    this.announceReset(room, cleared);
    if (room.config) this.broadcastBoard(room);
  }

  private newRoom(id: RoomId, config: GameRoomConfig | null): RoomState {
    return {
      id,
      config,
      members: [],
      revision: 0,
      status: 'waiting',
      sessionId: null,
      startedAt: null,
      score: null,
      round: null,
      lastStateAt: 0,
    };
  }

  /** Accepted positions of every character in the room, connected or not. */
  private positions(room: RoomState): Vec3[] {
    const out: Vec3[] = [];
    for (const m of this.members(room)) if (m.position) out.push(m.position);
    return out;
  }

  private gameState(room: RoomState): PortalPartnersState {
    const round = room.round!;
    return {
      bridgeOpen: bridgeOpen(round, this.positions(room)),
      latched: round.latched,
      crystals: [round.crystals[0], round.crystals[1]],
      startedAt: room.startedAt!,
      durationSeconds: Math.round(this.config.roundMs / 1000),
      serverTime: iso(this.now()),
    };
  }

  private lobby(): RoomState {
    return this.rooms.get(LOBBY)!;
  }

  private roomOf(p: PlayerState): RoomState {
    return this.rooms.get(p.roomId)!;
  }

  /** Clears every member's ready flag; returns the ids whose flag was actually cleared. */
  private resetReady(room: RoomState): string[] {
    const cleared: string[] = [];
    for (const id of room.members) {
      const m = this.players.get(id);
      if (m?.ready) {
        m.ready = false;
        cleared.push(id);
      }
    }
    return cleared;
  }

  /** Announces readiness resets to the whole room, at the room's current revision. */
  private announceReset(room: RoomState, cleared: string[]): void {
    for (const playerId of cleared) {
      this.toRoom(room, { type: 'player.ready', payload: { playerId, ready: false, revision: room.revision } });
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
      session: room.round ? { sessionId: room.round.sessionId, ...this.gameState(room) } : null,
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

function iso(ms: number): string {
  return new Date(ms).toISOString();
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
