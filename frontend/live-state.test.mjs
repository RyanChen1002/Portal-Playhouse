import test from "node:test";
import assert from "node:assert/strict";
import {
  portalView,
  advancePortal,
  resultText,
  leaveLiveRoom,
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
