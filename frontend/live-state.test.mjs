import test from "node:test";
import assert from "node:assert/strict";
import * as liveState from "./live-state.js";
import {
  portalView,
  advancePortal,
  resultText,
  leaveLiveRoom,
  historyRow,
  readyLabel,
  roomOccupancyLabel,
  bridgeStatusLabel,
  formatHistoryDate,
} from "./live-state.js";
const snapshot = () => ({
  self: { playerId: "b" },
  room: {
    players: [
      {
        id: "a",
        displayName: "A",
        position: { x: -5, y: 0, z: 3 },
        avatarId: "avatar-01",
        connected: true,
      },
      {
        id: "b",
        displayName: "B",
        position: { x: 0, y: 0, z: 2 },
        avatarId: "avatar-02",
        connected: true,
      },
    ],
    session: {
      sessionId: "round",
      bridgeOpen: false,
      latched: false,
      crystals: [false, false],
      startedAt: "2026-11-21T00:00:00Z",
      serverTime: "2026-11-21T00:00:10Z",
      durationSeconds: 180,
    },
  },
  lastFinished: null,
});
test("live scene uses server bridge state even when a player appears on the plate", () => {
  const s = portalView(snapshot());
  assert.equal(s.active, 1);
  assert.equal(s.authoritativeBridgeOpen, false);
  assert.equal(s.elapsed, 10);
  assert.equal(s.status, "playing");
  assert.equal(advancePortal({ x: 0, z: 1.3 }, 0, -1, 0.04, false).z, 1.3);
});
test("missing teammate is hidden, never invented as a live participant", () => {
  const snap = snapshot();
  snap.room.players.pop();
  snap.self.playerId = "a";
  snap.room.session = null;
  const s = portalView(snap);
  assert.equal(s.players[1].visible, false);
  assert.equal(s.status, "waiting");
});
test("live prediction uses normalized speed and does not cross the gap outside the bridge", () => {
  const p = advancePortal({ x: 0, z: 2 }, 1, 1, 0.1, true);
  assert.ok(Math.abs(Math.hypot(p.x, p.z - 2) - 0.4) < 1e-8);
  assert.equal(advancePortal({ x: 3, z: 1.3 }, 0, -1, 0.1, true).z, 1.3);
});
test("pending or failed results never claim saved success", () => {
  assert.match(
    resultText({ outcome: "win", persistenceStatus: "pending" }),
    /pending/i,
  );
  assert.match(
    resultText({ outcome: "win", persistenceStatus: "failed" }),
    /not saved/i,
  );
  assert.match(
    resultText({
      outcome: "cancelled",
      reason: "disconnected",
      persistenceStatus: "saved",
    }),
    /disconnected/i,
  );
});
test("prediction survives throttled snapshots but resets on server correction or a new round", () => {
  const snap = snapshot(),
    previous = portalView(snap);
  previous.players[1].x = 1;
  assert.equal(portalView(snap, previous).players[1].x, 1);
  assert.equal(portalView(snap, previous, true).players[1].x, 0);
  snap.room.session.sessionId = "new-round";
  assert.equal(portalView(snap, previous).players[1].x, 0);
});
test("a disconnected player can abandon the connection instead of being trapped by an unavailable room request", async () => {
  const calls = [];
  const conn = {
    state: "reconnecting",
    leaveRoom: async () => {
      throw Error("Cannot send a room request while reconnecting");
    },
    leaveWorld: async () => {
      calls.push("leave");
      return { data: null, error: null };
    },
  };
  assert.equal((await leaveLiveRoom(conn)).error, null);
  assert.deepEqual(calls, ["leave"]);
});

test("history rows do not invent teammates or turn cancellations into scores", () => {
  assert.deepEqual(
    historyRow({
      gameType: "portal-partners",
      outcome: "cancelled",
      score: 2,
      completedAt: "2026-11-23T18:00:00Z",
      players: [{ displayName: "A" }],
      persistenceStatus: "saved",
    }),
    {
      game: "Portal Partners",
      result: "Cancelled",
      playedWith: "A",
      score: "No score",
      dateTime: "2026-11-23T18:00:00Z",
      persistenceStatus: "Saved",
    },
  );
  assert.equal(
    historyRow({
      gameType: "portal-partners",
      outcome: "win",
      score: 2,
      completedAt: "2026-11-23T18:00:00Z",
      players: [],
    }).playedWith,
    "Teammate unavailable",
  );
});

test("ready labels distinguish ready, waiting, and round started", () => {
  assert.equal(readyLabel({ ready: true }, false), "You are ready");
  assert.equal(readyLabel({ ready: false }, false), "Ready");
  assert.equal(readyLabel({ ready: true }, true), "Round started");
  assert.equal(readyLabel(null, false), "Waiting for account");
});

test("Enter dismisses the live intro first and readies only a waiting player", () => {
  assert.equal(
    liveState.enterShortcutAction?.({ introOpen: true, waiting: true, ready: false }),
    "dismiss-intro",
  );
  assert.equal(
    liveState.enterShortcutAction?.({ introOpen: false, waiting: true, ready: false }),
    "ready",
  );
  assert.equal(
    liveState.enterShortcutAction?.({ introOpen: false, waiting: true, ready: true }),
    null,
  );
  assert.equal(
    liveState.enterShortcutAction?.({ introOpen: false, waiting: false, ready: false }),
    null,
  );
});

test("room occupancy labels use supplied live board state and practice labels for other rooms", () => {
  assert.equal(roomOccupancyLabel("cafe", null), "Local practice");
  assert.equal(
    roomOccupancyLabel("portal", {
      id: "portal",
      status: "waiting",
      players: [{ id: "a" }],
    }),
    "Waiting · 1/2",
  );
  assert.equal(
    roomOccupancyLabel("portal", {
      id: "portal",
      status: "playing",
      players: [{ id: "a" }, { id: "b" }],
    }),
    "Playing · 2/2",
  );
});

test("bridge feedback uses text for the authoritative bridge state", () => {
  assert.equal(bridgeStatusLabel({ bridgeOpen: false, latched: false }), "Bridge closed");
  assert.equal(bridgeStatusLabel({ bridgeOpen: true, latched: false }), "Bridge open");
  assert.equal(bridgeStatusLabel({ bridgeOpen: true, latched: true }), "Bridge open and latched");
});

test("history dates use MM/DD/YYYY and a readable stated timezone", () => {
  assert.equal(
    formatHistoryDate("2026-11-23T18:00:00Z", "America/Chicago"),
    "11/23/2026",
  );
});

test("Workshop projects server gear targets, sockets and carried cables", () => {
  const state = snapshot();
  state.self.roomId = "workshop";
  Object.assign(state.room.session, {
    gameType: "power-up-workshop",
    gears: [2, 0, 1],
    gearTargets: [2, 3, 1],
    sockets: [true, false, false],
    socketCables: [1, 2, 0],
    held: [null, 2],
  });
  const view = portalView(state);
  assert.equal(view.id, "workshop");
  assert.deepEqual(view.gears, [2, 0, 1]);
  assert.deepEqual(view.config, { gears: [2, 3, 1], sockets: [1, 2, 0] });
  assert.equal(view.players[view.active].held, "cable-2");
  assert.ok(Math.abs(advancePortal({ x: 4, z: 1.3 }, 0, -1, 0.1, false, true).z - 0.9) < 1e-9);
});

test("Workshop server errors are not reported as a player leaving", () => {
  assert.match(resultText({ outcome: "cancelled", reason: "error", persistenceStatus: "saved" }), /game server encountered an error/);
  assert.equal(historyRow({ gameType: "power-up-workshop", outcome: "cancelled" }).game, "Power-Up Workshop");
});
