import type {
  CancelReason,
  ClientMessage,
  CorrectionReason,
  ErrorCode,
  GameFinished,
  GameType,
  GameStatePayload,
  Outcome,
  PlayerCard,
  Presence,
  Result,
  RoomId,
  RoomSnapshot,
  RoomSummary,
  GameStateBase,
  ServerMessage,
  Vec3,
  WorldSnapshot,
} from '../contracts';
import {
  COURTYARD_SPAWN,
  COURTYARD_SPAWN_ROTATION,
  DEFAULT_WORLD_CONFIG,
  type GameRoomConfig,
  type WorldConfig,
} from './config';
import type { Effect, GameModule, RoundPlayer, RoundView } from './games/types';
import {
  COURTYARD_AREA,
  checkMove,
  inBounds,
  newTracker,
  type MoveArea,
  type MoveTracker,
  type PathCheck,
} from './movement';

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
  gameType: GameType;
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
  /** Reports a game module bug (for example an override outside the arena). Default: ignored. */
  onModuleError?: (message: string) => void;
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
  round: Round | null;
  /** Rounds started in this room so far; the next round's number. */
  roundsStarted: number;
  /** When `game.state` was last sent to the round's players. */
  lastStateAt: number;
}

type ActionReply = { ok: true } | { ok: false; code: ErrorCode; message: string };

/** A running round: the game module, its own state, and the engine's bookkeeping. */
interface Round {
  game: GameModule;
  /** The module's round state; only the module reads or changes it. */
  state: unknown;
  sessionId: string;
  playerIds: [string, string];
  startedAt: number;
  /** Replies by actionId, so a repeated action gets the first reply again. */
  actions: Map<string, ActionReply>;
  /** The last out-of-range score reported, so a persistent one is reported once. */
  badScore: number | null;
  /** The last bad speed reported (not finite or negative), so a persistent one is reported once. */
  badSpeed: number | null;
}

const STATE_INTERVAL_MS = 1000;

/** Returned by a guarded hook call that threw: the round has already been cancelled with `error`. */
const ABORTED: unique symbol = Symbol('aborted');
type Aborted = typeof ABORTED;

/**
 * The platform-free world engine. Callers feed it admitted connections and parsed client
 * messages, then drain the outbox, closings and finished rounds. Time comes only from `now()`.
 */
export class World {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly config: WorldConfig;
  private readonly onModuleError: (message: string) => void;
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
    this.onModuleError = opts.onModuleError ?? (() => {});
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
      // The game hears about the return after the player has their snapshot.
      if (restored) this.notifyConnection(existing, true);
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
    this.notifyConnection(p, false);
  }

  /**
   * Runs each playing round's `tick` first (so a win due by `now` beats the time-out), then
   * every due deadline (round time-out, grace expiry, idle limit) in time order, so the
   * earliest one decides, then sends the once-per-second `game.state` for running rounds.
   */
  advance(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const round = room.round;
      if (!round?.game.tick) continue;
      const view = this.roundView(round);
      const effect = this.guarded(room, 'tick', () => round.game.tick!(round.state, view));
      if (effect !== ABORTED) this.applyEffect(room, effect, 'other');
    }
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
    const round = room.round;
    // Waiting rooms have no positions: there is nothing to move or correct to.
    if (!p.tracker || (room.config && !round)) return;
    let area: MoveArea = COURTYARD_AREA;
    let path: PathCheck | undefined;
    let aborted = false;
    if (round) {
      // Every character counts for the game, including disconnected ones.
      const { game, state } = round;
      const view = this.roundView(round);
      const speed = this.speedOf(room, round, view, p.card.id);
      if (speed === ABORTED) return;
      area = { bounds: arenaBounds(game), speed };
      path = (f, t) => {
        const verdict = this.guarded(room, 'checkMove', () => game.checkMove(state, view, p.card.id, f, t));
        if (verdict !== ABORTED) return verdict;
        aborted = true;
        return 'ignore';
      };
    }
    const r = checkMove(p.tracker, area, m.sequence, m.position, m.rotation, this.now(), path);
    if (aborted || r.kind === 'stale') return;
    p.tracker = r.tracker;
    if (r.kind === 'ignored') return;
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
    if (round?.game.afterMove) {
      // The view now holds the mover's new accepted position.
      const view = this.roundView(round);
      const effect = this.guarded(room, 'afterMove', () => round.game.afterMove!(round.state, view, p.card.id));
      if (effect !== ABORTED) this.applyEffect(room, effect, 'afterMove');
    }
  }

  private handleInteract(
    p: PlayerState,
    requestId: string,
    m: { sessionId: string; actionId: string; target: string },
  ): { code: ErrorCode; message: string } | null {
    const room = this.roomOf(p);
    // The parser accepts any well-formed target; the room's game decides which ones it knows.
    if (room.config && !room.config.game.targets.includes(m.target)) {
      return { code: 'VALIDATION_ERROR', message: 'Interaction target is invalid.' };
    }
    const round = room.round;
    if (!round || !round.playerIds.includes(p.card.id) || m.sessionId !== round.sessionId) {
      return { code: 'NOT_IN_GAME', message: 'There is no round in progress for you.' };
    }
    const prior = round.actions.get(m.actionId);
    if (prior) return this.replyAction(p, requestId, prior);

    const view = this.roundView(round);
    const r = this.guarded(room, 'interact', () => round.game.interact(round.state, view, p.card.id, m.target));
    if (r === ABORTED) return { code: 'NOT_IN_GAME', message: 'The round ended because of a game error.' };
    const reply: ActionReply = r.ok ? { ok: true } : { ok: false, code: 'INVALID_ACTION', message: r.message };
    round.actions.set(m.actionId, reply);
    // The reply goes before anything the action causes.
    const err = this.replyAction(p, requestId, reply);
    // Applied even with no effect, so a score change still reaches the board.
    if (r.ok) this.applyEffect(room, r.effect ?? {}, 'other');
    return err;
  }

  /** Sends `request.accepted` for a successful action; returns the error for a failed one. */
  private replyAction(p: PlayerState, requestId: string, reply: ActionReply): { code: ErrorCode; message: string } | null {
    if (!reply.ok) return { code: reply.code, message: reply.message };
    this.reply(p, requestId, null);
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
    const game = c.game;
    const startArea: MoveArea = { bounds: arenaBounds(game), speed: game.arena.speed };
    [a, b].forEach((m, i) => {
      const at = game.spawns[i]!;
      m.position = { ...at };
      m.tracker = newTracker({ ...at }, m.rotation, now, startArea);
    });
    const round: Round = {
      game,
      state: undefined,
      sessionId,
      playerIds: [a.card.id, b.card.id],
      startedAt: now,
      actions: new Map(),
      badScore: null,
      badSpeed: null,
    };
    // The room holds the round before `start` runs, so a throwing `start` can cancel it.
    room.round = round;
    room.status = 'playing';
    room.sessionId = sessionId;
    room.startedAt = iso(now);
    const view = this.roundView(round);
    const roundNumber = room.roundsStarted++;
    const state = this.guarded(room, 'start', () => game.start(view, roundNumber));
    if (state === ABORTED) return;
    round.state = state;
    const score = this.scoreOf(room, round);
    if (score === ABORTED) return;
    room.score = score;
    room.revision++;
    const payload = this.roomSnapshot(room);
    // The snapshot's `view` threw: the round is already cancelled.
    if (room.round !== round) return;
    const snapshot: ServerMessage = { type: 'room.snapshot', payload };
    for (const m of [a, b]) if (m.conn !== null) this.send(m.conn, snapshot);
    if (!this.sendState(room)) return;
    this.broadcastBoard(room);
  }

  /**
   * Ends the room's round: tells its connected players (except `except`), records the
   * FinishedRound, and returns the room to waiting with readiness reset and positions cleared.
   * The score is `fixedScore` when given, otherwise the game's; if `score` throws, the round is
   * cancelled with `error` instead.
   */
  private finishRound(
    room: RoomState,
    outcome: Outcome,
    cancelReason: CancelReason | null,
    except?: string,
    fixedScore?: number,
  ): void {
    const round = room.round!;
    const score = fixedScore ?? this.scoreOf(room, round, except);
    if (score === ABORTED) return;
    const result: GameFinished = {
      sessionId: round.sessionId,
      outcome,
      score,
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
      gameType: room.config!.game.gameType,
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
    }
    const cleared = this.resetReady(room);
    room.revision++;
    this.announceReset(room, cleared);
    this.broadcastBoard(room);
  }

  /**
   * Runs one game module hook for `room`'s round. If it throws, the round is cancelled with
   * `error` (see `abortRound`) and ABORTED is returned: the caller stops working on that round.
   */
  private guarded<T>(room: RoomState, hook: string, fn: () => T, except?: string): T | Aborted {
    try {
      return fn();
    } catch (err) {
      this.abortRound(room, hook, err, except);
      return ABORTED;
    }
  }

  /**
   * Reports a throwing hook and cancels the round with `error`. The module's state may be
   * half-changed, so it is not asked again: the score is the room's last board score.
   */
  private abortRound(room: RoomState, hook: string, err: unknown, except?: string): void {
    const game = room.round!.game;
    this.onModuleError(`${game.gameType}: ${hook} threw: ${err instanceof Error ? err.message : String(err)}`);
    this.finishRound(room, 'cancelled', 'error', except, room.score ?? 0);
  }

  /** Cancels the round `p` is playing in, if any; `p` is not sent the result. */
  private cancelRoundOf(p: PlayerState, reason: CancelReason): void {
    const room = this.roomOf(p);
    if (room.round?.playerIds.includes(p.card.id)) this.finishRound(room, 'cancelled', reason, p.card.id);
  }

  /**
   * The one place a game's effect is applied: overrides first (each a correction to its player
   * and an update to the others), then the end of the round, then `game.state` and the board.
   * After a move the move's own revision bump covers the state; otherwise a change bumps it here.
   */
  private applyEffect(room: RoomState, effect: Effect, origin: 'afterMove' | 'other'): void {
    const round = room.round!;
    const game = round.game;
    let bumped = false;
    for (const o of effect.overrides ?? []) {
      const m = round.playerIds.includes(o.playerId) ? this.players.get(o.playerId) : undefined;
      if (!m?.position || !m.tracker) {
        this.onModuleError(`${game.gameType}: override for unknown player ${o.playerId}`);
        continue;
      }
      if (!inBounds(arenaBounds(game), o.position)) {
        this.onModuleError(`${game.gameType}: override for ${o.playerId} is outside the arena`);
        continue;
      }
      if (!game.correctionReasons.includes(o.reason as CorrectionReason)) {
        this.onModuleError(`${game.gameType}: override for ${o.playerId} has undeclared reason ${o.reason}`);
        continue;
      }
      if (o.rotation !== undefined && !Number.isFinite(o.rotation)) {
        this.onModuleError(`${game.gameType}: override for ${o.playerId} has a rotation that is not a finite number`);
        continue;
      }
      const to = { ...o.position };
      m.position = to;
      if (o.rotation !== undefined) m.rotation = o.rotation;
      m.tracker = { ...m.tracker, position: { ...to }, rotation: m.rotation };
      room.revision++;
      bumped = true;
      const sequence = m.tracker.lastSequence;
      if (m.conn !== null) {
        this.send(m.conn, {
          type: 'player.corrected',
          payload: { sequence, position: { ...to }, rotation: m.rotation, reason: o.reason as CorrectionReason },
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
    if (effect.end) {
      this.finishRound(room, effect.end, null);
      return;
    }
    const score = this.scoreOf(room, round);
    if (score === ABORTED) return;
    const scored = score !== room.score;
    if (effect.stateChanged || scored) {
      if (origin === 'other' && !bumped) room.revision++;
      if (!this.sendState(room)) return;
    }
    if (scored) {
      room.score = score;
      this.broadcastBoard(room);
    }
  }

  /** Tells the game a round player disconnected or returned in grace. */
  private notifyConnection(p: PlayerState, connected: boolean): void {
    const room = this.roomOf(p);
    const round = room.round;
    if (!round?.game.onConnection || !round.playerIds.includes(p.card.id)) return;
    const view = this.roundView(round);
    const effect = this.guarded(room, 'onConnection', () => round.game.onConnection!(round.state, view, p.card.id, connected));
    if (effect !== ABORTED) this.applyEffect(room, effect, 'other');
  }

  /**
   * The player's speed from the game, or the arena speed when the game has no `speed` hook or
   * returns a bad value (not finite or negative: a module bug, reported). ABORTED if it threw.
   */
  private speedOf(room: RoomState, round: Round, view: RoundView, playerId: string): number | Aborted {
    const game = round.game;
    if (!game.speed) return game.arena.speed;
    const raw = this.guarded(room, 'speed', () => game.speed!(round.state, view, playerId));
    if (raw === ABORTED) return raw;
    if (Number.isFinite(raw) && raw >= 0) return raw;
    if (!Object.is(raw, round.badSpeed)) {
      round.badSpeed = raw;
      this.onModuleError(`${game.gameType}: speed ${raw} for ${playerId} is not a finite, non-negative number`);
    }
    return game.arena.speed;
  }

  /**
   * The game's score clamped to `0..scoreMax`; an out-of-range score is a module bug, reported.
   * ABORTED if `score` threw (`except` is passed on to the cancel).
   */
  private scoreOf(room: RoomState, round: Round, except?: string): number | Aborted {
    const game = round.game;
    const raw = this.guarded(room, 'score', () => game.score(round.state), except);
    if (raw === ABORTED) return raw;
    if (Number.isFinite(raw) && raw >= 0 && raw <= game.scoreMax) return raw;
    if (!Object.is(raw, round.badScore)) {
      round.badScore = raw;
      this.onModuleError(`${game.gameType}: score ${raw} is outside 0..${game.scoreMax}`);
    }
    return Number.isFinite(raw) ? Math.min(game.scoreMax, Math.max(0, raw)) : 0;
  }

  /** A fresh read-only view of the round's two players, in join order. */
  private roundView(round: Round): RoundView {
    const players = round.playerIds.map((id): RoundPlayer => {
      const m = this.players.get(id);
      // Round players keep a position from start to finish; a missing one is an engine bug.
      if (!m?.position) throw new Error(`Engine bug: round player ${id} has no position`);
      return { id, position: { ...m.position }, rotation: m.rotation, connected: m.conn !== null };
    }) as [RoundPlayer, RoundPlayer];
    return {
      players,
      now: this.now(),
      startedAt: round.startedAt,
      player(id) {
        const found = players.find((x) => x.id === id);
        if (!found) throw new Error(`Unknown round player: ${id}`);
        return found;
      },
    };
  }

  /** The round length for a room's game, or the test override when one is set. */
  private roundMsOf(room: RoomState): number {
    return this.config.roundMs ?? room.config!.game.roundMs;
  }

  /** Sends `game.state` to the round's players; false (nothing sent) if `view` threw. */
  private sendState(room: RoomState): boolean {
    const round = room.round!;
    const state = this.gameState(room);
    if (state === ABORTED) return false;
    room.lastStateAt = this.now();
    const message: ServerMessage = {
      type: 'game.state',
      payload: { sessionId: round.sessionId, revision: room.revision, gameType: round.game.gameType, state },
    };
    for (const id of round.playerIds) {
      const m = this.players.get(id);
      if (m?.conn) this.send(m.conn, message);
    }
    return true;
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
      if (round) {
        consider(round.startedAt + this.roundMsOf(room), 0, () => this.finishRound(room, 'loss', null));
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
      roundsStarted: 0,
      lastStateAt: 0,
    };
  }

  /** The round's full game state, or ABORTED if `view` threw. */
  private gameState(room: RoomState): GameStatePayload['state'] | Aborted {
    const round = room.round!;
    const view = this.roundView(round);
    const fields = this.guarded(room, 'view', () => round.game.view(round.state, view));
    if (fields === ABORTED) return fields;
    return {
      ...(fields as Omit<GameStatePayload['state'], keyof GameStateBase>),
      startedAt: room.startedAt!,
      durationSeconds: Math.round(this.roundMsOf(room) / 1000),
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
      name: c.game.name,
      gameType: c.game.gameType,
      minPlayers: c.minPlayers,
      maxPlayers: c.maxPlayers,
      status: room.status,
      players: this.members(room).map((m) => ({ ...m.card })),
      sessionId: room.sessionId,
      startedAt: room.startedAt,
      durationSeconds: Math.round(this.roundMsOf(room) / 1000),
      score: room.status === 'waiting' ? null : room.score,
      revision: room.revision,
    };
  }

  private board(): RoomSummary[] {
    return this.config.rooms.map((rc) => this.summary(this.rooms.get(rc.id)!));
  }

  /** The room as it is now; if the round's `view` throws, the round is cancelled first. */
  private roomSnapshot(room: RoomState): RoomSnapshot {
    const round = room.round;
    // The game state comes first, so a throwing `view` cancels the round before anything is built.
    const state = round ? this.gameState(room) : null;
    if (state === ABORTED) return this.roomSnapshot(room);
    return {
      roomId: room.id,
      summary: room.config ? this.summary(room) : null,
      players: this.members(room).map(presence),
      session: round && state ? { sessionId: round.sessionId, gameType: round.game.gameType, ...state } : null,
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

function arenaBounds(game: GameModule): { halfX: number; halfZ: number } {
  return { halfX: game.arena.halfX, halfZ: game.arena.halfZ };
}

function remove(list: string[], id: string): void {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}
