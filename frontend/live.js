import {
  portalView,
  advancePortal,
  resultText,
  leaveLiveRoom,
  historyRow,
  readyLabel,
  bridgeStatusLabel,
  formatHistoryDate,
  enterShortcutAction,
} from "./live-state.js";
import { createStage } from "./games/scene.js";
import { bindDialogEscape } from "./games/menu.js";
import { authenticate, notifyAuthenticated, welcomeView } from "./auth.js";
import { near } from "./games/rules.js";
import { targets } from "./games/practice.js";

import { supportsOnlineRoom } from "./games/rooms.js";
const workshopGuide = "Match the gear targets, connect the cables to the labeled sockets, then have one teammate stand on left power while the other activates right power.";

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
  historyResults = [],
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
  intro = false,
  introSeen = false,
  lastResultId = null,
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
    ? "Online play · Practice also available"
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
    ? "Online results are loaded from your account. Local practice results below are separate and reset on reload."
    : "Practice results appear below after you play. They reset on reload and are not saved online.";
}
let historyRequest = null;
async function refreshHistory(cursor = null) {
  if (!online || !client || historyRequest) return;
  const request = {};
  historyRequest = request;
  let list = $("#online-history");
  if (!list) {
    list = document.createElement("div");
    list.id = "online-history";
    $("#history").append(list);
  }
  list.querySelector(".history-error")?.remove();
  const more = list.querySelector(".history-more");
  if (more) more.disabled = true;
  list.setAttribute("aria-busy", "true");
  try {
    const data = checked(await client.getMyResults(cursor ? { cursor } : {}));
    const freshProfile = checked(await client.getMe());
    if (!online || !list.isConnected || historyRequest !== request) return;
    historyResults = cursor ? [...historyResults, ...data.results] : data.results;
    applyProfile(freshProfile);
    list.replaceChildren();
    if (!historyResults.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "No completed online rounds yet.";
      list.append(empty);
    } else {
      const table = document.createElement("table");
      table.className = "history-table";
      table.innerHTML =
        "<thead><tr><th>Game</th><th>Result</th><th>Played with</th><th>Score</th><th>Date and time</th></tr></thead>";
      const body = document.createElement("tbody");
      for (const result of historyResults) {
        const row = historyRow(result, profile?.id);
        const date = new Date(row.dateTime);
        const dateText =
          row.dateTime === "Date unavailable" || Number.isNaN(date.valueOf())
            ? "Date unavailable"
            : formatHistoryDate(row.dateTime) +
              " " +
              date.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              });
        const tr = document.createElement("tr");
        for (const [label, value] of [
          ["Game", row.game],
          ["Result", row.result],
          ["Played with", row.playedWith],
          ["Score", row.score],
          ["Date and time", dateText],
        ]) {
          const td = document.createElement("td");
          td.dataset.label = label;
          td.textContent = value;
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      list.append(table);
      if (data.nextCursor) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "button secondary history-more";
        more.textContent = "Load more";
        more.onclick = () => refreshHistory(data.nextCursor);
        list.append(more);
      }
    }
    $("#history .pill").textContent =
      profile.winsTotal + " wins · Saved results";
  } catch (error) {
    if (!online || !list.isConnected || historyRequest !== request) return;
    more?.remove();
    const panel = document.createElement("div");
    panel.className = "history-error";
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "Could not load saved history: " + error.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button secondary history-more";
    retry.textContent = "Retry";
    retry.onclick = () => refreshHistory(cursor);
    panel.append(notice, retry);
    list.append(panel);
  } finally {
    if (historyRequest === request) historyRequest = null;
    list.removeAttribute("aria-busy");
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
let authMode = welcomeView().online;
let registering = false;
const accountSwitch = document.createElement("button");
accountSwitch.type = "button";
accountSwitch.className = "button secondary";
accountSwitch.id = "account-switch";
accountSwitch.textContent = "Create an account";
form.after(accountSwitch);
const nameFields = document.createElement("div");
nameFields.innerHTML = '<label for="signup-name">Display name</label><input id="signup-name" name="displayName" autocomplete="nickname" aria-describedby="signup-name-help login-error"><p id="signup-name-help" class="muted">Choose a unique name, 1–24 characters.</p>';
form.prepend(nameFields);
function renderAuth() {
  const authView = welcomeView({ online: authMode, registering });
  nameFields.hidden = !registering;
  $("#signup-name").disabled = !registering;
  $("#signup-name").required = registering;
  $("#login-email").autocomplete = authMode ? "email" : "off";
  $("#login-password").autocomplete = registering ? "new-password" : authMode ? "current-password" : "off";
  $("#login-password").placeholder = registering ? "At least 8 characters" : authMode ? "Your account password" : "Enter sample password";
  mode.textContent = authView.modeLabel;
  accountSwitch.textContent = registering ? "Already have an account? Sign in" : "Create an account";
  form.querySelector("[type=submit]").textContent = authView.submitLabel;
  $("#demo-enter").hidden = authMode;
  $(".or-line").hidden = authMode;
  $("#login-step .demo-disclosure").textContent = authMode
    ? "Accounts use our development server. Available online rooms are shown in the lobby."
    : "Offline practice uses sample data. Nothing is sent or saved online.";
  $("#login-error").textContent = "";
  form.querySelectorAll("input").forEach(input => input.removeAttribute("aria-invalid"));
}
accountSwitch.onclick = () => {
  if (busy) return;
  if (!authMode) $("#login-email").value = "";
  authMode = true;
  registering = !registering;
  $("#login-password").value = "";
  renderAuth();
  $(registering ? "#signup-name" : "#login-email").focus();
};
mode.onclick = () => {
  if (busy) return;
  authMode = !authMode;
  registering = false;
  $("#login-email").value = authMode ? "" : "explorer@example.test";
  $("#login-password").value = "";
  renderAuth();
};
renderAuth();
form.onsubmit = async (event) => {
  const authView = welcomeView({ online: authMode, registering });
  if (authView.primaryAction === "practice") return offlineSubmit(event);
  event.preventDefault();
  if (busy) return;
  busy = true;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  mode.disabled = accountSwitch.disabled = $("#demo-enter").disabled = true;
  form.setAttribute("aria-busy", "true");
  $("#login-error").textContent = "";
  form.querySelectorAll("input").forEach(input => input.removeAttribute("aria-invalid"));
  try {
    const c = await getClient();
    applyProfile(await authenticate(c, authView.primaryAction, {
          email: $("#login-email").value,
          password: $("#login-password").value,
          displayName: $("#signup-name").value,
        }));
    online = true;
    $("#login-error").textContent = "";
    $("#demo-enter").disabled = false;
    notifyAuthenticated();
  } catch (error) {
    $("#login-error").textContent = error.message;
    const field = { displayName: "#signup-name", email: "#login-email", password: "#login-password" }[error.field];
    if (field) { $(field).setAttribute("aria-invalid", "true"); $(field).focus(); }
  } finally {
    $("#login-password").value = "";
    busy = false;
    button.disabled = false;
    mode.disabled = accountSwitch.disabled = $("#demo-enter").disabled = false;
    form.removeAttribute("aria-busy");
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
    historyRequest = null;
    historyResults = [];
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
  '<div class="game-shell"><div class="game-viewport" tabindex="0" role="group" aria-label="Online Portal Partners. WASD or arrow keys move, E interacts, Enter marks Ready while waiting, and Escape opens the menu."></div><header class="game-top"><div class="game-title"><h1>Portal Partners</h1></div><div class="game-top-actions"><span class="game-clock" id="live-clock"></span><button class="game-button" data-live="help">Help · H</button><button class="game-button" data-live="menu">Menu · Esc</button></div></header><section class="game-goal"><span class="game-eyebrow">ONLINE · TWO PLAYERS</span><p id="live-goal"></p><p id="live-team"></p></section><footer class="game-toolbar"><p id="live-prompt"></p><div class="game-control-row"><span>WASD / arrows · Move</span><button class="game-button" data-live="interact">E · Interact</button><button class="game-button is-primary live-ready" data-live="ready" aria-keyshortcuts="Enter">Enter · Ready up</button></div><small id="live-status" role="status"></small></footer><section class="game-cover live-intro" hidden><div class="game-menu"><p class="game-eyebrow">PORTAL PARTNERS</p><h2>Hold, cross, collect, meet.</h2><ol><li>One teammate holds the gold pressure plate so the bridge stays open.</li><li>The other crosses, pulls the lever, and latches the bridge open.</li><li>Both collect a crystal, then meet at the exit.</li></ol><p><strong>Controls:</strong> WASD or arrow keys move. E interacts. After this guide, Enter readies you. Esc opens the menu.</p><button class="game-button is-primary" data-live="intro-close">Got it — Ready up</button></div></section><section class="game-cover live-result" hidden><div class="game-menu"><p class="game-eyebrow">ROUND ENDED</p><h2 id="live-result-title">Round complete.</h2><p id="live-result-copy"></p><div class="game-menu-actions"><button class="game-button is-primary" data-live="replay">Play again</button><button class="game-button" data-live="result-close">Dismiss</button><button class="game-button" data-live="leave">Return to lobby</button></div></section><section class="game-cover live-menu" hidden><div class="game-menu"><h2 id="live-menu-title">Take a moment.</h2><p id="live-menu-copy">Use Tab to choose an action and Enter to select it; Escape resumes play.</p><button class="game-button is-primary" data-live="resume">Keep playing</button><button class="game-button" data-live="leave">Return to lobby</button></div></section></div>';
function closeScene() {
  cancelAnimationFrame(raf);
  stage?.dispose();
  stage = null;
  roster = "";
  keys.clear();
  intro = false;
  dialog.close();
  window.playhouseGameOpen = false;
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id: null } }),
  );
  $("#world").focus();
}
function openScene(id) {
  if (dialog.open) return;
  const workshop = id === "workshop";
  const title = workshop ? "Power-Up Workshop" : "Portal Partners";
  dialog.querySelector("h1").textContent = title;
  const guide = dialog.querySelector(".live-intro");
  guide.querySelector(".game-eyebrow").textContent = title.toUpperCase();
  guide.querySelector("h2").textContent = workshop ? "Power the machine together." : "Hold, cross, collect, meet.";
  const steps = workshop ? [
    "Rotate the gears to match the displayed targets.",
    "Carry each cable to its matching socket.",
    "Stand at left power while your teammate activates right power.",
  ] : [
    "One teammate holds the gold pressure plate so the bridge stays open.",
    "The other crosses, pulls the lever, and latches the bridge open.",
    "Both collect a crystal, then meet at the exit.",
  ];
  guide.querySelector("ol").replaceChildren(...steps.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  dialog.setAttribute("aria-label", "Online " + title);
  dialog.querySelector(".game-viewport").setAttribute("aria-label", title + ". WASD moves, E interacts, Enter readies, Escape opens the menu.");
  menu = false;
  confirmLeave = false;
  resetPrediction = true;
  last = 0;
  window.playhouseGameOpen = true;
  dialog.showModal();
  dialog.querySelectorAll(".game-cover").forEach(cover => (cover.hidden = true));
  if (workshop || !introSeen) {
    intro = true;
    dialog.querySelector(".live-intro").hidden = false;
  }
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id } }),
  );
  dialog.querySelector(".game-viewport").focus();
  raf = requestAnimationFrame(frame);
}
async function enter(id) {
  if (busy) return;
  busy = true;
  try {
    if (supportsOnlineRoom(id, connection.snapshot().board)) {
      checked(await connection.joinRoom(id));
      emit(true);
      openScene(id);
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
  if (supportsOnlineRoom(event.detail.snapshot.self.roomId, event.detail.snapshot.board)) openScene(event.detail.snapshot.self.roomId);
  else if (dialog.open) closeScene();
});
function showMenu(confirm = false) {
  menu = true;
  confirmLeave = confirm;
  keys.clear();
  dialog.querySelectorAll(".game-cover").forEach((cover) => (cover.hidden = true));
  dialog.querySelector(".live-menu").hidden = false;
  $("#live-menu-title").textContent = confirm
    ? "Leave this round?"
    : "Take a moment.";
  $("#live-menu-copy").textContent = confirm
    ? "Leaving an active round cancels it for both players. Press Tab, then Enter to confirm; Escape keeps playing."
    : connection?.snapshot().self.roomId === "workshop" ? workshopGuide : "The online round keeps running. Hold the gold plate, let your teammate cross and pull the lever, then collect both crystals and meet at the exit. Press Tab, then Enter to return to the lobby; Escape resumes.";
  dialog.querySelector("[data-live=leave]").textContent = confirm
    ? "Confirm leave"
    : "Return to lobby";
  dialog.querySelector("[data-live=resume]").focus();
}
async function command(cmd) {
  if (cmd === "result-close") {
    dialog.querySelector(".live-result").hidden = true;
    dialog.querySelector(".game-viewport").focus();
    return;
  }
  if (cmd === "replay") {
    dialog.querySelector(".live-result").hidden = true;
    if (connection?.state === "connected") {
      try {
        checked(await connection.setReady(true));
      } catch (error) {
        message(error.message);
      }
    }
    dialog.querySelector(".game-viewport").focus();
    return;
  }
  if (cmd === "help") {
    intro = true;
    menu = false;
    dialog.querySelectorAll(".game-cover").forEach((cover) => (cover.hidden = true));
    dialog.querySelector(".live-intro").hidden = false;
    dialog.querySelector("[data-live=intro-close]").focus();
    return;
  }
  if (cmd === "intro-close") {
    intro = false;
    introSeen = true;
    dialog.querySelector(".live-intro").hidden = true;
    dialog.querySelector(".game-viewport").focus();
    return;
  }
  if (cmd === "menu") {
    showMenu();
    return;
  }
  if (cmd === "resume") {
    menu = false;
    confirmLeave = false;
    dialog.querySelectorAll(".game-cover").forEach((cover) => (cover.hidden = true));
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
          .filter((t) => t.id !== "plate" && t.id !== "power-left" && near(p, t, view.id === "workshop" ? 1.9 : undefined))
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
bindDialogEscape(dialog, () =>
  command(
    intro
      ? "intro-close"
      : menu
        ? "resume"
        : !dialog.querySelector(".live-result").hidden
          ? "result-close"
          : "menu",
  ),
);
dialog.addEventListener("keydown", (event) => {
  const k = event.key.toLowerCase();
  if (k === "h" && !event.repeat) {
    event.preventDefault();
    command("help");
    return;
  }
  const gameViewport = dialog.querySelector(".game-viewport");
  if (k === "enter" && !event.repeat && event.target === gameViewport) {
    const snapshot = connection?.snapshot();
    const me = snapshot?.room.players.find(
      (player) => player.id === connection.playerId,
    );
    const action = enterShortcutAction({
      introOpen: intro,
      waiting:
        connection?.state === "connected" && !snapshot?.room.session,
      ready: !!me?.ready,
      menuOpen: menu,
      resultOpen: !dialog.querySelector(".live-result").hidden,
    });
    if (action) {
      event.preventDefault();
      command(action === "dismiss-intro" ? "intro-close" : action);
    }
    return;
  }
  if (menu || event.target !== gameViewport) return;
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
    key = next.id + (next.id === "workshop" ? JSON.stringify(next.config) : "") + next.players.map((p) => (p.id || "") + p.avatarId + p.name).join("|");
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
        candidate = advancePortal(p, dx, dz, dt, view.authoritativeBridgeOpen, view.id === "workshop");
      Object.assign(p, candidate);
      connection.sendMove({ x: p.x, y: 0, z: p.z }, Math.atan2(dx, dz));
    }
  }
  const me = snapshot.room.players.find((p) => p.id === connection.playerId),
    round = snapshot.room.session,
    result = snapshot.lastFinished;
  $("#live-goal").textContent = round
    ? view.id === "workshop" ? workshopGuide : round.crystals.every(Boolean)
      ? "Meet at the exit together and press E."
      : round.latched
        ? "Collect both crystals."
        : "Hold the gold plate so your teammate can cross and pull the lever."
    : "Both players choose Ready to begin.";
  if (round && view.id === "portal") {
    $("#live-goal").textContent += " " + bridgeStatusLabel(round) + ".";
  }
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
  ready.textContent =
    readyLabel(me, !!round) === "Ready" ? "Enter · Ready up" : readyLabel(me, !!round);
  $("#live-clock").textContent = round
    ? Math.ceil(Math.max(0, view.limit - view.elapsed)) + "s"
    : "Waiting";
  $("#live-status").textContent =
    connection.state !== "connected"
      ? "Connection " + connection.state + " — movement is paused locally."
      : !round && result
        ? resultText(result)
        : !round
          ? me?.ready
            ? snapshot.room.players.some(
                (player) => player.id !== me.id && player.ready,
              )
              ? "Both players are ready — round starting."
              : "You are ready — waiting for teammate."
            : snapshot.room.players.some(
                (player) => player.id !== me.id && player.ready,
              )
              ? "Your teammate is ready — choose Ready."
              : "Waiting for both players to choose Ready."
          : "Live development game · Server controls the round";
  if (result && !round && result.sessionId !== lastResultId) {
    lastResultId = result.sessionId;
    $("#live-result-title").textContent =
      result.outcome === "win"
        ? "You made it together."
        : result.outcome === "loss"
          ? "Time ran out."
          : "Round cancelled.";
    $("#live-result-copy").textContent = resultText(result);
    const replay = dialog.querySelector("[data-live=replay]");
    replay.hidden = result.outcome === "cancelled";
    dialog.querySelectorAll(".game-cover").forEach((cover) => (cover.hidden = true));
    dialog.querySelector(".live-result").hidden = false;
  }
  const p = view.players[view.active],
    target = targets(view).find((t) => near(p, t, view.id === "workshop" ? 1.9 : undefined));
  $("#live-prompt").textContent = target
    ? target.id === "plate"
      ? "Stay on the plate to hold the bridge."
      : "E · " + target.label
    : "Walk up to a mechanism to interact.";
  stage.render(dt, now / 1000);
  raf = requestAnimationFrame(frame);
}
