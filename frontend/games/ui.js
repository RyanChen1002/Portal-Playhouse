import {
  games,
  createSession,
  targets,
  near,
  act,
  step,
  move,
  objectives,
  levelCount,
  levelTitle,
  nextMove,
} from "./practice.js";
import { createStage } from "./scene.js";
import { menuTransition } from "./menu.js";

const dialog = document.createElement("dialog");
dialog.id = "game-dialog";
dialog.setAttribute("aria-label", "Playhouse games");
document.body.append(dialog);
let session = null,
  stage = null,
  view = "playing",
  last = 0,
  raf = 0,
  returnFocus = null,
  recorded = false,
  priorUI = "",
  audio = null;
const heldKeys = new Set(),
  history = [];
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clock = (n) =>
  `${Math.floor(Math.max(0, n) / 60)}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, "0")}`;
const button = (cmd, text, primary = false) =>
  `<button class="game-button ${primary ? "is-primary" : ""}" data-game-command="${cmd}">${text}</button>`;
function cue(ok) {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.frequency.setValueAtTime(ok ? 440 : 180, audio.currentTime);
    gain.gain.setValueAtTime(0.025, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    osc.start();
    osc.stop(audio.currentTime + 0.13);
  } catch {
    /* Sound is optional. */
  }
}
function stopStage() {
  cancelAnimationFrame(raf);
  stage?.dispose();
  stage = null;
  heldKeys.clear();
}
function endRound() {
  if (!session || recorded || session.status === "playing") return;
  recorded = true;
  history.unshift({
    name:
      games.find((g) => g.id === session.id).name +
      (session.level ? " · Level " + session.level : ""),
    status: session.status,
    score: session.score,
    time: Math.round(session.elapsed),
  });
  const el = document.querySelector("#practice-history");
  el.replaceChildren();
  for (const h of history) {
    const p = document.createElement("p");
    p.textContent = `${h.name} · ${h.status === "won" ? "Completed" : h.status === "lost" ? "Try again" : "Cancelled"} · ${h.score} objectives · ${clock(h.time)} · Not saved online`;
    el.append(p);
  }
}
function leave() {
  if (session?.status === "playing") act(session, "cancel");
  endRound();
  stopStage();
  dialog.close();
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id: null } }),
  );
  session = null;
  window.playhouseGameOpen = false;
  returnFocus?.focus();
  window.dispatchEvent(new Event("resize"));
}
function launch(id, level = 1) {
  stopStage();
  session = createSession(id, level);
  view = "playing";
  recorded = false;
  priorUI = "";
  last = 0;
  const g = games.find((g) => g.id === id);
  dialog.dataset.game = id;
  window.dispatchEvent(
    new CustomEvent("playhouse-game-status", { detail: { id } }),
  );
  dialog.innerHTML = `<div class="game-shell"><div class="game-viewport" tabindex="0" role="group" aria-label="${g.name}. WASD to walk, E interact, Q switch teammate, R rotate."></div>
 <header class="game-top"><div class="game-title"><span class="game-brand">P<span>PLAYHOUSE</span></span><div><p class="game-eyebrow">${g.tag}</p><h1>${g.name}</h1></div></div><div class="game-top-actions"><span class="game-clock" id="game-timer"></span>${button("help", "How to play")}${button("menu", "Menu · Esc")}</div></header>
 <section class="game-goal" aria-label="Current objective"><span class="game-eyebrow">${id === "portal" ? "YOUR NEXT MOVE" : `LEVEL ${level} / 5 · ${levelTitle(session)}`}</span><p id="game-goal"></p><div class="game-progress" id="game-objectives"></div></section>
 <div class="game-team" id="game-team" aria-label="Practice teammates"></div>
 <div class="game-job" id="game-job"></div>
 <footer class="game-toolbar"><div class="game-feedback" id="game-feedback" role="status" aria-live="polite"></div><div class="game-prompt" id="game-prompt"></div><div class="game-control-row"><span><kbd>W A S D</kbd> Move</span>${button("interact", "E · Interact")}${button("switch", "Q · Switch teammate")}${["train", "rescue"].includes(id) ? button("rotate", "R · Rotate") : ""}</div><small>Local practice · You control both teammates · Results are not saved online</small></footer>
 <section class="game-cover" id="game-cover" hidden></section></div>`;
  const host = dialog.querySelector(".game-viewport");
  try {
    const picked = document.querySelector(
      '#welcome-avatars [aria-pressed="true"]',
    );
    const index = picked ? [...picked.parentNode.children].indexOf(picked) : 0;
    stage = createStage(host, session, index);
  } catch (error) {
    view = "error";
    const cover = dialog.querySelector("#game-cover");
    cover.hidden = false;
    cover.innerHTML = `<div class="game-menu"><h2>We couldn't start 3D</h2><p>Check that hardware acceleration is enabled, then try again.</p>${button("leave", "Return to lobby", true)}</div>`;
    cover.querySelector("button").focus();
    console.error(error);
    return;
  }
  host.focus();
  updateUI();
  raf = requestAnimationFrame(frame);
}
function showView(next) {
  if (next === "closed") {
    leave();
    return;
  }
  view = next;
  heldKeys.clear();
  last = 0;
  const cover = dialog.querySelector("#game-cover");
  cover.hidden = view === "playing";
  if (view === "playing") {
    dialog.querySelector(".game-viewport").focus();
    return;
  }
  const g = games.find((g) => g.id === session.id);
  if (view === "confirm")
    cover.innerHTML = `<div class="game-menu"><p class="game-eyebrow">LEAVE THIS ROUND?</p><h2>Back to the lobby?</h2><p>Your current practice round will end. You can start again whenever you like.</p><div class="game-menu-actions">${button("resume", "Keep playing", true)}${button("confirm-leave", "Leave round")}</div></div>`;
  else if (view === "help")
    cover.innerHTML = `<div class="game-menu"><p class="game-eyebrow">${g.name}${session.level ? " · Level " + session.level : ""}</p><h2>${levelTitle(session)}.</h2><ol>${(session.level > 1 ? objectives(session).map(([text]) => text) : g.steps).map((text) => `<li>${escapeHTML(text)}</li>`).join("")}</ol><p class="game-note">WASD moves. E interacts nearby. Q switches your practice teammate; the other stays in place. R rotates when needed. Finish before the timer runs out. Retry as often as you like.</p>${button("resume", "Got it · Esc", true)}</div>`;
  else
    cover.innerHTML = `<div class="game-menu"><p class="game-eyebrow">LOCAL PRACTICE PAUSED</p><h2>Take a moment.</h2><div class="game-menu-actions">${button("resume", "Keep playing", true)}${button("help", "How to play")}${button("leave", "Return to lobby")}</div></div>`;
  cover.querySelector("button")?.focus();
}
function request(action) {
  if (!session) return;
  if (view === "error" && action === "leave") {
    leave();
    return;
  }
  if (session.status !== "playing" && action === "escape") {
    leave();
    return;
  }
  showView(menuTransition(view, action, session.status === "playing"));
}
function updateUI() {
  if (!session) return;
  const s = session;
  dialog.querySelector("#game-timer").textContent = clock(s.limit - s.elapsed);
  const goals = objectives(s),
    guidance = nextMove(s),
    key = JSON.stringify([
      s.active,
      s.score,
      s.message,
      s.status,
      s.players.map((p) => p.held),
      goals,
      guidance,
    ]);
  if (key !== priorUI) {
    priorUI = key;
    dialog.querySelector("#game-team").innerHTML = s.players
      .map(
        (p, i) =>
          `<button class="teammate ${s.active === i ? "is-active" : ""}" data-game-command="${s.active === i ? "focus" : "switch"}" aria-pressed="${s.active === i}"><span class="teammate-number">${i + 1}</span><span><b>${s.active === i ? "You are controlling" : "Practice teammate"} ${i + 1}</b><small>${escapeHTML(p.held?.replaceAll("-", " ") || "Hands free")}</small></span></button>`,
      )
      .join("");
    dialog.querySelector("#game-goal").textContent = guidance;
    dialog.querySelector("#game-objectives").innerHTML = goals
      .map(
        ([text, done]) =>
          `<span class="progress-dot ${done ? "done" : ""}" title="${escapeHTML(text)}" aria-label="${escapeHTML(text)}: ${done ? "complete" : "incomplete"}">${done ? "✓" : "·"}</span>`,
      )
      .join("");
    dialog.querySelector("#game-feedback").textContent =
      s.message === "Walk up to a marked object and press E." ? "" : s.message;
  }
  dialog.querySelector("#game-job").textContent = s.job
    ? "Preparing · " + Math.ceil(s.job.remaining) + "s"
    : "";
  const p = s.players[s.active],
    target = targets(s)
      .filter((t) => near(p, t))
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      )[0];
  dialog.querySelector("#game-prompt").textContent = target
    ? "E · " + target.label
    : "Walk up to an object to interact";
  const viewport = dialog.querySelector(".game-viewport");
  Object.assign(viewport.dataset, {
    game: s.id,
    state: s.status,
    playerX: p.x.toFixed(2),
    playerZ: p.z.toFixed(2),
  });
  if (s.status !== "playing" && !recorded) {
    endRound();
    view = "result";
    heldKeys.clear();
    const cover = dialog.querySelector("#game-cover");
    cover.hidden = false;
    cover.innerHTML = `<div class="game-menu"><p class="game-eyebrow">${s.status === "won" ? "NICELY DONE" : "TRY A NEW PLAN"}</p><h2>${s.status === "won" ? "Made it together." : "One more go?"}</h2><p>${escapeHTML(s.message)}</p><div class="result-stats"><span><b>${s.score}</b>Objectives</span><span><b>${clock(s.elapsed)}</b>Time</span><span><b>${s.mistakes}</b>Mistakes</span></div><div class="game-menu-actions">${s.status === "won" && (s.level || 1) < levelCount(s.id) ? button("next", "Next level", true) : ""}${button("restart", s.level ? "Retry this level" : "Play again", s.status !== "won")}${s.level > 1 ? button("start-over", "Start from level 1") : ""}${button("leave", "Return to lobby")}</div><small>Practice result · Not saved online</small></div>`;
    cover.querySelector("button").focus();
  }
}
function interact() {
  if (!session || view !== "playing" || session.status !== "playing") return;
  const p = session.players[session.active],
    t = targets(session)
      .filter((t) => near(p, t))
      .sort(
        (a, b) =>
          Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z),
      )[0];
  cue(act(session, t?.id || ""));
  updateUI();
}
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
  last = now;
  if (session && view === "playing") {
    const dx =
        Number(heldKeys.has("d") || heldKeys.has("arrowright")) -
        Number(heldKeys.has("a") || heldKeys.has("arrowleft")),
      dz =
        Number(heldKeys.has("s") || heldKeys.has("arrowdown")) -
        Number(heldKeys.has("w") || heldKeys.has("arrowup"));
    move(session, dx, dz, dt);
    step(session, dt);
    updateUI();
  }
  stage?.render(dt, session?.elapsed || 0);
  raf = requestAnimationFrame(frame);
}
// A single command handler covers pointer and keyboard control.
dialog.addEventListener("click", (event) => {
  const cmd = event.target.closest("[data-game-command]")?.dataset.gameCommand;
  if (!cmd) return;
  if (["menu", "help", "resume", "leave", "confirm-leave"].includes(cmd)) {
    request(cmd);
    return;
  }
  if (cmd === "restart" && session.status !== "playing") {
    launch(session.id, session.level || 1);
    return;
  }
  if (cmd === "start-over" && session.status !== "playing") {
    launch(session.id);
    return;
  }
  if (
    cmd === "next" &&
    session.status === "won" &&
    (session.level || 1) < levelCount(session.id)
  ) {
    launch(session.id, session.level + 1);
    return;
  }
  if (view !== "playing") return;
  if (cmd === "interact") interact();
  if (cmd === "switch" || cmd === "rotate") {
    act(session, cmd);
    updateUI();
  }
  dialog.querySelector(".game-viewport").focus();
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  request("escape");
});
dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    request("escape");
    return;
  }
  if (
    !session ||
    view !== "playing" ||
    event.target !== dialog.querySelector(".game-viewport")
  )
    return;
  const key = event.key.toLowerCase();
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
      "e",
      "q",
      "r",
    ].includes(key)
  ) {
    event.preventDefault();
    if (["w", "a", "s", "d"].includes(key) || key.startsWith("arrow"))
      heldKeys.add(key);
    if (!event.repeat) {
      if (key === "e") interact();
      if (key === "q") act(session, "switch");
      if (key === "r") act(session, "rotate");
      updateUI();
    }
  }
});
window.addEventListener("keyup", (event) =>
  heldKeys.delete(event.key.toLowerCase()),
);
dialog.addEventListener("focusout", () => heldKeys.clear());
function loseFocus() {
  heldKeys.clear();
  if (dialog.open && session?.status === "playing" && view === "playing")
    showView("menu");
}
window.addEventListener("blur", loseFocus);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) loseFocus();
});
const historyBox = document.createElement("div");
historyBox.id = "practice-history";
document.querySelector("#history").append(historyBox);
window.addEventListener("playhouse-enter-game", (event) => {
  if (window.playhouseLive?.online && !event.detail?.practice) return;
  if (window.playhouseGameOpen) return;
  const id = event.detail?.id;
  if (!games.some((g) => g.id === id)) return;
  returnFocus = document.querySelector("#world");
  window.playhouseGameOpen = true;
  if (!dialog.open) dialog.showModal();
  launch(id);
});
