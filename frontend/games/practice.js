// Local practice progression only. Portal Partners delegates unchanged to rules.js.
import * as base from "./rules.js";
export const { games, near, move, bridgeOpen } = base;
export const levelCount = (id) =>
  id === "portal" ? 1 : games.some((g) => g.id === id) ? 5 : 0;
const orders = [
  [],
  ["salad", "soup", "salad", "soup"],
  ["salad", "salad", "soup", "soup", "salad", "soup"],
  ["soup", "salad", "soup", "salad", "salad", "soup"],
  ["salad", "soup", "soup", "salad", "soup", "salad", "salad", "soup"],
  [
    "soup",
    "salad",
    "salad",
    "soup",
    "salad",
    "soup",
    "soup",
    "salad",
    "soup",
    "salad",
  ],
];
const delivery = [
  [],
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 1, 2, 0],
  [2, 0, 3, 1],
  [1, 3, 0, 2],
];
const gears = [[], [1, 2, 3], [2, 3, 1], [3, 1, 2], [1, 3, 2], [3, 2, 1]];
const sockets = [[], [0, 1, 2], [0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
// Each route is a connected sequence of three-unit horizontal/vertical steps.
const paths = [
  [],
  base.route,
  [
    [-6, 3, 0],
    [-3, 3, 0],
    [-3, 0, 1],
    [0, 0, 0],
    [0, -3, 1],
    [3, -3, 0],
  ],
  [
    [-6, 3, 0],
    [-3, 3, 0],
    [0, 3, 0],
    [0, 0, 1],
    [-3, 0, 0],
    [-3, -3, 1],
  ],
  [
    [-6, -3, 0],
    [-3, -3, 0],
    [-3, 0, 1],
    [0, 0, 0],
    [0, 3, 1],
    [3, 3, 0],
  ],
  [
    [-6, 3, 0],
    [-6, 0, 1],
    [-3, 0, 0],
    [-3, -3, 1],
    [0, -3, 0],
    [0, 0, 1],
  ],
];
const titles = {
  cafe: [
    "First orders",
    "Lunch rush",
    "Pass the plate",
    "Team service",
    "Changing shifts",
  ],
  rescue: [
    "Make room",
    "A careful order",
    "Fresh layout",
    "Take turns",
    "Spotter team",
  ],
  train: [
    "First departure",
    "Uphill line",
    "Switchback",
    "Downhill line",
    "Mountain line",
  ],
  workshop: [
    "First spark",
    "New combination",
    "Cross connections",
    "Circuit shuffle",
    "Reverse circuit",
  ],
};
export const levelTitle = (s) =>
  titles[s.id]?.[(s.level || 1) - 1] || "A little teamwork";
// Presentation only: explain the next legal step without changing game state.
export function nextMove(s) {
  const p = s.players[s.active],
    held = p.held;
  if (s.status !== "playing")
    return s.status === "won"
      ? "Round complete. Replay whenever you like."
      : s.message;
  if (s.id === "cafe") {
    const dish = s.config?.orders[s.score] || (s.score % 2 ? "soup" : "salad");
    if (s.job)
      return (
        "Stay by the " +
        (s.job.dish === "soup" ? "stove" : "chopping board") +
        " while the dish is prepared."
      );
    if (s.tray)
      return s.tray.from === s.active
        ? "Press Q to switch teammates and collect the dish from the tray."
        : "Collect the prepared dish from the shared tray.";
    if (held?.startsWith("raw-"))
      return (
        "Take these ingredients to the " +
        (held === "raw-soup" ? "stove" : "chopping board") +
        "."
      );
    if (held?.startsWith("ready-"))
      return s.level >= 3 && !s.passedBy[s.active]
        ? "Put the dish on the shared tray for your teammate."
        : "Bring the finished dish to the serving counter.";
    return "Take " + dish + " ingredients from the rear counter.";
  }
  if (s.id === "rescue") {
    if (s.carrySofa)
      return s.rotation % 2
        ? "Press R away from the wall to turn the sofa across the doorway."
        : "Carry the sofa through the center doorway to its outline.";
    if (held)
      return (
        "Carry item " +
        (Number(held.slice(-1)) + 1) +
        " through the center doorway" +
        (s.level === 5 ? "; bring your teammate to its outline." : ".")
      );
    const next = (s.config?.delivery || [0, 1, 2, 3]).find((i) => !s.items[i]);
    if (next !== undefined)
      return s.level >= 4 && s.lastCarrier === s.active
        ? "Switch to teammate " + (2 - s.active) + " for the next delivery."
        : "Pick up item " + (next + 1) + " on the left side.";
    return "Bring both teammates to the sofa with empty hands.";
  }
  if (s.id === "train") {
    const i = s.rails.findIndex((done) => !done);
    if (i < 0)
      return "All tracks are ready. Watch the train reach the station.";
    if (held === "track")
      return (
        "Fit track " +
        (i + 1) +
        " · " +
        (getRoute(s)[i].rotation ? "vertical" : "horizontal") +
        " (R turns the piece)."
      );
    return (
      "Collect a track from the supply rack." +
      (s.elapsed < 25
        ? " Train leaves in " + Math.ceil(25 - s.elapsed) + "s."
        : " Build ahead of the train.")
    );
  }
  if (s.id === "workshop") {
    if (held)
      return (
        "Connect cable " +
        String.fromCharCode(65 + Number(held.slice(-1))) +
        " to the socket with the same letter."
      );
    if (!s.gears.every((v, i) => v === (s.config?.gears[i] || i + 1)))
      return "Press E at each gear until its number matches the target.";
    if (!s.sockets.every(Boolean))
      return "Collect a cable and match its letter to a socket.";
    return "Leave one teammate on the left power pad; activate the right pad with the other.";
  }
  return (
    objectives(s).find(([, done]) => !done)?.[0] || "All objectives complete"
  );
}
export function createSession(id, level = 1) {
  if (!Number.isInteger(level) || level < 1 || level > levelCount(id))
    throw Error("Unknown game or level");
  const s = base.createSession(id);
  if (id === "portal") return s;
  s.level = level;
  s.config = {
    orders: [...orders[level]],
    delivery: [...delivery[level]],
    gears: [...gears[level]],
    sockets: [...sockets[level]],
  };
  if (id === "cafe" && level > 1) {
    s.limit = level < 4 ? 240 : 300;
    s.tray = null;
    s.passedBy = [false, false];
    s.lastServer = null;
  }
  if (id === "rescue" && level > 1) s.lastCarrier = null;
  return s;
}
export const getRoute = (s) =>
  s.id !== "train" || (s.level || 1) === 1
    ? base.route
    : paths[s.level].map(([x, z, rotation]) => ({ x, z, rotation }));
const extended = (s) => s.id !== "portal" && s.level > 1;
const fail = (s, message) => {
  s.message = message;
  return false;
};
const win = (s) => {
  s.status = "won";
  s.message = "Level complete. This practice result is not saved online.";
};
export function targets(s) {
  if (!extended(s)) return base.targets(s);
  if (s.id === "train")
    return [
      { id: "supply", x: -7, z: 6, label: "Take track piece" },
      ...getRoute(s).flatMap((r, i) =>
        s.rails[i]
          ? []
          : [
              {
                ...r,
                id: "rail-" + i,
                label: `Track ${i + 1} · ${r.rotation ? "vertical" : "horizontal"}`,
              },
            ],
      ),
    ];
  if (s.id === "workshop")
    return [
      ...s.gears.map((v, i) => ({
        id: "gear-" + i,
        x: -6 + i * 6,
        z: -5,
        label: `Gear ${i + 1} · target ${s.config.gears[i]}`,
      })),
      ...[0, 1, 2].flatMap((i) =>
        s.sockets[s.config.sockets.indexOf(i)]
          ? []
          : [
              {
                id: "cable-" + i,
                x: -6 + i * 6,
                z: 1,
                label: "Take cable " + String.fromCharCode(65 + i),
              },
            ],
      ),
      ...s.sockets.flatMap((v, i) =>
        v
          ? []
          : [
              {
                id: "socket-" + i,
                x: -6 + i * 6,
                z: -2,
                label:
                  "Connect cable " +
                  String.fromCharCode(65 + s.config.sockets[i]),
              },
            ],
      ),
      { id: "power-left", x: -4, z: 5, label: "Hold left power" },
      { id: "power-right", x: 4, z: 5, label: "Activate portal" },
    ];
  const list = base.targets(s);
  if (s.id === "rescue")
    for (const t of list)
      if (t.id === s.players[s.active].held)
        t.label = "Return item " + (Number(t.id.slice(-1)) + 1);
  if (s.id === "cafe") {
    list.find((t) => t.id === "serve").label =
      "Serve " + (s.config.orders[s.score] || "all orders");
    if (s.level >= 3)
      list.push({
        id: "handoff",
        x: 0,
        z: 3,
        label: s.tray ? "Collect teammate’s dish" : "Pass dish to teammate",
      });
  }
  return list;
}
export function act(s, id) {
  if (!extended(s)) return base.act(s, id);
  if (s.status !== "playing") return false;
  if (["cancel", "switch", "rotate"].includes(id)) return base.act(s, id);
  const p = s.players[s.active],
    t = targets(s).find((t) => t.id === id);
  if (!t || !near(p, t)) return fail(s, "Walk closer to the marked object.");
  if (s.id === "cafe") {
    if (id === "handoff") {
      if (s.tray) {
        if (p.held || s.tray.from === s.active)
          return fail(
            s,
            "The other teammate needs empty hands to collect this dish.",
          );
        p.held = s.tray.dish;
        s.tray = null;
        s.passedBy[s.active] = true;
        s.message = "Dish collected. Take it to the serving counter.";
        return true;
      }
      if (!p.held?.startsWith("ready-"))
        return fail(s, "Prepare a dish before passing it.");
      s.tray = { dish: p.held, from: s.active };
      p.held = null;
      s.passedBy[s.active] = false;
      s.message = "Dish on the tray. Switch teammates with Q to collect it.";
      return true;
    }
    if (id === "serve") {
      if (p.held !== "ready-" + s.config.orders[s.score]) {
        s.mistakes++;
        return fail(
          s,
          "The current order needs prepared " + s.config.orders[s.score] + ".",
        );
      }
      if (s.level >= 3 && !s.passedBy[s.active])
        return fail(s, "Pass this dish through the shared tray first.");
      if (s.level === 5 && s.lastServer === s.active)
        return fail(s, "Take turns serving. Pass this dish to your teammate.");
      p.held = null;
      s.passedBy[s.active] = false;
      s.lastServer = s.active;
      s.score++;
      s.message = "Order served. Nice teamwork!";
      if (s.score === s.config.orders.length) win(s);
      return true;
    }
    const ok = base.act(s, id);
    if (ok && ["bin", "salad", "soup"].includes(id))
      s.passedBy[s.active] = false;
    return ok;
  }
  if (s.id === "rescue" && id.startsWith("item-") && p.held === id) {
    p.held = null;
    s.message = "Item returned. Pick up the next requested item.";
    return true;
  }
  if (s.id === "rescue" && id.startsWith("spot-")) {
    const next = s.config.delivery.find((i) => !s.items[i]);
    if (id !== "spot-" + next)
      return fail(
        s,
        "Next delivery: item " + (next + 1) + ". Keep hold of this item.",
      );
    if (s.level >= 4 && s.lastCarrier === s.active)
      return fail(s, "The other teammate makes the next delivery.");
    if (s.level === 5 && !near(s.players[1 - s.active], t, 2.7))
      return fail(s, "Bring your teammate here to help position the item.");
    const ok = base.act(s, id);
    if (ok) s.lastCarrier = s.active;
    return ok;
  }
  if (s.id === "train" && id.startsWith("rail-")) {
    const i = Number(id.slice(5));
    if (p.held !== "track") return fail(s, "Fetch a track piece first.");
    if (s.rotation % 2 !== getRoute(s)[i].rotation) {
      s.mistakes++;
      return fail(s, "Press R to match the marked track direction.");
    }
    s.rails[i] = true;
    p.held = null;
    s.score = s.rails.filter(Boolean).length;
    s.message = "Track fitted. Keep building ahead of the train.";
    return true;
  }
  if (s.id === "workshop") {
    const n = Number(id.slice(-1));
    if (id.startsWith("gear-")) {
      s.gears[n] = (s.gears[n] + 1) % 4;
      s.message = `Gear ${n + 1}: ${s.gears[n]} / target ${s.config.gears[n]}.`;
    } else if (id.startsWith("socket-")) {
      if (p.held !== "cable-" + s.config.sockets[n]) {
        s.mistakes++;
        return fail(
          s,
          "This socket needs cable " +
            String.fromCharCode(65 + s.config.sockets[n]) +
            ".",
        );
      }
      s.sockets[n] = true;
      p.held = null;
      s.message = "Cable connected.";
    } else if (id === "power-right") {
      if (
        !s.gears.every((v, i) => v === s.config.gears[i]) ||
        !s.sockets.every(Boolean) ||
        !near(s.players[1 - s.active], { x: -4, z: 5 })
      )
        return fail(
          s,
          "Match the gears and cables, then hold both power stations.",
        );
      win(s);
    } else if (id === "power-left")
      s.message = "Stay here and switch teammates with Q.";
    else {
      if (p.held || s.players.some((player) => player.held === id))
        return fail(
          s,
          "Connect the held cable first. Each cable can be carried once.",
        );
      p.held = id;
      s.message = "Find the socket with this cable letter.";
    }
    s.score =
      s.gears.filter((v, i) => v === s.config.gears[i]).length +
      s.sockets.filter(Boolean).length;
    return true;
  }
  return base.act(s, id);
}
export function step(s, dt) {
  base.step(s, dt);
}
export function objectives(s) {
  if (!extended(s)) return base.objectives(s);
  if (s.id === "cafe")
    return s.config.orders.map((dish, i) => [
      `Order ${i + 1}: ${dish}${s.level >= 3 ? " · pass to teammate" : ""}${s.level === 5 && s.lastServer !== null && i === s.score ? " · teammate " + (2 - s.lastServer) + " serves" : ""}`,
      s.score > i,
    ]);
  if (s.id === "rescue")
    return [
      ...s.config.delivery.map((i) => [
        `Place item ${i + 1}${s.level >= 4 ? " · take turns" : ""}${s.level === 5 ? " · both teammates at outline" : ""}`,
        s.items[i],
      ]),
      ["Place sofa together", s.sofaDone],
    ];
  if (s.id === "workshop")
    return [
      [
        `Gears match ${s.config.gears.join(" / ")}`,
        s.gears.every((v, i) => v === s.config.gears[i]),
      ],
      ["Match each cable to its lettered socket", s.sockets.every(Boolean)],
      ["Hold both power stations", s.status === "won"],
    ];
  return base.objectives(s);
}
