import {
  portalView,
  advancePortal,
  resultText,
  leaveLiveRoom,
} from "./live-state.js";
import { createStage } from "./games/scene.js";
import { targets, near } from "./games/rules.js";

// Dev only. Public browser credentials; never put a service/secret key here.
const config = {
  url: "https://cszopjtqhjkvgioebmha.supabase.co",
  publishableKey: "sb_publishable_WKP5UWyKTsnJI2HWFf68CQ_E7euuZBo",
  runtimeUrl: "wss://portal-runtime-dev.levon-adam.workers.dev/connect",
  storageKey: "portal-playhouse-dev-auth",
};
const $ = (s) => document.querySelector(s);
let client,
  connection,
  profile,
  unsub = [],
  online = false,
  practiceAway = false,
  busy = false,
  stage,
  view,
  roster = "",
  last = 0,
  raf = 0,
  menu = false,
  confirmLeave = false,
  resetPrediction = true;
const keys = new Set();
const live = (window.playhouseLive = {
  get online() {
    return online;
  },
  get connected() {
    return connection?.state === "connected";
  },
  get profile() {
    return profile;
  },
  move(position, rotation) {
    if (connection?.state === "connected")
      connection.sendMove(position, rotation);
  },
});
function message(text) {
  $("#notice").textContent = text;
  $("#notice").hidden = false;
}
function checked(result) {
  if (result.error) throw Error(result.error.message || result.error.code);
  return result.data;
}
async function getClient() {
  if (!client) {
    const { createPortalClient } = await import("/portal-client.js");
    client = createPortalClient({ ...config, storage: localStorage });
  }
  return client;
}
function applyProfile(p) {
  profile = p;
  window.dispatchEvent(new CustomEvent("playhouse-profile", { detail: p }));
  $("#welcome-avatars")
    .querySelectorAll("button")
    .forEach((button, index) =>
      button.setAttribute(
        "aria-pressed",
        String(index === Number(p.avatarId.slice(-2)) - 1),
      ),
    );
}
function modeLabels() {
  const label = $(".topbar > span");
  const text = [...label.childNodes].find((node) => node.nodeType === 3);
  if (text) text.textContent = online ? " ONLINE DEV " : " PRACTICE MODE ";
  $(".page-footer > span:last-child").textContent = online
    ? "Portal Partners online · Four local practice games"
    : "Five local practice games";
  $(".player-card small").textContent = online
    ? "Development account"
    : "Practice player";
  $("#profile .profile-preview .pill").textContent = online
    ? "Saved development profile"
    : "Practice profile";
  $("#profile-form > p:last-child").textContent = online
    ? "Your display name and avatar are saved to your development account."
    : "Practice changes reset when you reload.";
  $("#name-help").textContent = online
    ? "Choose a unique display name with 1–24 characters."
    : "1–24 characters. Demo names already in use: Milo, Nova, Pip, Remy, Sol.";
  $("#history .empty-state h2").textContent = online
    ? "Online results and local practice"
    : "Your story starts here.";
  $("#history .empty-state p").textContent = online
    ? "Portal Partners results are loaded from your account. Local practice results below are separate and reset on reload."
    : "Practice results appear below after you play. They reset on reload and are not saved online.";
}
async function refreshHistory() {
  if (!online || !client) return;
  try {
    const data = checked(await client.getMyResults());
    let list = $("#online-history");
    if (!list) {
      list = document.createElement("div");
      list.id = "online-history";
      $("#history").append(list);
    }
    list.replaceChildren();
    for (const result of data.results) {
      const p = document.createElement("p");
      p.textContent =
        "Portal Partners · " +
        result.outcome +
        " · " +
        result.score +
        " points · " +
        new Date(result.completedAt).toLocaleString();
      list.append(p);
    }
    applyProfile(checked(await client.getMe()));
    $("#history .pill").textContent =
      profile.winsTotal + " wins · Saved results";
  } catch (error) {
    message("Could not load saved history: " + error.message);
  }
}
window.addEventListener("hashchange", () => {
  if (location.hash === "#history") refreshHistory();
});
function emit(reset = false) {
  if (!connection) return;
  window.dispatchEvent(
    new CustomEvent("playhouse-online-state", {
      detail: {
        snapshot: connection.snapshot(),
        state: connection.state,
        reset,
      },
    }),
  );
}
function disconnectView() {
  unsub.forEach((fn) => fn());
  unsub = [];
  connection = null;
}
async function connect() {
  disconnectView();
  connection = checked(await client.connectWorld());
  for (const name of [
    "player.joined",
    "player.left",
    "player.updated",
    "player.connection",
    "player.ready",
    "room.updated",
    "game.state",
    "game.finished",
    "result.saved",
  ])
    unsub.push(connection.on(name, () => emit()));
  for (const name of ["world.snapshot", "room.snapshot", "player.corrected"])
    unsub.push(connection.on(name, () => emit(true)));
  unsub.push(
    connection.onConnectionState((state) => {
      keys.clear();
      emit(state === "connected");
      if (state === "closed" && connection.closeReason !== "left")
        message(
          "Connection ended: " +
            connection.closeReason +
            ". Leave the playhouse and sign in again to reconnect.",
        );
    }),
  );
  modeLabels();
  emit(true);
  return connection;
}
async function updateProfile(input) {
  const p = checked(await client.updateMe(input));
  applyProfile(p);
  return p;
}
live.updateProfile = updateProfile;

// Preserve the offline welcome flow and explicitly opt into real development accounts.
const form = $("#login-form"),
  offlineSubmit = form.onsubmit;
const mode = document.createElement("button");
mode.type = "button";
mode.className = "button secondary";
mode.textContent = "Sign in to online play";
form.before(mode);
let authMode = false;
mode.onclick = () => {
  authMode = !authMode;
  mode.textContent = authMode
    ? "Use offline practice instead"
    : "Sign in to online play";
  $("#login-email").value = authMode ? "" : "explorer@example.test";
  $("#login-password").value = "";
  $("#login-password").placeholder = authMode
    ? "Your development account password"
    : "Enter sample password";
  form.querySelector("[type=submit]").textContent = authMode
    ? "Sign in and play online"
    : "Enter practice mode";
  $("#login-step .demo-disclosure").textContent = authMode
    ? "Development accounts only. Portal Partners is online; the other four games are local practice."
    : "Offline practice: explorer@example.test / playhouse-demo. Nothing is sent or saved.";
};
form.onsubmit = async (event) => {
  if (!authMode) return offlineSubmit(event);
  event.preventDefault();
  if (busy) return;
  busy = true;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const c = await getClient();
    applyProfile(
      checked(
        await c.signIn({
          email: $("#login-email").value,
          password: $("#login-password").value,
        }),
      ),
    );
    online = true;
    $("#login-error").textContent = "";
    $("#demo-enter").click();
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    $("#login-password").value = "";
    busy = false;
    button.disabled = false;
  }
};
$("#enter-world").addEventListener(
  "click",
  async (event) => {
    if (!online) return;
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    try {
      const selected = [...$("#welcome-avatars").children].findIndex(
        (el) => el.getAttribute("aria-pressed") === "true",
      );
      await updateProfile({
        avatarId: "avatar-" + String(selected + 1).padStart(2, "0"),
      });
      await connect();
      window.dispatchEvent(new Event("playhouse-online-enter"));
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
    }
  },
  true,
);
$("#profile-form").addEventListener(
  "submit",
  async (event) => {
    if (!online) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await updateProfile({
        displayName: $("#display-name").value,
        avatarId: new FormData(event.target).get("avatarId"),
      });
      $("#name-error").textContent = "";
      message("Profile saved.");
    } catch (error) {
      $("#name-error").textContent = error.message;
    }
  },
  true,
);
const offlineExit = $("#sign-out-demo").onclick;
$("#sign-out-demo").onclick = async () => {
  if (busy) return;
  busy = true;
  try {
    if (client && online) checked(await client.signOut());
    online = false;
    practiceAway = false;
    disconnectView();
    window.dispatchEvent(new Event("playhouse-offline"));
    modeLabels();
    $("#online-history")?.remove();
    offlineExit();
  } catch (error) {
    message(error.message);
  } finally {
    busy = false;
  }
};

const dialog = document.createElement("dialog");
dialog.id = "live-game-dialog";
dialog.className = "live-game-dialog";
dialog.setAttribute("aria-label", "Online Portal Partners");
document.body.append(dialog);
dialog.innerHTML =
  '<div class="game-shell"><div class="game-viewport" tabindex="0" role="group" aria-label="Online Portal Partners. WASD moves, E interacts, Escape opens the menu."></div><header class="game-top"><div class="game-title"><h1>Portal Partners</h1></div><div class="game-top-actions"><span class="game-clock" id="live-clock"></span><button class="game-button" data-live="menu">Menu · Esc</button></div></header><section class="game-goal"><span class="game-eyebrow">ONLINE · TWO PLAYERS</span><p id="live-goal"></p><p id="live-team"></p></section><footer class="game-toolbar"><p id="live-prompt"></p><div class="game-control-row"><span>WASD · Move</span><button class="game-button" data-live="interact">E · Interact</button><button class="game-button is-primary" data-live="ready">Ready</button></div><small id="live-status" role="status"></small></footer><section class="game-cover" hidden><div class="game-menu"><h2 id="live-menu-title">Take a moment.</h2><p id="live-menu-copy">The online round keeps running while this menu is open.</p><button class="game-button is-primary" data-live="resume">Keep playing</button><button class="game-button" data-live="leave">Return to lobby</button></div></section></div>';
function closeScene() {
  cancelAnimationFrame(raf);
  stage?.dispose();
  stage = null;
  roster = "";
  keys.clear();
  dialog.close();
  window.playhouseGameOpen = false;
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id: null } }),
  );
  $("#world").focus();
}
function openScene() {
  if (dialog.open) return;
  menu = false;
  confirmLeave = false;
  resetPrediction = true;
  last = 0;
  window.playhouseGameOpen = true;
  dialog.showModal();
  dialog.querySelector(".game-cover").hidden = true;
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id: "portal" } }),
  );
  dialog.querySelector(".game-viewport").focus();
  raf = requestAnimationFrame(frame);
}
async function enter(id) {
  if (busy) return;
  busy = true;
  try {
    if (id === "portal") {
      checked(await connection.joinRoom("portal"));
      emit(true);
      openScene();
    } else {
      checked(await connection.leaveWorld());
      disconnectView();
      practiceAway = true;
      window.dispatchEvent(new Event("playhouse-practice-away"));
      window.dispatchEvent(
        new CustomEvent("playhouse-enter-game", {
          detail: { id, practice: true },
        }),
      );
    }
  } catch (error) {
    message(error.message);
  } finally {
    busy = false;
  }
}
window.addEventListener("playhouse-enter-game", (event) => {
  if (online && !event.detail?.practice) enter(event.detail.id);
});
window.addEventListener("playhouse-game-status", async (event) => {
  if (practiceAway && !event.detail?.id) {
    practiceAway = false;
    try {
      await connect();
    } catch (error) {
      message(
        "Practice finished, but the online lobby could not reconnect: " +
          error.message,
      );
    }
  }
});
window.addEventListener("playhouse-online-state", (event) => {
  if (event.detail.reset) resetPrediction = true;
  if (event.detail.snapshot.self.roomId === "portal") openScene();
  else if (dialog.open) closeScene();
});
function showMenu(confirm = false) {
  menu = true;
  confirmLeave = confirm;
  keys.clear();
  dialog.querySelector(".game-cover").hidden = false;
  $("#live-menu-title").textContent = confirm
    ? "Leave this round?"
    : "Take a moment.";
  $("#live-menu-copy").textContent = confirm
    ? "Leaving an active round cancels it for both players."
    : "The online round keeps running. Hold the gold plate, let your teammate cross and pull the lever, then collect both crystals and meet at the exit.";
  dialog.querySelector("[data-live=leave]").textContent = confirm
    ? "Confirm leave"
    : "Return to lobby";
  dialog.querySelector("[data-live=resume]").focus();
}
async function command(cmd) {
  if (cmd === "menu") {
    showMenu();
    return;
  }
  if (cmd === "resume") {
    menu = false;
    confirmLeave = false;
    dialog.querySelector(".game-cover").hidden = true;
    dialog.querySelector(".game-viewport").focus();
    return;
  }
  if (!connection || busy) return;
  if (cmd === "leave" && connection.snapshot().room.session && !confirmLeave) {
    showMenu(true);
    return;
  }
  busy = true;
  try {
    if (cmd === "leave") {
      checked(await leaveLiveRoom(connection));
      closeScene();
      if (connection.state === "connected") emit(true);
      else {
        disconnectView();
        message(
          "You left the disconnected round. Leave the playhouse and sign in again to reconnect.",
        );
      }
    }
    if (cmd === "ready") {
      const me = connection
        .snapshot()
        .room.players.find((p) => p.id === connection.playerId);
      checked(await connection.setReady(!me?.ready));
    }
    if (
      cmd === "interact" &&
      connection.state === "connected" &&
      view?.status === "playing" &&
      !menu
    ) {
      const p = view.players[view.active],
        target = targets(view)
          .filter((t) => t.id !== "plate" && near(p, t))
          .sort(
            (a, b) =>
              Math.hypot(a.x - p.x, a.z - p.z) -
              Math.hypot(b.x - p.x, b.z - p.z),
          )[0];
      if (target) checked(await connection.interact(target.id));
    }
  } catch (error) {
    message(error.message);
  } finally {
    busy = false;
    if (dialog.open && !menu) dialog.querySelector(".game-viewport").focus();
  }
}
dialog.addEventListener("click", (event) => {
  const cmd = event.target.closest("[data-live]")?.dataset.live;
  if (cmd) command(cmd);
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  command(menu ? "resume" : "menu");
});
dialog.addEventListener("keydown", (event) => {
  const k = event.key.toLowerCase();
  if (k === "escape") {
    event.preventDefault();
    event.stopPropagation();
    command(menu ? "resume" : "menu");
    return;
  }
  if (menu || event.target !== dialog.querySelector(".game-viewport")) return;
  if (
    [
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
    ].includes(k)
  ) {
    event.preventDefault();
    keys.add(k);
  }
  if (k === "e" && !event.repeat) {
    event.preventDefault();
    command("interact");
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => keys.clear());
dialog.addEventListener("focusout", () => keys.clear());
function frame(now) {
  if (!dialog.open || !connection) return;
  const dt = last ? Math.min(0.04, (now - last) / 1000) : 0;
  last = now;
  const snapshot = connection.snapshot(),
    next = portalView(snapshot, view, resetPrediction),
    key = next.players.map((p) => (p.id || "") + p.avatarId + p.name).join("|");
  resetPrediction = false;
  if (key !== roster) {
    stage?.dispose();
    view = next;
    roster = key;
    try {
      stage = createStage(dialog.querySelector(".game-viewport"), view);
    } catch (error) {
      $("#live-goal").textContent =
        "3D could not start. Use Menu to return to the lobby.";
      showMenu();
      return;
    }
  } else Object.assign(view, next);
  if (
    connection.state === "connected" &&
    view.status === "playing" &&
    !menu &&
    !document.hidden &&
    document.activeElement === dialog.querySelector(".game-viewport")
  ) {
    const dx =
        Number(keys.has("d") || keys.has("arrowright")) -
        Number(keys.has("a") || keys.has("arrowleft")),
      dz =
        Number(keys.has("s") || keys.has("arrowdown")) -
        Number(keys.has("w") || keys.has("arrowup"));
    if (dx || dz) {
      const p = view.players[view.active],
        candidate = advancePortal(p, dx, dz, dt, view.authoritativeBridgeOpen);
      Object.assign(p, candidate);
      connection.sendMove({ x: p.x, y: 0, z: p.z }, Math.atan2(dx, dz));
    }
  }
  const me = snapshot.room.players.find((p) => p.id === connection.playerId),
    round = snapshot.room.session,
    result = snapshot.lastFinished;
  $("#live-goal").textContent = round
    ? round.crystals.every(Boolean)
      ? "Meet at the exit together and press E."
      : round.latched
        ? "Collect both crystals."
        : "Hold the gold plate so your teammate can cross and pull the lever."
    : "Both players choose Ready to begin.";
  $("#live-team").textContent = snapshot.room.players
    .map(
      (p) =>
        p.displayName +
        (p.connected ? "" : " (reconnecting)") +
        (p.ready ? " · ready" : ""),
    )
    .join(" / ");
  const ready = dialog.querySelector("[data-live=ready]");
  ready.hidden = !!round;
  ready.disabled = connection.state !== "connected" || busy;
  ready.textContent = me?.ready ? "Not ready" : "Ready";
  $("#live-clock").textContent = round
    ? Math.ceil(Math.max(0, view.limit - view.elapsed)) + "s"
    : "Waiting";
  $("#live-status").textContent =
    connection.state !== "connected"
      ? "Connection " + connection.state + " — movement is paused locally."
      : !round && result
        ? resultText(result)
        : "Live development game · Server controls the round";
  const p = view.players[view.active],
    target = targets(view).find((t) => near(p, t));
  $("#live-prompt").textContent = target
    ? target.id === "plate"
      ? "Stay on the plate to hold the bridge."
      : "E · " + target.label
    : "Walk up to a mechanism to interact.";
  stage.render(dt, now / 1000);
  raf = requestAnimationFrame(frame);
}
