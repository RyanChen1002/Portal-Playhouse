import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result, ServerMessage, WorldConnection, WorldSnapshot } from '../contracts/index';
import { createPortalClient } from './index';
import { openWorldConnection, RECONNECT_DELAYS_MS, tokenExpiry, type SocketLike, type WorldTransport } from './world';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<{ type: string; requestId?: string; payload: Record<string, unknown> }> = [];
  closedByClient: number | null = null;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1005) {
    this.closedByClient = code;
  }
  open() {
    this.onopen?.();
  }
  push(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(code: number, reason = '') {
    this.onclose?.({ code, reason });
  }
  lastRequestId(type: string): string {
    const m = [...this.sent].reverse().find((s) => s.type === type);
    if (!m?.requestId) throw new Error(`no ${type} sent`);
    return m.requestId;
  }
}

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

function snapshot(revision = 1): WorldSnapshot {
  return {
    self: { playerId: 'p1', roomId: 'lobby', position: { x: 0, y: 0, z: 4 }, rotation: 0 },
    room: {
      roomId: 'lobby',
      summary: null,
      players: [
        { id: 'p1', displayName: 'One', avatarId: 'avatar-01', position: { x: 0, y: 0, z: 4 }, rotation: 0, connected: true, ready: false },
      ],
      session: null,
      revision,
    },
    board: [],
    lastFinished: null,
  };
}

interface Harness {
  sockets: FakeSocket[];
  transport: WorldTransport;
  refreshes: number;
  token: string;
}

function harness(token = 'token-1'): Harness {
  const h: Harness = {
    sockets: [],
    refreshes: 0,
    token,
    transport: {
      openSocket: () => {
        const s = new FakeSocket();
        h.sockets.push(s);
        return s;
      },
      getToken: async () => h.token,
      refreshToken: async () => {
        h.refreshes++;
        return h.token;
      },
    },
  };
  return h;
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** Opens a connection and completes the first admission. */
async function connected(h: Harness): Promise<WorldConnection> {
  const pending = openWorldConnection(h.transport);
  await tick();
  const s = h.sockets[0]!;
  s.open();
  s.push({ type: 'world.snapshot', payload: snapshot() });
  const r = await pending;
  expect(r.error).toBeNull();
  return r.data!;
}

/** Lets the next scheduled socket open and admits it. */
function admitLatest(h: Harness, revision = 1) {
  const s = h.sockets[h.sockets.length - 1]!;
  s.open();
  s.push({ type: 'world.snapshot', payload: snapshot(revision) });
}

describe('world connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends only auth before the first world.snapshot, then resolves connected', async () => {
    const h = harness();
    const pending = openWorldConnection(h.transport);
    let settled: Result<WorldConnection> | null = null;
    void pending.then((r) => (settled = r));
    await tick();
    const s = h.sockets[0]!;
    s.open();
    expect(s.sent).toEqual([{ type: 'auth', requestId: expect.any(String), payload: { token: 'token-1' } }]);
    await tick();
    expect(settled).toBeNull();

    s.push({ type: 'world.snapshot', payload: snapshot() });
    const conn = (await pending).data!;
    expect(conn.state).toBe('connected');
    expect(conn.playerId).toBe('p1');
    expect(conn.snapshot().self.position).toEqual({ x: 0, y: 0, z: 4 });
  });

  it('reconnects at 0.5, 1, 2, 4 and 8 s, then closes', async () => {
    const h = harness();
    const conn = await connected(h);
    const states: string[] = [];
    conn.onConnectionState((s) => states.push(s));

    h.sockets[0]!.serverClose(1006);
    expect(conn.state).toBe('reconnecting');
    let elapsed = 0;
    for (const [i, delay] of RECONNECT_DELAYS_MS.entries()) {
      await tick(delay - 1);
      expect(h.sockets).toHaveLength(i + 1);
      await tick(1);
      elapsed += delay;
      expect(h.sockets).toHaveLength(i + 2);
      h.sockets[i + 1]!.serverClose(1006);
    }
    expect(elapsed).toBe(15_500); // inside the 20 s grace
    expect(conn.state).toBe('closed');
    await tick(60_000);
    expect(h.sockets).toHaveLength(6);
    expect(states).toEqual(['reconnecting', 'closed']);
  });

  it('a successful reconnect replaces the snapshot and resets the schedule', async () => {
    const h = harness();
    const conn = await connected(h);
    const snaps: WorldSnapshot[] = [];
    conn.on('world.snapshot', (s) => snaps.push(s));

    h.sockets[0]!.serverClose(4503);
    await tick(500);
    h.sockets[1]!.serverClose(1006);
    await tick(1000);
    expect(h.sockets).toHaveLength(3);
    admitLatest(h, 7);
    expect(conn.state).toBe('connected');
    expect(conn.snapshot().room.revision).toBe(7);
    expect(snaps).toHaveLength(1);

    h.sockets[2]!.serverClose(1006);
    await tick(500);
    expect(h.sockets).toHaveLength(4);
  });

  for (const reason of ['session.replaced', 'idle', 'left']) {
    it(`never reconnects after a 1000 close (${reason})`, async () => {
      const h = harness();
      const conn = await connected(h);
      if (reason === 'session.replaced') h.sockets[0]!.push({ type: 'session.replaced', payload: {} });
      h.sockets[0]!.serverClose(1000, reason);
      expect(conn.state).toBe('closed');
      await tick(60_000);
      expect(h.sockets).toHaveLength(1);
    });
  }

  it('WORLD_FULL on the first connection resolves with the error and does not retry', async () => {
    const h = harness();
    const pending = openWorldConnection(h.transport);
    await tick();
    const s = h.sockets[0]!;
    s.open();
    s.push({ type: 'request.error', requestId: s.lastRequestId('auth'), error: { code: 'WORLD_FULL', message: 'Full.' } });
    s.serverClose(4409, 'WORLD_FULL');
    const r = await pending;
    expect(r.error?.code).toBe('WORLD_FULL');
    await tick(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('4401 refreshes the session once and reconnects; a second 4401 closes', async () => {
    const h = harness();
    const conn = await connected(h);
    h.sockets[0]!.serverClose(4401);
    await tick(500);
    expect(h.refreshes).toBe(1);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.open();
    h.sockets[1]!.serverClose(4401);
    await tick(60_000);
    expect(conn.state).toBe('closed');
    expect(h.refreshes).toBe(1);
    expect(h.sockets).toHaveLength(2);
  });

  it('requests match by requestId, apply room snapshots, and time out after 10 s', async () => {
    const h = harness();
    const conn = await connected(h);
    const s = h.sockets[0]!;

    const join = conn.joinRoom('portal');
    const id = s.lastRequestId('room.join');
    expect(s.sent.at(-1)).toEqual({ type: 'room.join', requestId: id, payload: { roomId: 'portal' } });
    const room = { ...snapshot(3).room, roomId: 'portal', players: [] };
    s.push({ type: 'request.accepted', requestId: 'someone-else', payload: null });
    s.push({ type: 'request.accepted', requestId: id, payload: room });
    expect((await join).data?.roomId).toBe('portal');
    expect(conn.snapshot().self).toMatchObject({ roomId: 'portal', position: null });

    const ready = conn.setReady(true);
    s.push({
      type: 'request.error',
      requestId: s.lastRequestId('game.ready'),
      error: { code: 'GAME_NOT_READY', message: 'Not now.' },
    });
    expect((await ready).error).toEqual({ code: 'GAME_NOT_READY', message: 'Not now.' });

    const leave = conn.leaveRoom();
    await tick(9_999);
    let done = false;
    void leave.then(() => (done = true));
    await tick(0);
    expect(done).toBe(false);
    await tick(1);
    expect((await leave).error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('sends auth.refresh 60 s before the token expires', async () => {
    const now = Date.now();
    const h = harness(jwt({ exp: Math.floor(now / 1000) + 120 }));
    await connected(h);
    const s = h.sockets[0]!;
    h.token = jwt({ exp: Math.floor(now / 1000) + 3600 });
    await tick(59_000);
    expect(h.refreshes).toBe(0);
    await tick(1_000);
    expect(h.refreshes).toBe(1);
    expect(s.sent.at(-1)).toMatchObject({ type: 'auth.refresh', payload: { token: h.token } });
  });

  it('keeps the snapshot current and ignores a late failure for an old session', async () => {
    const h = harness();
    const conn = await connected(h);
    const s = h.sockets[0]!;
    s.push({
      type: 'player.joined',
      payload: {
        player: { id: 'p2', displayName: 'Two', avatarId: 'avatar-02', position: { x: 1, y: 0, z: 1 }, rotation: 0, connected: true, ready: false },
        revision: 2,
      },
    });
    s.push({ type: 'player.updated', payload: { playerId: 'p2', position: { x: 2, y: 0, z: 2 }, rotation: 1, sequence: 1, revision: 3 } });
    // Older than the room's revision: ignored.
    s.push({ type: 'player.updated', payload: { playerId: 'p2', position: { x: 9, y: 0, z: 9 }, rotation: 1, sequence: 0, revision: 2 } });
    expect(conn.snapshot().room.players.find((p) => p.id === 'p2')?.position).toEqual({ x: 2, y: 0, z: 2 });

    s.push({ type: 'game.finished', payload: { sessionId: 's1', outcome: 'win', score: 2, persistenceStatus: 'pending' } });
    s.push({ type: 'game.finished', payload: { sessionId: 's2', outcome: 'loss', score: 0, persistenceStatus: 'pending' } });
    s.push({ type: 'game.finished', payload: { sessionId: 's1', outcome: 'win', score: 2, persistenceStatus: 'failed' } });
    expect(conn.snapshot().lastFinished?.sessionId).toBe('s2');
    s.push({ type: 'result.saved', payload: { sessionId: 's2', resultId: 'r2' } });
    expect(conn.snapshot().lastFinished).toMatchObject({ sessionId: 's2', persistenceStatus: 'saved' });

    conn.sendMove({ x: 0.3, y: 0, z: 4 }, 0.5);
    expect(s.sent.at(-1)).toEqual({ type: 'player.move', payload: { sequence: 1, position: { x: 0.3, y: 0, z: 4 }, rotation: 0.5 } });
    expect(conn.snapshot().self.position).toEqual({ x: 0.3, y: 0, z: 4 });
    s.push({ type: 'player.corrected', payload: { sequence: 1, position: { x: 0, y: 0, z: 4 }, rotation: 0, reason: 'rejected' } });
    expect(conn.snapshot().self.position).toEqual({ x: 0, y: 0, z: 4 });
  });

  it('interact without a round is NOT_IN_GAME and sends nothing', async () => {
    const h = harness();
    const conn = await connected(h);
    const before = h.sockets[0]!.sent.length;
    expect((await conn.interact('lever')).error?.code).toBe('NOT_IN_GAME');
    expect(h.sockets[0]!.sent).toHaveLength(before);
  });

  it('reads exp from a token without verifying it', () => {
    expect(tokenExpiry(jwt({ exp: 100 }))).toBe(100_000);
    expect(tokenExpiry('not-a-jwt')).toBeNull();
  });
});

describe('createPortalClient world methods', () => {
  it('connectWorld without runtimeUrl is SERVICE_UNAVAILABLE', async () => {
    const client = createPortalClient({ url: 'http://127.0.0.1:1', publishableKey: 'k' });
    expect((await client.connectWorld()).error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('connectWorld and getMyResults when signed out are UNAUTHORIZED; bad limits are VALIDATION_ERROR', async () => {
    const opened: string[] = [];
    const client = createPortalClient({
      url: 'http://127.0.0.1:1',
      publishableKey: 'k',
      runtimeUrl: 'ws://127.0.0.1:2/connect',
      openSocket: (url) => {
        opened.push(url);
        return new FakeSocket();
      },
    });
    expect((await client.connectWorld()).error?.code).toBe('UNAUTHORIZED');
    expect(opened).toEqual([]);
    expect((await client.getMyResults()).error?.code).toBe('UNAUTHORIZED');
    expect((await client.getMyResults({ limit: 0 })).error?.code).toBe('VALIDATION_ERROR');
    expect((await client.getMyResults({ limit: 51 })).error?.code).toBe('VALIDATION_ERROR');
  });
});
