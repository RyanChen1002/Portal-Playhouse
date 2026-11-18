import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK, type JWTPayload } from 'jose';
import { vi, type MockInstance } from 'vitest';
import type { PlayerCard, ServerMessage } from '../../shared/contracts';

/** Must match `vars.SUPABASE_URL` in wrangler.jsonc (the local stack). */
export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const ISSUER = `${SUPABASE_URL}/auth/v1`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const ALLOWED_ORIGIN = 'http://127.0.0.1:4173';

// ---- tokens ----

let signingKey: { privateKey: CryptoKey; publicJwk: JWK } | null = null;

async function key() {
  if (!signingKey) {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    signingKey = { privateKey, publicJwk: { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'ES256', use: 'sig' } };
  }
  return signingKey;
}

/** Signs a Supabase-shaped access token for `sub`. `expiresInS` may be negative (within the 30 s tolerance). */
export async function tokenFor(sub: string, expiresInS = 3600, overrides: Partial<JWTPayload> = {}): Promise<string> {
  const k = await key();
  const nowS = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    sub,
    iat: nowS - 60,
    exp: nowS + expiresInS,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: k.publicJwk.kid! })
    .sign(k.privateKey);
}

// ---- fake Supabase (JWKS + runtime functions) behind a global fetch spy ----

export interface FakeSupabase {
  profiles: Map<string, PlayerCard>;
  /** When true, every RPC call fails at the network level. */
  down: boolean;
  /** Headers and bodies of RPC calls, for assertions. */
  rpcCalls: { url: string; headers: Headers; body: unknown }[];
  /** Saved results by session id (idempotent, like `record_portal_partners_result`). */
  results: Map<string, string>;
  /** When true, `record_portal_partners_result` fails at the network level. */
  resultsDown: boolean;
  /** Replaces the default `record_portal_partners_result` behaviour when set. */
  onRecord: ((body: RecordBody, fake: FakeSupabase) => Response | Promise<Response>) | null;
  /** Calls made to `record_portal_partners_result`. */
  recordCalls(): RecordBody[];
  restore(): void;
}

export interface RecordBody {
  session_id: string;
  player_ids: string[];
  outcome: string;
  cancel_reason: string | null;
  score: number;
  started_at: string;
  completed_at: string;
}

const RECORD_FN = '/rest/v1/rpc/record_portal_partners_result';

/** The default fake: one row per session id, returning the same result id on repeats. */
export function recordIdempotently(body: RecordBody, fake: FakeSupabase): Response {
  let id = fake.results.get(body.session_id);
  if (!id) fake.results.set(body.session_id, (id = crypto.randomUUID()));
  return Response.json({ resultId: id });
}

/**
 * Replaces `globalThis.fetch`. The Worker and its Durable Objects run in the same isolate
 * as the tests, so the runtime's outbound calls reach this stub.
 */
export async function installFakeSupabase(): Promise<FakeSupabase> {
  const k = await key();
  const fake: FakeSupabase = {
    profiles: new Map(),
    down: false,
    rpcCalls: [],
    results: new Map(),
    resultsDown: false,
    onRecord: null,
    recordCalls: () => fake.rpcCalls.filter((c) => c.url.endsWith(RECORD_FN)).map((c) => c.body as RecordBody),
    restore: () => spy.mockRestore(),
  };
  const spy: MockInstance<typeof fetch> = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.url === JWKS_URL) return Response.json({ keys: [k.publicJwk] });
    if (req.url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) {
      const body: unknown = await req.json();
      fake.rpcCalls.push({ url: req.url, headers: req.headers, body });
      if (fake.down) throw new TypeError('fetch failed');
      if (req.url.endsWith('/get_runtime_profile')) {
        const id = (body as { player_id?: string }).player_id ?? '';
        const card = fake.profiles.get(id);
        if (!card) {
          return Response.json(
            { code: 'PT503', details: 'The player profile is unavailable.', hint: null, message: 'SERVICE_UNAVAILABLE' },
            { status: 503 },
          );
        }
        return Response.json(card);
      }
      if (req.url.endsWith(RECORD_FN)) {
        if (fake.onRecord) return fake.onRecord(body as RecordBody, fake);
        if (fake.resultsDown) throw new TypeError('fetch failed');
        return recordIdempotently(body as RecordBody, fake);
      }
    }
    return new Response('not found', { status: 404 });
  });
  return fake;
}

export function card(id: string, displayName = `Player ${id.slice(0, 4)}`): PlayerCard {
  return { id, displayName, avatarId: 'avatar-01' };
}

// ---- WebSocket client ----

export interface Target {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export interface TestSocket {
  ws: WebSocket;
  /** Every message received so far, in order. */
  received: ServerMessage[];
  send(value: unknown): void;
  /** Resolves with the first unconsumed message matching `pred` (default: by type), waiting if needed. */
  next(type: ServerMessage['type'], pred?: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  closed: Promise<{ code: number; reason: string }>;
  isClosed(): boolean;
}

export async function connect(target: Target, origin = ALLOWED_ORIGIN): Promise<TestSocket> {
  const res = await target.fetch('http://runtime.test/connect', {
    headers: { Upgrade: 'websocket', Origin: origin },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error(`expected a WebSocket upgrade, got HTTP ${res.status}`);
  ws.accept();

  const received: ServerMessage[] = [];
  const unconsumed: ServerMessage[] = [];
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  let closedFlag = false;
  let resolveClosed!: (v: { code: number; reason: string }) => void;
  const closed = new Promise<{ code: number; reason: string }>((r) => (resolveClosed = r));

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    received.push(msg);
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
    else unconsumed.push(msg);
  });
  ws.addEventListener('close', (e) => {
    closedFlag = true;
    resolveClosed({ code: e.code, reason: e.reason });
  });

  return {
    ws,
    received,
    send(value) {
      ws.send(typeof value === 'string' ? value : JSON.stringify(value));
    },
    next(type, pred = () => true, timeoutMs = 3000) {
      const match = (m: ServerMessage) => m.type === type && pred(m);
      const i = unconsumed.findIndex(match);
      if (i >= 0) return Promise.resolve(unconsumed.splice(i, 1)[0]!);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    closed,
    isClosed: () => closedFlag,
  };
}

/** Connects and authenticates; resolves once `world.snapshot` arrives. */
export async function joinAs(target: Target, playerId: string): Promise<TestSocket> {
  const s = await connect(target);
  s.send({ type: 'auth', requestId: 'auth-1', payload: { token: await tokenFor(playerId) } });
  await s.next('world.snapshot');
  return s;
}

export function closeAll(sockets: TestSocket[]): void {
  for (const s of sockets) {
    try {
      if (!s.isClosed()) s.ws.close(1000, 'test done');
    } catch {
      // already closed
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
