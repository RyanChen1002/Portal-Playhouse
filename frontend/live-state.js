// Display projection only. The shared client owns protocol and authoritative state.
export async function leaveLiveRoom(connection) {
  return connection.state === "connected"
    ? connection.leaveRoom()
    : connection.leaveWorld();
}
export function portalView(snapshot, previous = null, reset = false) {
  const room = snapshot.room,
    round = room.session;
  const players = room.players
    .slice(0, 2)
    .map((p) => ({
      id: p.id,
      name: p.displayName,
      avatarId: p.avatarId,
      x: p.position?.x ?? 0,
      z: p.position?.z ?? 6,
      held: null,
      visible: !!p.position,
      connected: p.connected,
    }));
  while (players.length < 2)
    players.push({ x: 0, z: 6, held: null, visible: false });
  const active = Math.max(
    0,
    players.findIndex((p) => p.id === snapshot.self.playerId),
  );
  const prior = previous?.players.find((p) => p.id === snapshot.self.playerId);
  if (!reset && prior && previous.sessionId === round?.sessionId) {
    players[active].x = prior.x;
    players[active].z = prior.z;
  }
  return {
    id: "portal",
    sessionId: round?.sessionId,
    players,
    active,
    status: round ? "playing" : "waiting",
    elapsed: round
      ? Math.max(
          0,
          (Date.parse(round.serverTime) - Date.parse(round.startedAt)) / 1000,
        )
      : 0,
    limit: round?.durationSeconds ?? 180,
    latched: round?.latched ?? false,
    crystals: round?.crystals ?? [false, false],
    authoritativeBridgeOpen: round?.bridgeOpen ?? false,
  };
}
export function advancePortal(p, dx, dz, dt, bridge) {
  const next = { ...p },
    length = Math.hypot(dx, dz);
  if (!length) return next;
  for (const [axis, delta] of [
    ["x", dx],
    ["z", dz],
  ]) {
    const candidate = {
      ...next,
      [axis]:
        next[axis] + (delta / length) * 4 * Math.min(0.1, Math.max(0, dt)),
    };
    if (Math.abs(candidate.x) > 9.6 || Math.abs(candidate.z) > 7.7) continue;
    if (
      Math.abs(candidate.z) < 1.25 &&
      (!bridge || Math.abs(candidate.x) > 1.2)
    )
      continue;
    next[axis] = candidate[axis];
  }
  return next;
}
export function resultText(result) {
  if (!result) return "";
  const outcome =
    result.outcome === "win"
      ? "You made it together."
      : result.outcome === "loss"
        ? "Time ran out. Try again together."
        : `Round cancelled${result.reason === "disconnected" ? " — a teammate disconnected" : " — a player left"}.`;
  return (
    outcome +
    " " +
    ({
      pending: "Saving is pending.",
      saved: "Result saved.",
      failed: "Result not saved yet.",
    }[result.persistenceStatus] ?? "Save status unavailable.")
  );
}
