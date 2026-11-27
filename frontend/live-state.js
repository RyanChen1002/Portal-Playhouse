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
  const workshop = snapshot.self.roomId === "workshop";
  if (workshop) players.forEach((player, index) => {
    const cable = round?.held?.[index];
    player.held = cable == null ? null : "cable-" + cable;
  });
  return {
    id: workshop ? "workshop" : "portal",
    ...(workshop && {
      gears: round?.gears ?? [0, 0, 0],
      sockets: round?.sockets ?? [false, false, false],
      config: { gears: round?.gearTargets ?? [1, 2, 3], sockets: round?.socketCables ?? [0, 1, 2] },
    }),
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
export function advancePortal(p, dx, dz, dt, bridge, workshop = false) {
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
      !workshop && Math.abs(candidate.z) < 1.25 &&
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
        : ({
            disconnected: "Round cancelled because a teammate disconnected.",
            left: "Round cancelled because a player left.",
            error: "Round cancelled because the game server encountered an error.",
          }[result.reason ?? result.cancelReason] ?? "Round cancelled.");
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

export function historyRow(result, selfId = null) {
  const game =
    result.gameType === "portal-partners"
      ? "Portal Partners"
      : result.gameType === "power-up-workshop" ? "Power-Up Workshop"
      : String(result.gameType || "Unknown game");
  const outcome = {
    win: "Win",
    loss: "Loss",
    cancelled: "Cancelled",
  }[result.outcome] ?? "Unknown";
  const teammate = result.players?.find(
    (player) => player.displayName && (!selfId || player.id !== selfId),
  )?.displayName;
  return {
    game,
    result: outcome,
    playedWith: teammate || "Teammate unavailable",
    score: outcome === "Cancelled" ? "No score" : String(result.score ?? "No score"),
    dateTime: result.completedAt || "Date unavailable",
    persistenceStatus:
      ({
        pending: "Pending",
        saved: "Saved",
        failed: "Failed",
      }[result.persistenceStatus] ?? "Unknown"),
  };
}

export function readyLabel(player, roundStarted) {
  if (roundStarted) return "Round started";
  if (!player) return "Waiting for account";
  return player.ready ? "You are ready" : "Ready";
}

export function enterShortcutAction({
  introOpen = false,
  waiting = false,
  ready = false,
  menuOpen = false,
  resultOpen = false,
}) {
  if (menuOpen || resultOpen) return null;
  if (introOpen) return "dismiss-intro";
  return waiting && !ready ? "ready" : null;
}

export function roomOccupancyLabel(roomId, room) {
  if (roomId !== "portal" && !(roomId === "workshop" && room)) return "Local practice";
  if (!room) return "Waiting · 0/2";
  const status = room.status === "playing" ? "Playing" : "Waiting";
  return `${status} · ${room.players?.length || 0}/2`;
}

export function bridgeStatusLabel(round) {
  if (!round) return "Bridge closed";
  if (round.latched) return "Bridge open and latched";
  return round.bridgeOpen ? "Bridge open" : "Bridge closed";
}

export function formatHistoryDate(iso, timeZone) {
  if (!iso) return "Date unavailable";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  const options = timeZone ? { timeZone } : undefined;
  const year = new Intl.DateTimeFormat("en-US", { year: "numeric", ...options }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { month: "2-digit", ...options }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { day: "2-digit", ...options }).format(date);
  return `${month}/${day}/${year}`;
}
