// The world connection (spec §5.2, §5.6, §8.1, §8.2). One implementation, used by the real
// client (a WebSocket to the runtime) and by the mock (an in-process socket over the same World
// engine), so both behave the same. Public methods return Results and never throw.
//
// Protocol rules followed here:
// - The first message is `auth {token}`; nothing else is sent until `world.snapshot` arrives.
// - Close codes: 1000 with reason session.replaced / idle / left, 4409 WORLD_FULL and 4400
//   (abuse) are final; any other 1000 reconnects. 4401 refreshes the session once per outage and retries. 4503 and abnormal closes
//   retry at 0.5, 1, 2, 4 and 8 s (15.5 s in all, inside the 20 s grace), then give up.
// - `auth.refresh` is sent 60 s before the access token's `exp`.
// - Moves are throttled to at most 20 sends per second; the latest held-back position is sent
//   when the next slot opens.
// - Requests are matched by requestId and time out after 10 s with SERVICE_UNAVAILABLE.
import { ERROR_CODES } from '../contracts/index';
import type {
  AppError,
  ConnectionState,
  ErrorCode,
  PortalPartnersTarget,
  Presence,
  Result,
  RoomId,
  RoomSnapshot,
  ServerEventPayload,
  ServerEventType,
  ServerMessage,
  Vec3,
  WorldCloseReason,
  WorldConnection,
  WorldSnapshot,
} from '../contracts/index';
import { appError } from './errors';

/** The part of the browser WebSocket API the connection uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}

export interface WorldTransport {
  /** Opens a new socket to the world. May throw; that counts as an abnormal close. */
  openSocket(): SocketLike;
  /** The current access token, or null when signed out. */
  getToken(): Promise<string | null>;
  /** Refreshes the session and returns the new access token, or null on failure. */
  refreshToken(): Promise<string | null>;
}

export const RECONNECT_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000];
export const REQUEST_TIMEOUT_MS = 10_000;
export const REFRESH_LEAD_MS = 60_000;
/** Lower bound between refreshes, so a very short-lived token cannot cause a tight loop. */
const MIN_REFRESH_DELAY_MS = 1_000;
/** At most 20 moves per second (the runtime drops more): one send per 50 ms. */
export const MOVE_INTERVAL_MS = 50;
/** 1000 closes with these reasons end the connection; any other 1000 reconnects. */
const FINAL_NORMAL_REASONS: readonly string[] = ['session.replaced', 'idle', 'left'];

/** Close codes used by the runtime (runtime/src/world-object.ts). */
export const CLOSE_CODES = {
  normal: 1000,
  invalid: 4400,
  unauthorized: 4401,
  worldFull: 4409,
  unavailable: 4503,
} as const;

const TARGETS: readonly string[] = ['lever', 'crystal-a', 'crystal-b', 'exit'];

const ok = <T>(data: T): Result<T> => ({ data, error: null });
const failWith = <T>(error: AppError): Result<T> => ({ data: null, error });
const fail = <T>(...args: Parameters<typeof appError>): Result<T> => failWith(appError(...args));

const newId = () => globalThis.crypto.randomUUID();
const clone = <T>(x: T): T => structuredClone(x);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const isErrorCode = (x: unknown): x is ErrorCode =>
  typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);

function toAppError(x: unknown): AppError {
  if (isRecord(x) && isErrorCode(x.code)) {
    return appError(x.code, undefined, typeof x.message === 'string' ? x.message : undefined);
  }
  return appError('SERVICE_UNAVAILABLE');
}

function isVec3(x: unknown): x is Vec3 {
  return isRecord(x) && [x.x, x.y, x.z].every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isRoomSnapshot(x: unknown): x is RoomSnapshot {
  return isRecord(x) && typeof x.roomId === 'string' && Array.isArray(x.players) && typeof x.revision === 'number';
}

function isWorldSnapshot(x: unknown): x is WorldSnapshot {
  return isRecord(x) && isRecord(x.self) && typeof x.self.playerId === 'string' && isRoomSnapshot(x.room) && Array.isArray(x.board);
}

/** Why a final close ended the connection (a 1000 reason or a close code). */
function finalCloseReason(code: number, reason: string): WorldCloseReason {
  if (code === CLOSE_CODES.normal) {
    if (reason === 'session.replaced') return 'replaced';
    if (reason === 'idle') return 'idle';
    if (reason === 'left') return 'left';
  }
  switch (code) {
    case CLOSE_CODES.unauthorized:
      return 'unauthorized';
    case CLOSE_CODES.worldFull:
      return 'worldFull';
    case CLOSE_CODES.invalid:
      return 'invalid';
    default:
      return 'unavailable';
  }
}

/** The error a close code stands for, when no `request.error` explained it. */
function closeError(code: number): AppError {
  switch (code) {
    case CLOSE_CODES.unauthorized:
      return appError('UNAUTHORIZED');
    case CLOSE_CODES.worldFull:
      return appError('WORLD_FULL');
    case CLOSE_CODES.invalid:
      return appError('VALIDATION_ERROR');
    default:
      return appError('SERVICE_UNAVAILABLE');
  }
}

/** The access token's `exp` in milliseconds, read without verifying; null if unreadable. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const claims: unknown = JSON.parse(atob(b64));
    return isRecord(claims) && typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const RESULTS_DEFAULT_LIMIT = 20;
export const RESULTS_MAX_LIMIT = 50;

/** Checks getMyResults input the same way in the real client and the mock. */
export function validateResultsQuery(
  input: unknown,
): { ok: true; limit: number; cursor: string | null } | { ok: false; error: AppError } {
  const { limit, cursor } = (isRecord(input) ? input : {}) as { limit?: unknown; cursor?: unknown };
  const n = limit === undefined ? RESULTS_DEFAULT_LIMIT : limit;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > RESULTS_MAX_LIMIT) {
    return { ok: false, error: appError('VALIDATION_ERROR', undefined, 'The limit must be between 1 and 50.') };
  }
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length === 0)) {
    return { ok: false, error: appError('VALIDATION_ERROR', undefined, 'The cursor is not valid.') };
  }
  return { ok: true, limit: n, cursor: typeof cursor === 'string' ? cursor : null };
}

interface Pending {
  resolve: (r: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Runs synchronously when the reply arrives, before any later message is applied. */
  onAccepted?: (payload: unknown) => void;
}

type Listener = (payload: unknown) => void;

class Connection implements WorldConnection {
  playerId = '';
  closeReason: WorldCloseReason | null = null;
  private current: ConnectionState = 'connecting';
  private snap: WorldSnapshot | null = null;
  private ws: SocketLike | null = null;
  /** True once this socket's `world.snapshot` arrived. */
  private admitted = false;
  private authRequestId: string | null = null;
  private authError: AppError | null = null;
  private token: string | null = null;
  /** Reconnect attempts used in the current outage. */
  private attempts = 0;
  private refreshedThisOutage = false;
  private everConnected = false;
  private final = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private heldMove: { at: Vec3; rotation: number } | null = null;
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private readonly pending = new Map<string, Pending>();
  private moveSequence = 0;
  private readonly listeners = new Map<ServerEventType, Set<Listener>>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();

  constructor(
    private readonly transport: WorldTransport,
    private settleFirst: ((r: Result<WorldConnection>) => void) | null,
  ) {}

  get state(): ConnectionState {
    return this.current;
  }

  // ---- public API ----

  snapshot(): WorldSnapshot {
    return clone(this.snap as WorldSnapshot);
  }

  async joinRoom(roomId: RoomId): Promise<Result<RoomSnapshot>> {
    try {
      if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 64) {
        return fail('VALIDATION_ERROR', undefined, 'Room id is invalid.');
      }
      return await this.roomRequest('room.join', { roomId });
    } catch {
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  async leaveRoom(): Promise<Result<RoomSnapshot>> {
    try {
      return await this.roomRequest('room.leave', {});
    } catch {
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  async setReady(ready: boolean): Promise<Result<null>> {
    try {
      if (typeof ready !== 'boolean') return fail('VALIDATION_ERROR', undefined, 'Ready must be true or false.');
      const r = await this.request('game.ready', { ready });
      return r.error ? failWith(r.error) : ok(null);
    } catch {
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  async interact(target: PortalPartnersTarget): Promise<Result<null>> {
    try {
      if (typeof target !== 'string' || !TARGETS.includes(target)) {
        return fail('VALIDATION_ERROR', undefined, 'Interaction target is invalid.');
      }
      const session = this.snap?.room.session;
      if (!session) return fail('NOT_IN_GAME', undefined, 'There is no round in progress for you.');
      const r = await this.request('game.interact', { sessionId: session.sessionId, actionId: newId(), target });
      return r.error ? failWith(r.error) : ok(null);
    } catch {
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  async leaveWorld(): Promise<Result<null>> {
    try {
      if (this.final) return ok(null);
      if (this.current !== 'connected') {
        // Not admitted right now: stop reconnecting; the server's grace period frees the slot.
        this.finish(null, 'left');
        return ok(null);
      }
      const r = await this.request('world.leave', {});
      this.finish(null, 'left');
      return r.error ? failWith(r.error) : ok(null);
    } catch {
      this.finish(null, 'left');
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  sendMove(position: Vec3, rotation: number): void {
    try {
      if (!this.ws || !this.admitted || this.current !== 'connected' || !this.snap?.self.position) return;
      if (!isVec3(position) || typeof rotation !== 'number' || !Number.isFinite(rotation)) return;
      const at = { x: position.x, y: position.y, z: position.z };
      const wait = this.lastMoveAt + MOVE_INTERVAL_MS - Date.now();
      if (wait <= 0 && this.moveTimer === null) {
        this.transmitMove(at, rotation);
        return;
      }
      // Throttled: keep only the latest position and send it when the next slot opens.
      this.heldMove = { at, rotation };
      this.moveTimer ??= setTimeout(() => {
        this.moveTimer = null;
        const held = this.heldMove;
        this.heldMove = null;
        if (held) this.transmitMove(held.at, held.rotation);
      }, Math.max(0, wait));
    } catch {
      // Never throw.
    }
  }

  private transmitMove(at: Vec3, rotation: number): void {
    try {
      const ws = this.ws;
      const snap = this.snap;
      if (!ws || !this.admitted || this.current !== 'connected' || !snap?.self.position) return;
      this.raw(ws, { type: 'player.move', payload: { sequence: ++this.moveSequence, position: at, rotation } });
      this.lastMoveAt = Date.now();
      // The server does not echo accepted moves: our own position is the last one sent.
      snap.self.position = { ...at };
      snap.self.rotation = rotation;
      const me = snap.room.players.find((p) => p.id === this.playerId);
      if (me) {
        me.position = { ...at };
        me.rotation = rotation;
      }
    } catch {
      // Never throw.
    }
  }

  on<K extends ServerEventType>(type: K, cb: (p: ServerEventPayload<K>) => void): () => void {
    try {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      const listener = cb as Listener;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    } catch {
      return () => {};
    }
  }

  onConnectionState(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  // ---- connecting ----

  async attempt(): Promise<void> {
    this.retryTimer = null;
    let token: string | null = null;
    try {
      token = await this.transport.getToken();
    } catch {
      token = null;
    }
    if (this.final) return;
    if (!token) {
      this.finish(appError('UNAUTHORIZED'), 'unauthorized');
      return;
    }
    this.token = token;

    let ws: SocketLike;
    try {
      ws = this.transport.openSocket();
    } catch {
      this.dropped(1006, '');
      return;
    }
    this.ws = ws;
    this.admitted = false;
    this.authError = null;
    const requestId = newId();
    this.authRequestId = requestId;
    ws.onopen = () => {
      // Nothing but `auth` until world.snapshot arrives.
      if (this.ws === ws) this.raw(ws, { type: 'auth', requestId, payload: { token } });
    };
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.receive(ev?.data);
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.dropped(typeof ev?.code === 'number' ? ev.code : 1006, typeof ev?.reason === 'string' ? ev.reason : '');
    };
    ws.onerror = () => {
      // A close event always follows.
    };
    this.authTimer = setTimeout(() => {
      if (this.ws !== ws || this.admitted) return;
      this.detach(ws);
      this.dropped(CLOSE_CODES.unavailable, '');
    }, REQUEST_TIMEOUT_MS);
  }

  /** The current socket closed (or never opened). Decides between retrying and giving up. */
  private dropped(code: number, reason: string): void {
    const err = this.authError ?? closeError(code);
    this.ws = null;
    this.admitted = false;
    this.authError = null;
    this.clearTimer('authTimer');
    this.clearTimer('refreshTimer');
    this.clearTimer('moveTimer');
    this.heldMove = null;
    this.failPending();
    if (this.final) return;

    const finalNormal = code === CLOSE_CODES.normal && FINAL_NORMAL_REASONS.includes(reason);
    if (finalNormal || code === CLOSE_CODES.worldFull || code === CLOSE_CODES.invalid) {
      this.finish(err, finalCloseReason(code, reason));
      return;
    }
    if (code === CLOSE_CODES.unauthorized) {
      if (this.refreshedThisOutage) {
        this.finish(err, 'unauthorized');
        return;
      }
      this.refreshedThisOutage = true;
      if (this.everConnected) this.setState('reconnecting');
      void this.refreshThenRetry(err);
      return;
    }
    // The first connection does not retry: connectWorld reports the failure instead.
    if (!this.everConnected) {
      this.finish(err, finalCloseReason(code, reason));
      return;
    }
    this.scheduleRetry(err);
  }

  private async refreshThenRetry(err: AppError): Promise<void> {
    try {
      await this.transport.refreshToken();
    } catch {
      // The next attempt reads whatever token there is.
    }
    if (this.final) return;
    if (this.everConnected) this.scheduleRetry(err);
    else void this.attempt();
  }

  private scheduleRetry(err: AppError): void {
    const delay = RECONNECT_DELAYS_MS[this.attempts];
    if (delay === undefined) {
      this.finish(err, 'lost');
      return;
    }
    this.attempts++;
    this.setState('reconnecting');
    this.retryTimer = setTimeout(() => void this.attempt(), delay);
  }

  /**
   * Ends the connection for good. `err` is reported to connectWorld if it is still waiting;
   * `reason` is set before the `closed` state is emitted.
   */
  private finish(err: AppError | null, reason: WorldCloseReason): void {
    if (this.final) return;
    this.final = true;
    this.closeReason = reason;
    this.clearTimer('retryTimer');
    this.clearTimer('refreshTimer');
    this.clearTimer('authTimer');
    this.clearTimer('moveTimer');
    this.heldMove = null;
    this.failPending();
    const ws = this.ws;
    this.ws = null;
    this.admitted = false;
    if (ws) {
      this.detach(ws);
    }
    if (this.settleFirst) {
      const settle = this.settleFirst;
      this.settleFirst = null;
      settle(failWith(err ?? appError('SERVICE_UNAVAILABLE')));
    }
    this.setState('closed');
  }

  private detach(ws: SocketLike): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close(CLOSE_CODES.normal);
    } catch {
      // Already closed.
    }
  }

  // ---- token refresh ----

  private scheduleRefresh(): void {
    this.clearTimer('refreshTimer');
    const exp = this.token ? tokenExpiry(this.token) : null;
    if (exp === null) return;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, exp - REFRESH_LEAD_MS - Date.now());
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    this.refreshTimer = null;
    let token: string | null = null;
    try {
      token = await this.transport.refreshToken();
    } catch {
      token = null;
    }
    // On failure the server closes with 4401 at expiry, and that path refreshes and reconnects.
    if (!token || this.final || !this.admitted) return;
    this.token = token;
    await this.request('auth.refresh', { token });
    if (!this.final && this.admitted && this.token === token) this.scheduleRefresh();
  }

  // ---- messages ----

  private raw(ws: SocketLike, message: unknown): boolean {
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private request(
    type: string,
    payload: Record<string, unknown>,
    onAccepted?: (payload: unknown) => void,
  ): Promise<Result<unknown>> {
    const ws = this.ws;
    if (!ws || !this.admitted || this.current !== 'connected') {
      return Promise.resolve(fail('SERVICE_UNAVAILABLE'));
    }
    const requestId = newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) resolve(fail('SERVICE_UNAVAILABLE'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer, ...(onAccepted ? { onAccepted } : {}) });
      if (!this.raw(ws, { type, requestId, payload })) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(fail('SERVICE_UNAVAILABLE'));
      }
    });
  }

  /** room.join / room.leave: the reply is the new room's snapshot, applied as it arrives. */
  private async roomRequest(type: 'room.join' | 'room.leave', payload: Record<string, unknown>) {
    let room: RoomSnapshot | null = null;
    const r = await this.request(type, payload, (data) => {
      if (isRoomSnapshot(data)) {
        room = clone(data);
        this.applyRoomSnapshot(data);
      }
    });
    if (r.error) return failWith<RoomSnapshot>(r.error);
    return room ? ok<RoomSnapshot>(room) : fail<RoomSnapshot>('SERVICE_UNAVAILABLE');
  }

  private failPending(): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      clearTimeout(p.timer);
      p.resolve(fail('SERVICE_UNAVAILABLE'));
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(msg) || typeof msg.type !== 'string') return;

    if (!this.admitted) {
      if (msg.type === 'world.snapshot' && isWorldSnapshot(msg.payload)) {
        this.admit(msg.payload);
      } else if (msg.type === 'request.error' && (msg.requestId === this.authRequestId || msg.requestId === null)) {
        this.authError = toAppError(msg.error);
      }
      return;
    }

    if (msg.type === 'request.accepted' || msg.type === 'request.error') {
      const p = typeof msg.requestId === 'string' ? this.pending.get(msg.requestId) : undefined;
      if (!p) return;
      this.pending.delete(msg.requestId as string);
      clearTimeout(p.timer);
      if (msg.type === 'request.accepted') {
        try {
          p.onAccepted?.(msg.payload);
        } catch {
          // Never throw from message handling.
        }
        p.resolve(ok(msg.payload));
      } else {
        p.resolve(failWith(toAppError(msg.error)));
      }
      return;
    }

    if (!isRecord(msg.payload)) return;
    const event = msg as Extract<ServerMessage, { type: ServerEventType }>;
    try {
      this.apply(event);
    } catch {
      // A malformed event must not break the connection.
    }
    this.emit(event.type, event.payload);
  }

  private admit(snapshot: WorldSnapshot): void {
    this.clearTimer('authTimer');
    // A reconnect must come back as the same player (another account signed in meanwhile).
    if (this.everConnected && snapshot.self.playerId !== this.playerId) {
      this.finish(appError('UNAUTHORIZED'), 'unauthorized');
      return;
    }
    this.admitted = true;
    this.snap = snapshot;
    this.playerId = snapshot.self.playerId;
    this.attempts = 0;
    this.refreshedThisOutage = false;
    this.everConnected = true;
    this.scheduleRefresh();
    this.setState('connected');
    if (this.settleFirst) {
      const settle = this.settleFirst;
      this.settleFirst = null;
      settle(ok(this));
    }
    this.emit('world.snapshot', snapshot);
  }

  private applyRoomSnapshot(rs: RoomSnapshot): void {
    const s = this.snap!;
    s.room = clone(rs);
    s.self.roomId = rs.roomId;
    const me = rs.players.find((p) => p.id === s.self.playerId);
    s.self.position = me?.position ? { ...me.position } : null;
    if (me) s.self.rotation = me.rotation;
  }

  /** Keeps the snapshot current. Room events older than the room's revision are ignored. */
  private apply(msg: ServerMessage): void {
    const s = this.snap!;
    const room = s.room;
    const fresh = (revision: number) => {
      if (revision < room.revision) return false;
      room.revision = revision;
      return true;
    };
    const presence = (id: string): Presence | undefined => room.players.find((p) => p.id === id);

    switch (msg.type) {
      case 'world.snapshot':
        this.snap = clone(msg.payload);
        return;
      case 'room.snapshot':
        this.applyRoomSnapshot(msg.payload);
        return;
      case 'player.joined': {
        if (!fresh(msg.payload.revision)) return;
        const player = clone(msg.payload.player);
        const i = room.players.findIndex((p) => p.id === player.id);
        if (i >= 0) room.players[i] = player;
        else room.players.push(player);
        return;
      }
      case 'player.left':
        if (!fresh(msg.payload.revision)) return;
        room.players = room.players.filter((p) => p.id !== msg.payload.playerId);
        return;
      case 'player.updated': {
        if (!fresh(msg.payload.revision)) return;
        const p = presence(msg.payload.playerId);
        if (p) {
          p.position = { ...msg.payload.position };
          p.rotation = msg.payload.rotation;
        }
        if (msg.payload.playerId === s.self.playerId) {
          s.self.position = { ...msg.payload.position };
          s.self.rotation = msg.payload.rotation;
        }
        return;
      }
      case 'player.connection': {
        if (!fresh(msg.payload.revision)) return;
        const p = presence(msg.payload.playerId);
        if (p) p.connected = msg.payload.connected;
        return;
      }
      case 'player.ready': {
        if (!fresh(msg.payload.revision)) return;
        const p = presence(msg.payload.playerId);
        if (p) p.ready = msg.payload.ready;
        return;
      }
      case 'player.corrected': {
        s.self.position = { ...msg.payload.position };
        s.self.rotation = msg.payload.rotation;
        const me = presence(s.self.playerId);
        if (me) {
          me.position = { ...msg.payload.position };
          me.rotation = msg.payload.rotation;
        }
        return;
      }
      case 'room.updated': {
        const summary = clone(msg.payload.room);
        const i = s.board.findIndex((r) => r.id === summary.id);
        if (i >= 0) s.board[i] = summary;
        else s.board.push(summary);
        if (room.summary?.id === summary.id && summary.revision >= room.summary.revision) room.summary = clone(summary);
        return;
      }
      case 'game.state':
        if (!fresh(msg.payload.revision)) return;
        room.session = { sessionId: msg.payload.sessionId, ...clone(msg.payload.state) };
        return;
      case 'game.finished': {
        const f = clone(msg.payload);
        const last = s.lastFinished;
        // A later `failed` may be for an older session: only a new round's result replaces it.
        if (last?.sessionId === f.sessionId) {
          if (last.persistenceStatus !== 'saved') s.lastFinished = f;
        } else if (f.persistenceStatus === 'pending' || last === null) {
          s.lastFinished = f;
        }
        if (room.session?.sessionId === f.sessionId) {
          // The round is over: the room is waiting again and nobody has a position.
          room.session = null;
          for (const p of room.players) p.position = null;
          s.self.position = null;
        }
        return;
      }
      case 'result.saved':
        if (s.lastFinished?.sessionId === msg.payload.sessionId) {
          s.lastFinished = { ...s.lastFinished, persistenceStatus: 'saved' };
        }
        return;
      case 'session.replaced':
        return;
    }
  }

  private emit(type: ServerEventType, payload: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(clone(payload));
      } catch {
        // A faulty subscriber must not break the connection.
      }
    }
  }

  private setState(next: ConnectionState): void {
    if (this.current === next) return;
    this.current = next;
    for (const cb of [...this.stateListeners]) {
      try {
        cb(next);
      } catch {
        // A faulty subscriber must not break the connection.
      }
    }
  }

  private clearTimer(name: 'retryTimer' | 'refreshTimer' | 'authTimer' | 'moveTimer'): void {
    const t = this[name];
    if (t !== null) clearTimeout(t);
    this[name] = null;
  }
}

/**
 * Opens a world connection over `transport`. Resolves after the first `world.snapshot`, or
 * with the error that ended the first attempt (for example WORLD_FULL or UNAUTHORIZED).
 */
export function openWorldConnection(transport: WorldTransport): Promise<Result<WorldConnection>> {
  return new Promise((resolve) => {
    const connection = new Connection(transport, resolve);
    connection.attempt().catch(() => resolve(fail('SERVICE_UNAVAILABLE')));
  });
}
