import { DurableObject } from 'cloudflare:workers';
import { parseClientMessage, type ClientMessage, type ErrorCode, type ServerMessage } from '../../shared/contracts';
import {
  AUTH_DEADLINE_MS,
  INVALID_MESSAGE_LIMIT,
  INVALID_MESSAGE_WINDOW_MS,
  MAX_MESSAGE_BYTES,
  MAX_MOVES_PER_SECOND,
  PENDING_AUTH_CAP,
  World,
  type ConnId,
  type FinishedRound,
} from '../../shared/world';
import { createTokenVerifier, type TokenVerifier } from './auth';
import { PendingResults } from './results';
import { createSupabaseServer, type SupabaseServer } from './supabase';

/** World.advance() cadence while anyone holds a slot (spec §6.4 precision). */
const TICK_MS = 100;

/**
 * Close codes. The client (Task 11) uses them to decide whether to reconnect.
 * Engine closings use 1000 with the engine's reason string.
 */
export const CLOSE = {
  normal: 1000,
  invalid: 4400,
  unauthorized: 4401,
  worldFull: 4409,
  unavailable: 4503,
} as const;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHORIZED: 'Your session is not valid. Please sign in again.',
  SERVICE_UNAVAILABLE: 'The service is unavailable. Please try again later.',
  VALIDATION_ERROR: 'The message is not valid.',
  WORLD_FULL: 'The world is full. Please try again later.',
  INVALID_ACTION: 'You are already signed in on this connection.',
};

export interface TestOverrides {
  authDeadlineMs?: number;
  /** Clock for result-save scheduling only (retry times, the 1 h `failed` mark). */
  resultsNow?: () => number;
}

/** True only for the local Supabase stack. Test-only overrides are refused anywhere else. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

interface Conn {
  id: ConnId;
  ws: WebSocket;
  /** pending: waiting for `auth`; authenticating: verifying/profile; admitted: in the World. */
  phase: 'pending' | 'authenticating' | 'admitted' | 'closed';
  playerId: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  /** Move token bucket. */
  moveTokens: number;
  moveRefilledAt: number;
  /** Times of recent invalid messages, within the abuse window. */
  invalid: number[];
}

/**
 * The single World object: a thin adapter between WebSockets and the platform-free World
 * engine. It uses the standard WebSocket API (no hibernation), so open sockets keep it in
 * memory while players are present (spec §5.6 "Staying awake").
 */
export class WorldObject extends DurableObject<Env> {
  private readonly world: World;
  private readonly verifier: TokenVerifier;
  private readonly supabase: SupabaseServer;
  private readonly conns = new Map<ConnId, Conn>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private authDeadlineMs = AUTH_DEADLINE_MS;
  private resultsNow: () => number = () => Date.now();
  private readonly results: PendingResults;
  /** Sessions with a save attempt in progress; at most one attempt per session at a time. */
  private readonly saving = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
      throw new Error('World object is missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    }
    this.world = new World({ now: () => Date.now(), newId: () => crypto.randomUUID() });
    this.verifier = createTokenVerifier({ supabaseUrl: env.SUPABASE_URL });
    this.supabase = createSupabaseServer({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });
    this.results = new PendingResults(
      ctx.storage.sql,
      (at) => ctx.storage.setAlarm(at),
      () => this.resultsNow(),
      () => ctx.storage.deleteAlarm(),
    );
    // Pending saves survive restarts: re-arm the retry alarm before serving anything (spec §7.3).
    void ctx.blockConcurrencyWhile(() => this.results.rearm());
  }

  /** Test-only. Applied, and returns true, only when SUPABASE_URL is the local stack. */
  setTestOverrides(o: TestOverrides): boolean {
    if (!isLocalUrl(this.env.SUPABASE_URL)) return false;
    if (o.authDeadlineMs !== undefined) this.authDeadlineMs = o.authDeadlineMs;
    if (o.resultsNow !== undefined) this.resultsNow = o.resultsNow;
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();

    const conn: Conn = {
      id: crypto.randomUUID(),
      ws: server,
      phase: 'pending',
      playerId: null,
      authTimer: null,
      expiryTimer: null,
      moveTokens: MAX_MOVES_PER_SECOND,
      moveRefilledAt: Date.now(),
      invalid: [],
    };

    if (this.pendingCount() >= PENDING_AUTH_CAP) {
      this.sendTo(conn, errorMessage(null, 'SERVICE_UNAVAILABLE'));
      server.close(CLOSE.unavailable, 'SERVICE_UNAVAILABLE');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.conns.set(conn.id, conn);
    conn.authTimer = setTimeout(() => {
      if (conn.phase !== 'pending') return;
      log('auth.timeout', { code: 'UNAUTHORIZED' });
      this.reject(conn, null, 'UNAUTHORIZED');
    }, this.authDeadlineMs);

    server.addEventListener('message', (e) => {
      void this.onMessage(conn, e.data);
    });
    server.addEventListener('close', () => this.onSocketGone(conn));
    server.addEventListener('error', () => this.onSocketGone(conn));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- incoming ----

  private async onMessage(conn: Conn, data: string | ArrayBuffer): Promise<void> {
    if (conn.phase === 'closed') return;
    if (typeof data !== 'string' || byteLength(data) > MAX_MESSAGE_BYTES) {
      this.invalidMessage(conn, null);
      return;
    }
    const parsed = parseClientMessage(data);
    if (parsed.error) {
      this.invalidMessage(conn, requestIdOf(data));
      return;
    }
    const msg = parsed.data;

    if (conn.phase === 'pending') {
      if (msg.type !== 'auth') {
        log('auth.missing', { code: 'UNAUTHORIZED' });
        this.reject(conn, msg.requestId ?? null, 'UNAUTHORIZED');
        return;
      }
      await this.authenticate(conn, msg.requestId, msg.payload.token);
      return;
    }
    if (conn.phase === 'authenticating') {
      // Nothing but the first `auth` is accepted before admission completes.
      log('auth.missing', { code: 'UNAUTHORIZED' });
      this.reject(conn, msg.requestId ?? null, 'UNAUTHORIZED');
      return;
    }
    if (conn.phase !== 'admitted') return;

    switch (msg.type) {
      case 'auth':
        this.sendTo(conn, errorMessage(msg.requestId, 'INVALID_ACTION'));
        return;
      case 'auth.refresh':
        // Handled here; never reaches the engine, so refreshes do not count against the idle limit.
        await this.refresh(conn, msg.requestId, msg.payload.token);
        return;
      case 'player.move':
        if (!this.takeMoveToken(conn)) return; // over 20/s: dropped without reply
        this.world.handle(conn.id, msg);
        this.flush();
        return;
      default:
        this.world.handle(conn.id, msg as Exclude<ClientMessage, { type: 'auth' | 'auth.refresh' }>);
        this.flush();
    }
  }

  private async authenticate(conn: Conn, requestId: string, token: string): Promise<void> {
    conn.phase = 'authenticating';
    clearTimer(conn.authTimer);
    conn.authTimer = null;

    const verified = await this.verifier.verify(token);
    if (conn.phase !== 'authenticating') return; // socket went away meanwhile
    if (verified.error) {
      log('auth.rejected', { code: 'UNAUTHORIZED' });
      this.reject(conn, requestId, 'UNAUTHORIZED');
      return;
    }
    const { playerId, expiresAt } = verified.data;

    const profile = await this.supabase.getRuntimeProfile(playerId);
    if (conn.phase !== 'authenticating') return;
    if (profile.error) {
      log('profile.unavailable', { playerId, code: 'SERVICE_UNAVAILABLE' });
      this.reject(conn, requestId, 'SERVICE_UNAVAILABLE');
      return;
    }

    const admitted = this.world.admit(conn.id, profile.data);
    if (admitted.error) {
      // The engine's only admission failure is WORLD_FULL.
      log('admit.rejected', { playerId, code: admitted.error.code });
      this.flush();
      this.reject(conn, requestId, admitted.error.code);
      return;
    }
    conn.phase = 'admitted';
    conn.playerId = playerId;
    this.armExpiry(conn, expiresAt);
    this.flush();
  }

  /**
   * Same user: new deadline and `request.accepted`. Invalid token: `UNAUTHORIZED`, the
   * connection stays until the current token expires. Another user: `UNAUTHORIZED` and close.
   */
  private async refresh(conn: Conn, requestId: string, token: string): Promise<void> {
    const verified = await this.verifier.verify(token);
    if (conn.phase !== 'admitted') return;
    if (verified.error) {
      log('refresh.rejected', { playerId: conn.playerId, code: 'UNAUTHORIZED' });
      this.sendTo(conn, errorMessage(requestId, 'UNAUTHORIZED'));
      return;
    }
    if (verified.data.playerId !== conn.playerId) {
      log('refresh.wrong_user', { playerId: conn.playerId, code: 'UNAUTHORIZED' });
      this.dropAdmitted(conn, requestId, 'UNAUTHORIZED');
      return;
    }
    this.armExpiry(conn, verified.data.expiresAt);
    this.sendTo(conn, { type: 'request.accepted', requestId, payload: {} });
  }

  private onSocketGone(conn: Conn): void {
    if (conn.phase === 'closed') return;
    const wasAdmitted = conn.phase === 'admitted';
    this.forget(conn);
    if (wasAdmitted) {
      this.world.connectionLost(conn.id);
      this.flush();
    }
  }

  // ---- limits ----

  private takeMoveToken(conn: Conn): boolean {
    const now = Date.now();
    conn.moveTokens = Math.min(
      MAX_MOVES_PER_SECOND,
      conn.moveTokens + ((now - conn.moveRefilledAt) / 1000) * MAX_MOVES_PER_SECOND,
    );
    conn.moveRefilledAt = now;
    if (conn.moveTokens < 1) return false;
    conn.moveTokens -= 1;
    return true;
  }

  /** `VALIDATION_ERROR`, and more than 100 in 10 s closes the connection. */
  private invalidMessage(conn: Conn, requestId: string | null): void {
    const now = Date.now();
    conn.invalid = conn.invalid.filter((t) => now - t < INVALID_MESSAGE_WINDOW_MS);
    conn.invalid.push(now);
    this.sendTo(conn, errorMessage(requestId, 'VALIDATION_ERROR'));
    if (conn.invalid.length > INVALID_MESSAGE_LIMIT) {
      log('connection.abuse', { playerId: conn.playerId, code: 'VALIDATION_ERROR' });
      if (conn.phase === 'admitted') {
        this.dropAdmitted(conn, null, null, CLOSE.invalid);
      } else {
        this.forget(conn);
        safeClose(conn.ws, CLOSE.invalid, 'VALIDATION_ERROR');
      }
    }
  }

  private armExpiry(conn: Conn, expiresAt: number): void {
    clearTimer(conn.expiryTimer);
    conn.expiryTimer = setTimeout(
      () => {
        if (conn.phase !== 'admitted') return;
        log('token.expired', { playerId: conn.playerId, code: 'UNAUTHORIZED' });
        this.dropAdmitted(conn, null, 'UNAUTHORIZED');
      },
      Math.max(0, expiresAt - Date.now()),
    );
  }

  // ---- closing ----

  /** Not yet admitted: send the error, then close with the code's close code. */
  private reject(conn: Conn, requestId: string | null, code: ErrorCode): void {
    this.sendTo(conn, errorMessage(requestId, code));
    this.forget(conn);
    safeClose(conn.ws, closeCodeFor(code), code);
  }

  /**
   * Admitted connection closed by the adapter (token expiry, wrong-user refresh, abuse): an
   * unexpected disconnect for the engine, so the grace period applies.
   */
  private dropAdmitted(conn: Conn, requestId: string | null, code: ErrorCode | null, closeCode?: number): void {
    if (code) this.sendTo(conn, errorMessage(requestId, code));
    this.forget(conn);
    safeClose(conn.ws, closeCode ?? closeCodeFor(code ?? 'VALIDATION_ERROR'), code ?? 'VALIDATION_ERROR');
    this.world.connectionLost(conn.id);
    this.flush();
  }

  private forget(conn: Conn): void {
    conn.phase = 'closed';
    clearTimer(conn.authTimer);
    clearTimer(conn.expiryTimer);
    conn.authTimer = null;
    conn.expiryTimer = null;
    this.conns.delete(conn.id);
  }

  // ---- outgoing ----

  /**
   * After every engine call: finished rounds are stored durably first, so each pending row
   * exists before its `game.finished` reaches any socket; then the outbox, the closings, the
   * save attempts (not awaited), and the timer.
   */
  private flush(): void {
    const finished = this.world.takeFinishedRounds();
    for (const r of finished) this.results.add(r);
    if (finished.length > 0) void this.rearmResults();
    for (const { to, message } of this.world.takeOutbox()) {
      const conn = this.conns.get(to);
      if (conn) this.sendTo(conn, message);
    }
    for (const { conn: id, reason } of this.world.takeClosings()) {
      const conn = this.conns.get(id);
      if (!conn) continue;
      // The engine has already released this connection; do not report it as lost.
      this.forget(conn);
      safeClose(conn.ws, CLOSE.normal, reason);
    }
    for (const r of finished) void this.save(r);
    this.syncTicker();
  }

  // ---- results ----

  /** Retries every pending result that is due, then re-arms (or deletes) the alarm. */
  override async alarm(): Promise<void> {
    await Promise.all(this.results.due().map((r) => this.save(r)));
    await this.rearmResults();
  }

  /**
   * One attempt to save `round`. The unique session id makes repeats safe (spec §7.3 step 4);
   * an attempt already in flight for the session is not duplicated.
   */
  private async save(round: FinishedRound): Promise<void> {
    if (this.saving.has(round.sessionId)) return;
    this.saving.add(round.sessionId);
    try {
      const r = await this.supabase.recordResult(round);
      if (r.error) {
        log('result.save_failed', { code: r.error.code });
        const { failedStatusReached } = this.results.markFailed(round.sessionId);
        if (failedStatusReached) {
          this.toParticipants(round, {
            type: 'game.finished',
            payload: {
              sessionId: round.sessionId,
              outcome: round.outcome,
              score: round.score,
              persistenceStatus: 'failed',
              ...(round.cancelReason ? { reason: round.cancelReason } : {}),
            },
          });
        }
      } else {
        this.results.markSaved(round.sessionId);
        this.toParticipants(round, {
          type: 'result.saved',
          payload: { sessionId: round.sessionId, resultId: r.data.resultId },
        });
      }
    } finally {
      this.saving.delete(round.sessionId);
    }
    await this.rearmResults();
  }

  private async rearmResults(): Promise<void> {
    try {
      await this.results.rearm();
    } catch {
      log('result.alarm_failed', { code: 'SERVICE_UNAVAILABLE' });
    }
  }

  /** Sends to every admitted connection of the round's participants. */
  private toParticipants(round: FinishedRound, message: ServerMessage): void {
    for (const conn of this.conns.values()) {
      if (conn.phase === 'admitted' && conn.playerId !== null && round.playerIds.includes(conn.playerId)) {
        this.sendTo(conn, message);
      }
    }
  }

  private syncTicker(): void {
    if (this.world.needsTimer()) {
      this.ticker ??= setInterval(() => {
        this.world.advance();
        this.flush();
      }, TICK_MS);
    } else if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private sendTo(conn: Conn, message: ServerMessage): void {
    try {
      conn.ws.send(JSON.stringify(message));
    } catch {
      // The socket is already closing; its close event does the clean-up.
    }
  }

  private pendingCount(): number {
    let n = 0;
    for (const c of this.conns.values()) if (c.phase === 'pending' || c.phase === 'authenticating') n++;
    return n;
  }
}

// ---- helpers ----

function errorMessage(requestId: string | null, code: ErrorCode): ServerMessage {
  return { type: 'request.error', requestId, error: { code, message: MESSAGES[code] ?? code } };
}

function closeCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return CLOSE.unauthorized;
    case 'WORLD_FULL':
      return CLOSE.worldFull;
    case 'SERVICE_UNAVAILABLE':
      return CLOSE.unavailable;
    default:
      return CLOSE.invalid;
  }
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

function clearTimer(t: ReturnType<typeof setTimeout> | null): void {
  if (t !== null) clearTimeout(t);
}

function byteLength(s: string): number {
  // UTF-8 never uses fewer bytes than UTF-16 code units, so long strings can skip encoding.
  return s.length > MAX_MESSAGE_BYTES ? s.length : new TextEncoder().encode(s).byteLength;
}

/** Best-effort request id from an invalid message, for the error reply. */
function requestIdOf(raw: string): string | null {
  try {
    const v: unknown = JSON.parse(raw);
    const id = (v as { requestId?: unknown } | null)?.requestId;
    return typeof id === 'string' && id.length >= 1 && id.length <= 64 ? id : null;
  } catch {
    return null;
  }
}

/** Logs only the player id and the error code; never tokens or payloads. */
function log(event: string, fields: { playerId?: string | null; code: ErrorCode }): void {
  console.log(JSON.stringify({ event, playerId: fields.playerId ?? null, code: fields.code }));
}
