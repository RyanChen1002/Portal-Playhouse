// Shared world contract suite: one set of expectations for every WorldConnection
// implementation. Runs against the in-memory mock (mock.world.contract.test.ts) and against
// the real client and the local runtime (real.world.contract.integration.test.ts).
//
// Timing is realistic on purpose: movement uses the real clock and 10 Hz steps of at most
// 0.4 units, inside the arena budget (speed 4, refill 1.25 x speed per second), so the same
// script passes against the real runtime. Every test signs up fresh accounts and leaves the
// world afterwards, because the world (and its single `portal` room) is shared by all tests.
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AppError,
  ErrorCode,
  PortalClient,
  Result,
  ServerEventType,
  Vec3,
  WorldConnection,
} from '../contracts/index';
import { COURTYARD_SPAWN, PORTAL_ROOM } from '../world/config';
import { ARENA_SPAWNS, CRYSTAL_A, CRYSTAL_B, LEVER, PLATE } from '../world/games/portal-partners';
import { CABLE_POINTS, GEAR_POINTS, POWER_LEFT, POWER_RIGHT, SOCKET_POINTS } from '../world/games/power-up-workshop';

export interface WorldContractFactory {
  /** A fresh client, signed in to a new account that has never played. */
  newSignedInClient(): Promise<PortalClient>;
}

const TEST_TIMEOUT_MS = 60_000;
const WAIT_TIMEOUT_MS = 10_000;
const STEP_MS = 100;
const STEP_UNITS = 0.4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(predicate: () => boolean, what: string, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(10);
  }
}

function expectOk<T>(r: Result<T>): T {
  expect(r.error, `unexpected error: ${JSON.stringify(r.error)}`).toBeNull();
  return r.data as T;
}

function expectError<T>(r: Result<T>, code: ErrorCode): AppError {
  expect(r.data).toBeNull();
  expect(r.error?.code).toBe(code);
  expect(typeof r.error?.message).toBe('string');
  expect(r.error?.message.length).toBeGreaterThan(0);
  return r.error as AppError;
}

const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });
const near = (a: Vec3 | null | undefined, b: Vec3) => !!a && Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

/** Records every server event a connection receives, in order. */
const EVENT_TYPES: ServerEventType[] = [
  'world.snapshot',
  'room.snapshot',
  'player.joined',
  'player.left',
  'player.updated',
  'player.connection',
  'player.ready',
  'player.corrected',
  'room.updated',
  'game.state',
  'game.finished',
  'result.saved',
  'session.replaced',
];

export interface Recorded {
  type: ServerEventType;
  payload: unknown;
}

export function record(conn: WorldConnection): Recorded[] {
  const log: Recorded[] = [];
  for (const type of EVENT_TYPES) conn.on(type, (payload) => log.push({ type, payload }));
  return log;
}

/** Walks the connection's own character to `to` at 0.4 units per 100 ms of real time. */
export async function walkTo(conn: WorldConnection, to: Vec3): Promise<void> {
  const from = conn.snapshot().self.position;
  if (!from) throw new Error('walkTo: no position (waiting room?)');
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(dist / STEP_UNITS));
  for (let i = 1; i <= steps; i++) {
    await sleep(STEP_MS);
    const f = i / steps;
    conn.sendMove({ x: from.x + (to.x - from.x) * f, y: 0, z: from.z + (to.z - from.z) * f }, 0);
  }
}

/** Walks a path of points in order. */
async function walkPath(conn: WorldConnection, points: Vec3[]): Promise<void> {
  for (const p of points) await walkTo(conn, p);
}

/** True once `observer` has seen `playerId` at `at` in its room. */
function sees(observer: WorldConnection, playerId: string, at: Vec3): boolean {
  return near(observer.snapshot().room.players.find((p) => p.id === playerId)?.position, at);
}

const ENTRANCE = PORTAL_ROOM.entrance;

/** The connection's room session, when it is a Portal Partners round. */
function ppSession(c: WorldConnection) {
  const s = c.snapshot().room.session;
  return s?.gameType === 'portal-partners' ? s : undefined;
}

/**
 * Plays a started Portal Partners round to a win: a holds the plate, b crosses and pulls the
 * lever, each collects a crystal, both stand at the exit, and b opens it.
 */
export async function playToWin(a: WorldConnection, b: WorldConnection): Promise<void> {
  // a holds the plate; b crosses the open bridge and pulls the lever.
  const onPlate = v(PLATE.x, PLATE.z);
  await walkTo(a, onPlate);
  await waitFor(() => ppSession(b)?.bridgeOpen === true, 'the bridge to open');
  await walkPath(b, [v(0, -4), v(LEVER.x - 0.5, LEVER.z)]);
  expectOk(await b.interact('lever'));
  await waitFor(() => ppSession(a)?.latched === true, 'the lever to latch');

  // a crosses the latched bridge to crystal A while b goes to crystal B.
  await Promise.all([
    walkPath(a, [v(0, 2), v(0, -2), v(CRYSTAL_A.x + 0.5, CRYSTAL_A.z)]).then(async () => {
      expectOk(await a.interact('crystal-a'));
    }),
    walkTo(b, v(CRYSTAL_B.x - 0.5, CRYSTAL_B.z)).then(async () => {
      expectOk(await b.interact('crystal-b'));
    }),
  ]);

  // Both stand at the exit; b opens it once it has seen a there.
  const aExit = v(-0.5, -6.5);
  const bExit = v(0.5, -6.5);
  await Promise.all([walkTo(a, aExit), walkTo(b, bExit)]);
  await waitFor(() => sees(b, a.playerId, aExit), 'b to see a at the exit');
  await waitFor(() => ppSession(b)?.crystals.every(Boolean) === true, 'both crystals');
  expectOk(await b.interact('exit'));
}

/** The connection's room session, when it is a Power-Up Workshop round. */
function puwSession(c: WorldConnection) {
  const s = c.snapshot().room.session;
  return s?.gameType === 'power-up-workshop' ? s : undefined;
}

/**
 * Plays a started Power-Up Workshop round to a win, whatever the level: a sets the gears and
 * then holds the left power station; b carries each cable to its socket, then presses the right
 * power station once it has seen a on the left pad. Standing points sit 0.5 inside the 1.9 radius.
 */
export async function playWorkshopToWin(a: WorldConnection, b: WorldConnection): Promise<void> {
  const session = puwSession(a);
  if (!session) throw new Error('playWorkshopToWin: not a Power-Up Workshop round');
  const { gearTargets, socketCables } = session;

  const aPart = (async () => {
    for (let i = 0; i < 3; i++) {
      await walkTo(a, v(GEAR_POINTS[i]!.x + 0.5, GEAR_POINTS[i]!.z));
      for (let n = 0; n < gearTargets[i]!; n++) expectOk(await a.interact(`gear-${i}`));
    }
    await walkTo(a, v(POWER_LEFT.x, POWER_LEFT.z));
  })();

  const bPart = (async () => {
    for (let i = 0; i < 3; i++) {
      const cable = socketCables[i]!;
      await walkTo(b, v(CABLE_POINTS[cable]!.x + 0.5, CABLE_POINTS[cable]!.z));
      expectOk(await b.interact(`cable-${cable}`));
      await walkTo(b, v(SOCKET_POINTS[i]!.x + 0.5, SOCKET_POINTS[i]!.z));
      expectOk(await b.interact(`socket-${i}`));
    }
    await walkTo(b, v(POWER_RIGHT.x, POWER_RIGHT.z));
  })();

  await Promise.all([aPart, bPart]);
  const left = v(POWER_LEFT.x, POWER_LEFT.z);
  await waitFor(() => sees(b, a.playerId, left), 'b to see a on the left power station');
  await waitFor(
    () => {
      const s = puwSession(b);
      return !!s && s.gears.every((g, i) => g === s.gearTargets[i]) && s.sockets.every(Boolean);
    },
    'the gears and sockets to be complete',
  );
  expectOk(await b.interact('power-right'));
}

export function describeWorldContract(label: string, factory: WorldContractFactory): void {
  describe(`world contract: ${label}`, () => {
    const open: WorldConnection[] = [];

    afterEach(async () => {
      // Free every slot (and the portal room) for the next test.
      await Promise.all(open.splice(0).map((c) => c.leaveWorld()));
    });

    async function connect(client?: PortalClient): Promise<{ client: PortalClient; conn: WorldConnection }> {
      const c = client ?? (await factory.newSignedInClient());
      const conn = expectOk(await c.connectWorld());
      open.push(conn);
      return { client: c, conn };
    }

    /** Walks the given connections to the portal entrance together, then joins in order. */
    async function joinPortal(...conns: WorldConnection[]) {
      await Promise.all(conns.map((c) => walkTo(c, ENTRANCE)));
      for (const c of conns) expectOk(await c.joinRoom(PORTAL_ROOM.id));
    }

    /** a and b join and ready; resolves once both have the round's spawn positions. */
    async function startRound(a: WorldConnection, b: WorldConnection): Promise<string> {
      await joinPortal(a, b);
      return readyUp(a, b);
    }

    /** a and b, already in the portal room, ready up; resolves with the round's session id. */
    async function readyUp(a: WorldConnection, b: WorldConnection): Promise<string> {
      expectOk(await a.setReady(true));
      expectOk(await b.setReady(true));
      await waitFor(
        () => !!a.snapshot().room.session && !!b.snapshot().room.session,
        'both players to receive the round',
      );
      const sid = a.snapshot().room.session!.sessionId;
      expect(b.snapshot().room.session!.sessionId).toBe(sid);
      return sid;
    }

    it(
      'connects and gets a snapshot',
      async () => {
        const { conn } = await connect();
        expect(conn.state).toBe('connected');
        const s = conn.snapshot();
        expect(s.self.playerId).toBe(conn.playerId);
        expect(s.self.roomId).toBe('lobby');
        expect(s.self.position).toEqual(COURTYARD_SPAWN);
        expect(s.room.roomId).toBe('lobby');
        expect(s.room.summary).toBeNull();
        expect(s.room.players.map((p) => p.id)).toContain(conn.playerId);
        expect(s.board.map((r) => r.id)).toContain(PORTAL_ROOM.id);
        expect(s.lastFinished).toBeNull();
        // snapshot() returns a copy.
        s.self.roomId = 'changed';
        expect(conn.snapshot().self.roomId).toBe('lobby');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'two clients see each other move',
      async () => {
        const { conn: a } = await connect();
        const { conn: b } = await connect();
        const seenByB = record(b);
        await waitFor(() => b.snapshot().room.players.some((p) => p.id === a.playerId), 'b to see a');

        const target = v(1.2, 4);
        await walkTo(a, target);
        expect(a.snapshot().self.position).toEqual(target);
        await waitFor(() => sees(b, a.playerId, target), 'b to see a at the target');
        expect(
          seenByB.some(
            (e) => e.type === 'player.updated' && (e.payload as { playerId: string }).playerId === a.playerId,
          ),
        ).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'rejects an unknown room and a join from too far away',
      async () => {
        const { conn } = await connect();
        expectError(await conn.joinRoom('nowhere'), 'ROOM_NOT_FOUND');
        // The lobby spawn is about 11.2 units from the entrance; the join radius is 3.2.
        expectError(await conn.joinRoom(PORTAL_ROOM.id), 'INVALID_ACTION');
        const s = conn.snapshot();
        expect(s.self.roomId).toBe('lobby');
        expect(s.self.position).toEqual(COURTYARD_SPAWN);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'two players join, ready and start; a third client sees the board update',
      async () => {
        const { conn: a } = await connect();
        const { conn: b } = await connect();
        const { conn: c } = await connect();
        const portalOn = (conn: WorldConnection) => conn.snapshot().board.find((r) => r.id === PORTAL_ROOM.id);

        await joinPortal(a, b);
        const joined = a.snapshot();
        expect(joined.self.roomId).toBe(PORTAL_ROOM.id);
        expect(joined.self.position).toBeNull();
        expect(joined.room.summary?.status).toBe('waiting');
        await waitFor(() => portalOn(c)?.players.length === 2, 'c to see two players on the board');
        expect(portalOn(c)?.players.map((p) => p.id)).toEqual([a.playerId, b.playerId]);

        const sid = await readyUp(a, b);
        expect(a.snapshot().self.position).toEqual(ARENA_SPAWNS[0]);
        expect(b.snapshot().self.position).toEqual(ARENA_SPAWNS[1]);
        const session = ppSession(a)!;
        expect(session.bridgeOpen).toBe(false);
        expect(session.crystals).toEqual([false, false]);
        expect(session.durationSeconds).toBe(180);
        await waitFor(() => portalOn(c)?.status === 'playing', 'c to see the room playing');
        const board = portalOn(c)!;
        expect(board.sessionId).toBe(sid);
        expect(board.score).toBe(0);
        expect(typeof board.startedAt).toBe('string');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'a third client cannot join a playing room',
      async () => {
        const { conn: a } = await connect();
        const { conn: b } = await connect();
        const { conn: c } = await connect();
        await Promise.all([startRound(a, b), walkTo(c, ENTRANCE)]);
        expectError(await c.joinRoom(PORTAL_ROOM.id), 'ROOM_LOCKED');
        expect(c.snapshot().self.roomId).toBe('lobby');
        expect(c.snapshot().board.find((r) => r.id === PORTAL_ROOM.id)?.status).toBe('playing');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'leaving a playing room cancels the round for the remaining player',
      async () => {
        const { conn: a } = await connect();
        const { conn: b } = await connect();
        const sid = await startRound(a, b);
        const seenByB = record(b);

        const lobby = expectOk(await a.leaveRoom());
        expect(lobby.roomId).toBe('lobby');
        expect(a.snapshot().self.roomId).toBe('lobby');
        expect(a.snapshot().self.position).toEqual(ENTRANCE);

        await waitFor(() => b.snapshot().lastFinished?.sessionId === sid, 'b to receive game.finished');
        // Over a real socket, player.left arrives as a later frame than game.finished.
        await waitFor(() => !b.snapshot().room.players.some((p) => p.id === a.playerId), 'a to leave b’s room');
        const finished = seenByB.filter((e) => e.type === 'game.finished').map((e) => e.payload);
        expect(finished[0]).toEqual({
          sessionId: sid,
          outcome: 'cancelled',
          score: 0,
          persistenceStatus: 'pending',
          reason: 'left',
        });
        const bs = b.snapshot();
        expect(bs.room.session).toBeNull();
        expect(bs.self.position).toBeNull();
        expect(bs.room.players.map((p) => p.id)).toEqual([b.playerId]);
        expect(bs.board.find((r) => r.id === PORTAL_ROOM.id)?.status).toBe('waiting');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'leaveWorld frees the slot',
      async () => {
        const { client, conn: a } = await connect();
        const { conn: b } = await connect();
        const seenByB = record(b);
        const states: string[] = [];
        a.onConnectionState((s) => states.push(s));

        await walkTo(a, v(1, 4));
        await waitFor(() => sees(b, a.playerId, v(1, 4)), 'b to see a move');
        expect(a.closeReason).toBeNull();
        expectOk(await a.leaveWorld());
        expect(a.state).toBe('closed');
        expect(a.closeReason).toBe('left');
        expect(states).toContain('closed');
        await waitFor(() => !b.snapshot().room.players.some((p) => p.id === a.playerId), 'a to leave b’s room');
        expect(
          seenByB.find(
            (e) => e.type === 'player.left' && (e.payload as { playerId: string }).playerId === a.playerId,
          )?.payload,
        ).toMatchObject({ reason: 'left' });

        // A new connection is a fresh admission at the spawn point, not a restored one.
        const again = expectOk(await client.connectWorld());
        open.push(again);
        expect(again).not.toBe(a);
        expect(again.snapshot().self.position).toEqual(COURTYARD_SPAWN);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'interact with no round is NOT_IN_GAME',
      async () => {
        const { conn } = await connect();
        expectError(await conn.interact('lever'), 'NOT_IN_GAME');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'a full scripted win is saved and counted',
      async () => {
        const { client: ca, conn: a } = await connect();
        const { client: cb, conn: b } = await connect();
        const sid = await startRound(a, b);
        const seenByA = record(a);
        const seenByB = record(b);

        await playToWin(a, b);

        const expected = { sessionId: sid, outcome: 'win', score: 2, persistenceStatus: 'pending' };
        for (const [conn, seen] of [
          [a, seenByA],
          [b, seenByB],
        ] as const) {
          await waitFor(
            () => seen.some((e) => e.type === 'result.saved'),
            'result.saved',
            30_000,
          );
          const finishedAt = seen.findIndex((e) => e.type === 'game.finished');
          const savedAt = seen.findIndex((e) => e.type === 'result.saved');
          expect(seen[finishedAt]?.payload).toEqual(expected);
          expect(savedAt).toBeGreaterThan(finishedAt);
          expect(seen[savedAt]?.payload).toMatchObject({ sessionId: sid });
          expect(seen.some((e) => e.type === 'player.corrected')).toBe(false);
          expect(conn.snapshot().lastFinished).toEqual({ ...expected, persistenceStatus: 'saved' });
          expect(conn.snapshot().room.session).toBeNull();
        }

        for (const [client, conn] of [
          [ca, a],
          [cb, b],
        ] as const) {
          const page = expectOk(await client.getMyResults());
          expect(page.results).toHaveLength(1);
          const r = page.results[0]!;
          expect(r).toMatchObject({
            sessionId: sid,
            gameType: 'portal-partners',
            outcome: 'win',
            cancelReason: null,
            score: 2,
          });
          expect(r.players.map((p) => p.id).sort()).toEqual([a.playerId, b.playerId].sort());
          expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
          expect(Date.parse(r.completedAt)).toBeGreaterThanOrEqual(Date.parse(r.startedAt));
          expect(page.nextCursor).toBeNull();
          expect(expectOk(await client.getMe()).winsTotal).toBe(1);
          expect(conn.playerId).toBe(expectOk(await client.getMe()).id);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'getMyResults validates its limit',
      async () => {
        const client = await factory.newSignedInClient();
        for (const limit of [0, 51, 2.5]) {
          expectError(await client.getMyResults({ limit }), 'VALIDATION_ERROR');
        }
        const empty = expectOk(await client.getMyResults({ limit: 50 }));
        expect(empty).toEqual({ results: [], nextCursor: null });
      },
      TEST_TIMEOUT_MS,
    );
  });
}
