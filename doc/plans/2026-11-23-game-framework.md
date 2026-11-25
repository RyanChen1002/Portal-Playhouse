# Game Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.2

**Date:** 11/24/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.2 | 11/24/2026 | Recorded the hosted run after PR #32 merged (Task 9, Hosted run). No plan steps changed. |
| 0.1 | 11/23/2026 | Initial implementation plan for the approved game framework design. Added a lobby and movement guard at Adam's request: a recorded lobby transcript taken before any engine change (Task 2, Step 0) and checked after Tasks 3, 5, 6 and 9. |

**Goal:** Portal Partners runs as the first game module behind a common hook interface in the World engine, the wire protocol carries any game's targets and state, and every game's results go to one shared Supabase results table. Portal Partners behaves exactly as before.

**Architecture:** `World` (`shared/world/world.ts`) keeps everything about running a two-player room and calls a game module for every game decision: move checks, after-move effects, interactions, ticks, connection changes, the state payload and the score. Modules return effects (position overrides, end, state changed) that the engine applies. Results go through one `record_game_result` function into `private.game_results`, keyed by `game_type`.

**Tech Stack:** TypeScript, Vitest (unit and Cloudflare Workers pools), Supabase Postgres (PL/pgSQL, pgTAP), npm workspaces, Node 22. No new dependencies.

**Spec:** [doc/specs/2026-11-23-game-framework-design.md](../specs/2026-11-23-game-framework-design.md). Read it first; § numbers below refer to it. It builds on the [runtime design](../specs/2026-11-17-runtime-transport-design.md).

**Start condition:** Ryan approved the design's decisions on 11/23/2026: the game-module framework, the generic wire protocol, and the shared results table (§7, not the §7.5 fallback). Work happens on `feature/game-framework`, branched from `dev`; the pull request targets `dev`.

## Global Constraints

- **Local only.** All automated checks use the local Supabase stack and the local Workers runtime. Agents never run `wrangler deploy`, never use `--remote`, and never touch hosted Supabase. Hosted steps are Adam's checklist in Task 9.
- **No new dependencies.** No `package.json` changes.
- **Platform-free engine.** Nothing in `shared/world/` imports Cloudflare, Supabase, the DOM or Node built-ins. Modules get time only from the round view's `now`, and never create IDs.
- **No Portal Partners behavior change.** `shared/world/world.test.ts`, `shared/world/world-rounds.test.ts`, `shared/test/*`, `shared/client/*.test.ts` and `runtime/test/*` keep their assertions. Allowed edits: imports, renamed symbols, a `gameType` field added to an expected object, and the RPC name `record_game_result`. Any other change to an existing assertion is a stop-and-ask.
- **Lobby and movement unchanged.** Courtyard speed 4.8, radius 23, spawn (0, 0, 4), entrance (-10.5, 0, 0), join radius 3.2, budget refill factor 1.25 and slack 0.5 stay as they are. The lobby transcript test (Task 2, Step 0) is recorded on the unchanged engine, and its snapshot file is never regenerated: `vitest -u` is forbidden on this branch. If it fails, fix the code, not the snapshot.
- **Portal Partners values, copied exactly from `shared/world/config.ts`:** arena `halfX` 9.6, `halfZ` 7.7, speed 4; spawns (-3, 0, 6) and (0, 0, 6); round 180 000 ms; `scoreMax` 2; targets `lever`, `crystal-a`, `crystal-b`, `exit`; correction reason `bridgeClosed`; disconnect `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }`. The other Portal Partners constants (gap, bridge, set-back, plate, lever, crystals, exit, radii, sample step 0.1) move unchanged.
- **Target rule:** 1 to 32 characters from `A-Z`, `a-z`, `0-9` and `-` (`/^[A-Za-z0-9-]{1,32}$/`).
- **Docs:** every edited project document gets its Version header and a Change History row (MM/DD/YYYY, newest first, one row per date), per `AGENTS.md`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pull request descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Gate for every task:** `npm run typecheck` and `npm test` pass before its commit; tasks touching `runtime/` or `supabase/` also run `npm run test:runtime` or `npm run test:db` as stated.

## Review Focus

1. **A target valid in form but unknown to the game** (`door`). Expect `request.error` `VALIDATION_ERROR` carrying the request's `requestId`, no state change, module not called. Before this change the parser rejected it; now the engine must. Test: Task 6, `unknown target is VALIDATION_ERROR with the requestId`.
2. **A repeated `actionId` after the world changed.** A crystal tried too far away fails, the player walks closer, and the same `actionId` is sent again: it must return the first error, not collect the crystal. Duplicate handling moves from the module into the engine. Test: Task 5, `duplicate actionId replays the first reply`.
3. **Existing dev results after the migration.** Copied rows keep their `id`, so result IDs already sent in `result.saved` stay valid, and `winsTotal` stays the same. Test: Task 7, Step 6 (local upgrade from the previous migration).
4. **Results pending in Durable Object storage from before the deploy** have no `gameType`. They must save as `portal-partners`, not fail forever. Test: Task 8, `pending row without gameType saves as portal-partners`.
5. **A module win due at the same `now` as the time-out.** `tick` runs before the time-out check, so the win counts (§5.2, tick timing). Test: Task 6, `tick win at the round deadline counts as a win`.

---

## File map

| File | Change |
| --- | --- |
| `doc/component-contract.md`, `doc/initial-spec.md`, `doc/specs/2026-11-23-game-framework-design.md` | Task 1 |
| `shared/contracts/realtime.ts`, `types.ts`, `realtime.test.ts` | Task 2: `GameType`, generic targets, `gameType` on state and session |
| `shared/client/world.ts` | Task 2: `interact(target: string)` |
| `shared/world/movement.ts`, `movement.test.ts` | Task 3: speed and bounds as values |
| `shared/world/games/types.ts` | Task 4: module interface (create) |
| `shared/world/games/portal-partners.ts`, `.test.ts` | Task 4: Portal Partners module (create; replaces `shared/world/portal-partners.ts` and its test) |
| `shared/world/games/index.ts` | Task 4: `GAMES` list (create) |
| `shared/world/config.ts`, `world.ts`, `index.ts`, `test-helpers.ts` | Task 5 and 6: engine on hooks |
| `shared/world/test-game.ts`, `world-games.test.ts` | Task 6: test-only module and its engine tests (create) |
| `supabase/migrations/<timestamp>_shared_game_results.sql`, `supabase/tests/database/05_results.test.sql` | Task 7 |
| `runtime/src/supabase.ts`, `runtime/src/results.ts`, `runtime/test/helpers.ts`, `supabase.test.ts`, `results.test.ts`, `shared/mocks/world.ts` | Task 8 |

---

### Task 1: Record the approval in the documents

**Files:**
- Modify: `doc/specs/2026-11-23-game-framework-design.md` (header, §7 title, §11)
- Modify: `doc/component-contract.md` (§3, §5, §7, §9 if it lists this as open)
- Modify: `doc/initial-spec.md` (FR-09, AC-06, §8 blocker wording)

- [ ] **Step 1: Design to v0.2.** Status: "Approved by Ryan on 11/23/2026 (framework, generic wire protocol, shared results table)." Drop "Proposal for Ryan" from §7's title, mark §11's three items approved, and keep §7.5 as the record of the fallback not taken. Change History row for 11/23/2026 (combine with the 0.1 row per the one-row-per-date rule, Version 0.2).
- [ ] **Step 2: Contract to v0.11** (same-day row combined with 0.10's per the rule). §3: `RoomSummary.gameType` and `Result.gameType` are a game type from the list (`portal-partners` now; each game's design adds its value); replace "Game types (open)" with that rule and a pointer to framework design §8. §5: the `game.interact` row states the target rule (1–32 letters, digits, hyphens; checked by the server against the room's game, unknown targets get `VALIDATION_ERROR`); `game.state` becomes `{sessionId, gameType, revision, state}`; `room.snapshot.session` gains `gameType`; `player.corrected.reason` is `rejected` or a game-declared reason (Portal Partners: `bridgeClosed`). Replace the "Other games (open)" paragraph with: each game's design defines its targets, its `state` fields (always including `startedAt`, `durationSeconds`, `serverTime`) and its correction reasons, on the framework in the framework design. §7: one shared results table keyed by game type, written by `record_game_result`; `get_my_results` and `winsTotal` read it.
- [ ] **Step 3: Initial spec to v0.9.** FR-09: "Persist results in one shared Supabase results table keyed by game type ([framework design](specs/2026-11-23-game-framework-design.md) §7), and show personal history and total wins across all games." (keep the **Proposed** win rule sentence). AC-06: "in that game's table" becomes "in the shared results table, under that game's type". §8 blocker: "result table" becomes "score range (the results table is shared)". Change History row: "Ryan approved the game framework design: FR-09 and AC-06 now use one shared results table."
- [ ] **Step 4: Check.** `grep -n "per game type\|five tables\|record_portal_partners_result" doc/initial-spec.md doc/component-contract.md` shows only history rows or the runtime-design pointer.
- [ ] **Step 5: Commit** `docs: record approval of the game framework design`.

### Task 2: Contracts: game types, generic targets, `gameType` on state

**Files:**
- Modify: `shared/contracts/realtime.ts`, `shared/contracts/types.ts:109`, `shared/client/world.ts:251`
- Modify: `shared/world/world.ts` (`sendState`, `roomSnapshot`: add `gameType` only)
- Test: `shared/contracts/realtime.test.ts`, `shared/world/world-rounds.test.ts`

**Interfaces:**
- Produces, in `shared/contracts/realtime.ts`:
  - `export const GAME_TYPES = ['portal-partners'] as const; export type GameType = (typeof GAME_TYPES)[number];`
  - `export const TARGET_PATTERN = /^[A-Za-z0-9-]{1,32}$/;` (keep `PortalPartnersTarget` exported for the frontend)
  - `export interface GameStateBase { startedAt: string; durationSeconds: number; serverTime: string }`; `PortalPartnersState extends GameStateBase` (fields unchanged)
  - `export type GameStatePayload = { sessionId: string; revision: number; gameType: 'portal-partners'; state: PortalPartnersState };` (a union; each game adds a member)
  - `export type SessionSnapshot = { sessionId: string; gameType: 'portal-partners' } & PortalPartnersState;` (union the same way); `RoomSnapshot.session: SessionSnapshot | null`
  - `CorrectionReason = 'rejected' | 'bridgeClosed'` stays a union of `rejected` and every game's declared reasons
  - `RoomSummary.gameType: GameType`, `GameResult.gameType: GameType`
  - `game.interact` payload `target: string`; `game.state` payload `GameStatePayload`
- Produces: `WorldConnection.interact(target: string): Promise<Result<null>>` (`types.ts` and `client/world.ts`)

- [ ] **Step 0: Record the lobby transcript on the unchanged engine** (before any other edit on this branch). Create `shared/world/lobby-transcript.test.ts` with one test, `lobby transcript is unchanged`. It uses `makeWorld()` and the `test-helpers.ts` drivers to script, at 100 ms steps:
  - admit players 1–3 and walk player 1 around the courtyard;
  - send a too-fast move (`player.corrected rejected`), an out-of-bounds move (x 23.5), a stale sequence and a y of 3.5;
  - try to join `portal` from too far away (`INVALID_ACTION`), walk to the entrance and join, then join with player 2;
  - player 3 tries to join a full room (`ROOM_FULL`); player 1 leaves (back at the entrance) and walks again;
  - a takeover of player 2's connection, `connectionLost` for player 3 then a return within grace, player 3's `world.leave`, and an idle expiry of player 1 (advance 600 000 ms).

  No round starts. It collects every `Outgoing` (`to` and `message`) in order, plus `slotsUsed()` and `takeClosings()` after each step, and asserts `expect(log).toMatchSnapshot()`. Run `npx vitest run --project unit shared/world/lobby-transcript.test.ts` to write `shared/world/__snapshots__/lobby-transcript.test.ts.snap`. Read the snapshot and check that it shows the expected corrections and errors. Commit both files on their own: `test(world): record the lobby transcript before the game framework refactor`.
- [ ] **Step 1: Write the failing tests.** In `realtime.test.ts`: `accepts any target matching the target rule` (`door`, `crystal-a`, `A1`, `x`.repeat(32) parse with `error: null`); `rejects targets outside the target rule` (`''`, `x`.repeat(33), `crystal_a`, `lever!`, `'two words'`, `7` as a number). Move the existing `target: 'door'` line in the "rejects unknown type…" test into the accepts test (an allowed mechanical edit: the rule changed by design). In `world-rounds.test.ts` add `game.state and the session snapshot carry gameType`: after a round starts, every `game.state` payload has `gameType: 'portal-partners'` and the starter's `room.snapshot.session.gameType` is `'portal-partners'`.
- [ ] **Step 2: Run** `npx vitest run --project unit shared/contracts shared/world/world-rounds.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the types above; the parser checks `typeof target === 'string' && TARGET_PATTERN.test(target)` with the existing message. In `world.ts`, add `gameType: room.config.gameType` to the `game.state` payload and the `session` object.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): generic interaction targets and gameType on game state`.

### Task 3: Movement takes speed and bounds as values

**Files:**
- Modify: `shared/world/movement.ts`, `shared/world/config.ts` (remove `Location`), `shared/world/world.ts` (call sites), `shared/world/portal-partners.ts` (`Barrier` import only)
- Test: `shared/world/movement.test.ts` (mechanical: `'courtyard'` → `COURTYARD_AREA`, `'arena'` → `PORTAL_AREA`)

**Interfaces:**
- Produces, in `movement.ts`:
  - `export type Bounds = { radius: number } | { halfX: number; halfZ: number };`
  - `export interface MoveArea { bounds: Bounds; speed: number }`
  - `export const COURTYARD_AREA: MoveArea = { bounds: { radius: COURTYARD_RADIUS }, speed: COURTYARD_SPEED };`
  - `newTracker(position: Vec3, rotation: number, now: number, area: MoveArea = COURTYARD_AREA): MoveTracker`
  - `inBounds(bounds: Bounds, p: Vec3): boolean`
  - `export type MoveVerdict = 'allow' | 'reject' | 'ignore'; export type PathCheck = (from: Vec3, to: Vec3) => MoveVerdict;`
  - `checkMove(t, area: MoveArea, seq, to, rotation, now, path?: PathCheck): MoveCheck`, where `MoveCheck` gains `{ kind: 'ignored'; tracker: MoveTracker }`. `ignored` keeps position and rotation, records `lastSequence` and the refilled budget, and sends nothing. The budget cap is `area.speed + BUDGET_SLACK`; refill uses `area.speed`.
- Test-only constant for `movement.test.ts`: `const PORTAL_AREA: MoveArea = { bounds: { halfX: 9.6, halfZ: 7.7 }, speed: 4 }` (the module owns the real one from Task 4).

- [ ] **Step 1: Write the failing tests** in `movement.test.ts`: `a path check of ignore returns ignored with the sequence recorded and the position kept` (a later move with the same sequence is `stale`); `a slower area speed shrinks the budget` (area speed 2: a 2.6-unit move from a fresh tracker is accepted, 2.6 + 0.01 after an immediate second move is rejected; cap = 2 + 0.5). Mechanically convert the existing tests.
- [ ] **Step 2: Run** `npx vitest run --project unit shared/world/movement.test.ts`. Expected: FAIL (types).
- [ ] **Step 3: Implement.** In `world.ts` replace `locationOf` with `areaOf(room): MoveArea | null` (the lobby gives `COURTYARD_AREA`, a playing room the Portal Partners arena from config for now, a waiting room null), and wrap today's `arenaBarrier` as `(f, t) => barrier(f, t) ? 'reject' : 'allow'`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS, with the world tests unchanged and `lobby transcript is unchanged` passing against the snapshot from Task 2.
- [ ] **Step 5: Commit** `refactor(world): movement takes speed and bounds as values`.

### Task 4: The module interface and the Portal Partners module

**Files:**
- Create: `shared/world/games/types.ts`, `shared/world/games/portal-partners.ts`, `shared/world/games/index.ts`
- Create: `shared/world/games/portal-partners.test.ts` (port of `shared/world/portal-partners.test.ts`, which Task 5 deletes)

**Interfaces** (produced; Tasks 5 and 6 rely on these exact names):

```ts
// games/types.ts
export interface RoundPlayer { id: string; position: Vec3; rotation: number; connected: boolean }
export interface RoundView {
  players: readonly [RoundPlayer, RoundPlayer]; // join order
  now: number;
  startedAt: number;
  player(id: string): RoundPlayer; // throws on an unknown id (engine bug)
}
export interface Override { playerId: string; position: Vec3; rotation?: number; reason: string }
export interface Effect { overrides?: Override[]; end?: 'win' | 'loss'; stateChanged?: boolean }
export type InteractOutcome = { ok: true; effect?: Effect } | { ok: false; message: string }; // engine sends INVALID_ACTION
export interface DisconnectSettings { duringGrace: 'keepRunning'; onExpiry: 'cancel' }
export interface GameModule<S = unknown, V extends object = object> {
  gameType: GameType; name: string; roundMs: number;
  arena: { halfX: number; halfZ: number; speed: number };
  spawns: readonly [Vec3, Vec3];
  scoreMax: number; targets: readonly string[]; correctionReasons: readonly CorrectionReason[];
  disconnect: DisconnectSettings;
  start(view: RoundView): S;
  checkMove(s: S, view: RoundView, playerId: string, from: Vec3, to: Vec3): MoveVerdict;
  speed?(s: S, view: RoundView, playerId: string): number;
  afterMove?(s: S, view: RoundView, playerId: string): Effect;
  interact(s: S, view: RoundView, playerId: string, target: string): InteractOutcome;
  tick?(s: S, view: RoundView): Effect;
  onConnection?(s: S, view: RoundView, playerId: string, connected: boolean): Effect;
  view(s: S, view: RoundView): V; // game fields only; the engine adds startedAt, durationSeconds, serverTime
  score(s: S): number;
}
// Modules mutate `s` in place; `start` returns the initial value.
```

- `games/portal-partners.ts` exports `PORTAL_PARTNERS: GameModule<PPState, Omit<PortalPartnersState, keyof GameStateBase>>` and the moved constants. `PPState = { latched: boolean; crystals: [boolean, boolean]; open: boolean; lastOutside: Map<string, Vec3> }`.
- `games/index.ts` exports `GAMES: readonly GameModule[] = [PORTAL_PARTNERS]` and `gameModule(gameType: GameType): GameModule`.

Portal Partners hook behavior (all from today's `portal-partners.ts` and `world.ts`):
- `start`: `latched` false, `crystals` both false, `lastOutside` = each player's spawn, `open` = bridge open for the spawn positions (false).
- `checkMove`: today's `arenaBarrier` path sampling (step 0.1) against bridge-open for the view's positions *before* the move; `reject` when blocked, else `allow`. Never `ignore`.
- `afterMove`: if the mover's `|z| >= ARENA_GAP_HALF_Z`, set their `lastOutside`. Compute open from the view's positions. Unchanged from `s.open` → `{}`. Otherwise set `s.open`; on open → closed, return a `bridgeClosed` override for every player with `|z| < ARENA_GAP_HALF_Z`, to `setBack(position, lastOutside)`; return `stateChanged: true` either way.
- `interact`: today's range and rule checks and messages (`Move closer to interact.`, `The lever is already pulled.`, `That crystal is already collected.`, `Collect both crystals first.`, `Both players must be connected.`, `Both players must be at the exit.`). Lever sets `latched` and `open = true`, `stateChanged`; crystal sets it, `stateChanged`; exit returns `end: 'win'`.
- `view`: `{ bridgeOpen: latched || someone on the plate (computed from the view, not s.open), latched, crystals }`.
- `score`: collected crystal count.

- [ ] **Step 1: Write the failing tests** by porting every case in `shared/world/portal-partners.test.ts` to the hooks with a `RoundView` built by a local `viewOf(a: Vec3, b: Vec3, connected = [true, true])` helper. Drop the duplicate-actionId case (it moves to the engine in Task 5). Add `afterMove returns bridgeClosed overrides for players in the gap when the plate is left` (player a on the plate at (-5, 3), b at (0, 0); a's move to (-5, 6) gives one override for b to (0, 0, 1.35) when b's `lastOutside.z` > 0, and `stateChanged: true`) and `afterMove with no bridge change returns no effect`.
- [ ] **Step 2: Run** `npx vitest run --project unit shared/world/games`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `types.ts`, `portal-partners.ts` (with its own copy of the Portal Partners constants; the originals stay in `config.ts` until Task 5 deletes the old file), and `index.ts`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS (old file still present and unused by the new one).
- [ ] **Step 5: Commit** `feat(world): game module interface and the Portal Partners module`.

### Task 5: Run Portal Partners through the hooks

**Files:**
- Modify: `shared/world/world.ts`, `shared/world/config.ts`, `shared/world/index.ts`, `shared/world/test-helpers.ts`
- Delete: `shared/world/portal-partners.ts`, `shared/world/portal-partners.test.ts`
- Test: `shared/world/world-rounds.test.ts` (one new test)

**Interfaces:**
- Consumes: Task 4's `GameModule`, `PORTAL_PARTNERS`; Task 3's `MoveArea`, `PathCheck`.
- Produces:
  - `GameRoomConfig = { id: RoomId; game: GameModule; minPlayers: 2; maxPlayers: 2; entrance: Vec3; joinRadius: number }`. `name` and `gameType` come from `game`. `PORTAL_ROOM.game = PORTAL_PARTNERS`, other values unchanged.
  - `WorldConfig.roundMs?: number`, an override applied to every game's round when set; `DEFAULT_WORLD_CONFIG` omits it. `ROUND_MS` moves to the module as `roundMs`.
  - `WorldOptions.onModuleError?: (message: string) => void` (default no-op), for module bugs (Task 6 uses it).
  - Inside `World`: `RoomState.round: Round | null` with `Round = { game: GameModule; state: unknown; sessionId: string; playerIds: [string, string]; startedAt: number; actions: Map<string, { ok: true } | { ok: false; code: ErrorCode; message: string }> }`. `PlayerState.lastOutside` is removed.
  - Private `applyEffect(room, effect, origin: 'afterMove' | 'other')`, the one place effects are applied (below).

Engine rules (keep today's message order and revision numbers):
- **Move:** area = `{ bounds: game.arena, speed: game.speed?.(…) ?? game.arena.speed }` while playing; path check = `(f, t) => game.checkMove(state, view, id, f, t)`. On accept: today's revision bump and `player.updated`, then `afterMove` through `applyEffect(…, 'afterMove')`.
- **applyEffect:** score before = `round.game.score(state)`. For each override in order: check it is inside `arena` bounds (else `onModuleError` and skip it); set the position (and rotation if given), set the tracker's position, `room.revision++`, `player.corrected {sequence: tracker.lastSequence, position, rotation, reason}` to that player if connected, `player.updated` to the others. Then if `end`: `finishRound(room, end, null)` and stop. Then if `stateChanged` or the score changed: when `origin` is `'other'` and no override bumped the revision, `room.revision++`; then `sendState`. If the score changed: `room.score = score`, `broadcastBoard`. (This reproduces today's `bridgeCheck` and `handleInteract` exactly.)
- **Interact:** player not in a playing round of their room, or session mismatch → `NOT_IN_GAME` (today's message). A known `actionId` → resend its stored reply (`request.accepted`, or the stored error) and stop. Otherwise call `game.interact`; store and send the reply (`INVALID_ACTION` with the module's message on failure); on success `applyEffect(…, 'other')`. The reply goes before any effect, as today.
- **Start:** today's sequence; spawns from `game.spawns`; trackers from `newTracker(spawn, rotation, now, { bounds: game.arena, speed: game.arena.speed })`; `state = game.start(view)`.
- **Time-out:** `round.startedAt + roundMsOf(room)` where `roundMsOf = config.roundMs ?? game.roundMs`; `durationSeconds` in the summary and state uses the same value.
- **State:** `gameState(room)` = `{ ...game.view(state, view), startedAt, durationSeconds, serverTime }`; `finishRound` takes the score from `game.score(state)`.
- The round view is built fresh for each hook call from the two players' accepted positions, rotations and `conn !== null`.

- [ ] **Step 1: Write the failing test** in `world-rounds.test.ts`: `duplicate actionId replays the first reply`. Start a round; player 1 sends `crystal-a` with `actionId: 'dup'` from the spawn (error `INVALID_ACTION`, "Move closer to interact."); walk player 1 to the crystal at (-6, -5) (bridge open via `lever` by player 2 first, as the existing win test does); send `crystal-a` with `actionId: 'dup'` again: the reply is the same `INVALID_ACTION` error and the next `game.state` still shows `crystals: [false, false]`.
- [ ] **Step 2: Run** `npx vitest run --project unit shared/world/world-rounds.test.ts -t "duplicate actionId"`. Expected: FAIL only if the current engine differs. If it passes today, keep it as the regression guard and continue.
- [ ] **Step 3: Implement** the engine rules above; delete `shared/world/portal-partners.ts` and its test, and remove the Portal Partners constants (arena, puzzle objects, `ROUND_MS`) from `config.ts`; update `index.ts` to export `./games/types`, `./games/portal-partners`, `./games/index`; update `test-helpers.ts` imports (`interact` keeps its signature with `target: string`).
- [ ] **Step 4a: Lobby guard:** `npx vitest run --project unit shared/world/lobby-transcript.test.ts shared/world/world.test.ts shared/world/movement.test.ts` passes, and `git diff dev -- shared/world/world.test.ts shared/world/__snapshots__/` shows only import-line changes in `world.test.ts` and no snapshot change.
- [ ] **Step 4: Check the engine is game-free:** `grep -n "portal\|Portal\|bridge\|crystal\|lever" shared/world/world.ts` prints nothing.
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run test:runtime`. Expected: PASS with no existing assertion changed.
- [ ] **Step 6: Commit** `refactor(world): run Portal Partners through the game module hooks`.

### Task 6: Engine support for the hooks Portal Partners does not use

**Files:**
- Create: `shared/world/test-game.ts` (test-only module; not exported from `index.ts`)
- Create: `shared/world/world-games.test.ts`
- Modify: `shared/world/world.ts`

**Interfaces:**
- Consumes: Task 5's `GameRoomConfig.game`, `WorldOptions.onModuleError`, `applyEffect`.
- Produces: `TEST_GAME: GameModule<TestState>` and `testWorld(overrides?: Partial<GameModule<TestState>>)` in `test-game.ts`. `TestState` records its hook calls, and its hooks return values the test sets. `gameType: 'test-game' as GameType`, `roundMs` 10 000, arena 9 × 9 at speed 4, spawns (-1, 0, 0) and (1, 0, 0), `scoreMax` 3, targets `['push', 'win']`, `correctionReasons: ['pushed' as CorrectionReason]`. `testWorld` builds a world with one room `test` at the portal entrance holding this module, admits players 1 and 2, joins them, readies them, and returns the `TestWorld` plus the session ID.

New engine behavior:
- **tick:** at the start of `advance()`, before the deadline loop, call `game.tick` for every playing room and `applyEffect(…, 'other')`.
- **onConnection:** after `announceConnection` in `connectionLost` and in `admit` (restore), when the player is in a playing round: `applyEffect(room, game.onConnection(…), 'other')`.
- **speed:** passed through to the move area (Task 5).
- **ignore:** `checkMove` returning `ignored` sends nothing and keeps the position.
- **Unknown target:** before the `NOT_IN_GAME` check, if the player's room is a game room and `target` is not in `game.targets`, reply `VALIDATION_ERROR` "Interaction target is invalid." with the requestId, and do not call the module.
- **Score out of range:** clamp to `0..scoreMax` and call `onModuleError`.

- [ ] **Step 1: Write the failing tests** in `world-games.test.ts`, each with `testWorld`:
  - `checkMove reject sends player.corrected rejected`; `checkMove ignore drops the move without a reply` (no `player.corrected`, no `player.updated` to the partner; position unchanged in the next `room.snapshot`).
  - `speed hook changes the movement budget` (speed 1: a 1.6-unit move after 100 ms is rejected, 1.4 accepted).
  - `afterMove override moves the partner`: the partner gets `player.corrected {reason: 'pushed', sequence: <partner's last sequence>}`, the mover gets `player.updated` for the partner, and the partner's next move is measured from the override position (a 0.4-unit step from it is accepted).
  - `interact, tick and onConnection overrides reach the right players` (one case each).
  - `an override outside the arena is skipped and reported` (`onModuleError` called once; no message sent).
  - `tick end finishes exactly one round` (`end: 'win'` from tick: one `game.finished` per player, one `takeFinishedRounds()` entry; a second `advance()` adds none).
  - `tick win at the round deadline counts as a win` (tick returns `end: 'win'` only when `view.now >= startedAt + 10_000`; advance the clock by exactly 10 000 ms and call `advance()`: outcome `win`).
  - `interact end win finishes the round`.
  - `unknown target is VALIDATION_ERROR with the requestId` (`target: 'door'`: `request.error {requestId, code: 'VALIDATION_ERROR'}`; the module's `interact` was not called).
  - `onConnection is called on disconnect and on return within grace` (calls recorded `[p1,false]`, then `[p1,true]`).
  - `score reaches the board and is clamped to scoreMax` (score 2 → `room.updated` with score 2; score 9 → 3 and `onModuleError`).
  - `stateChanged from tick bumps the revision once and sends game.state`.
- [ ] **Step 2: Run** `npx vitest run --project unit shared/world/world-games.test.ts`. Expected: FAIL on tick, onConnection, unknown target and clamp; the others may already pass from Task 5.
- [ ] **Step 3: Implement** the behavior above in `world.ts`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS, including `lobby transcript is unchanged` (the new tick call in `advance()` must not touch the lobby).
- [ ] **Step 5: Commit** `feat(world): tick, connection, speed and ignore hooks for game modules`.

### Task 7: Shared results table

**Files:**
- Create: `supabase/migrations/<timestamp>_shared_game_results.sql` (name it with `npx supabase migration new shared_game_results`)
- Modify: `supabase/tests/database/05_results.test.sql` (and its `plan(n)`)

**Interfaces:**
- Produces `public.record_game_result(game_type text, session_id uuid, player_ids uuid[], outcome text, cancel_reason text, score int, started_at timestamptz, completed_at timestamptz) returns jsonb` (`{"resultId": "<uuid>"}`), `security definer`, `set search_path = ''`, EXECUTE for `service_role` only. Same validation and pinned errors (`PT400`/`VALIDATION_ERROR`) as `record_portal_partners_result`, plus: `game_type` must exist in `private.game_types`, and `score between 0 and score_max` for that type. Idempotent by `session_id` across all games, returning the existing ID.
- `get_my_results` and `get_me`'s `winsTotal` keep their output; `gameType` comes from the row.

Migration contents, in order, all in `private` with the existing pattern (row-level security on, `revoke all … from anon, authenticated, public`, grants to `service_role` only):
1. `game_types (game_type text primary key, score_max smallint not null check (score_max >= 0))`; insert `('portal-partners', 2)`.
2. `game_results`: today's `portal_partners_results` columns plus `game_type text not null references private.game_types`, score `check (score >= 0)`, constraints renamed `game_results_*`, index `(completed_at desc, id desc)`.
3. `game_result_participants`: as `portal_partners_participants`, referencing `game_results`, index on `player_id`.
4. Copy: `insert into private.game_results (id, game_type, session_id, outcome, cancel_reason, score, started_at, completed_at) select id, 'portal-partners', … from private.portal_partners_results`, then participants, **keeping ids**.
5. `create or replace private.profile_json` counting wins from the shared tables. New `private.result_json(r private.game_results)` with `'gameType', r.game_type`. `create or replace public.get_my_results` reading the shared tables (body otherwise unchanged).
6. `record_game_result` with its grants.
7. Drop `public.record_portal_partners_result(…)`, `private.result_json(private.portal_partners_results)`, `private.portal_partners_participants` and `private.portal_partners_results`.

- [ ] **Step 1: Write the failing pgTAP tests.** Rename the existing assertions to the shared names (tables, function, privilege checks with the new signature `(text, uuid, uuid[], text, text, integer, timestamptz, timestamptz)`), passing `'portal-partners'` first. Add: `old Portal Partners objects are gone` (`hasnt_table` ×2, `hasnt_function`); `unknown game type is rejected` (`'no-such-game'` → `VALIDATION_ERROR`, nothing written); `score above the game's maximum is rejected` (`portal-partners` score 3); `a test game type allows its own range` (insert `('test-game', 6)` into `private.game_types` in the test, record score 6: ok); `history and wins cover more than one game type` (one `portal-partners` win and one `test-game` win for the same player: `get_my_results` returns both with their `gameType`, `winsTotal` is 2); `game_types is not readable by anon or authenticated`.
- [ ] **Step 2: Run** `npm run db:start` (if not running), then `npm run test:db`. Expected: FAIL (objects missing).
- [ ] **Step 3: Write the migration.** Load the `supabase:supabase-postgres-best-practices` skill first.
- [ ] **Step 4: Run** `npm run db:reset && npm run test:db`. Expected: PASS, all files.
- [ ] **Step 5: Run** `npx supabase db advisors --type security --fail-on warn`. Expected: no warnings.
- [ ] **Step 6: Upgrade check with existing data (local).** `npx supabase db reset --version 20261118031530`; create two local test users (inserting into `auth.users` as `05_results.test.sql` does, so the signup trigger makes their profiles) and record one Portal Partners win with the old function via `psql "$(npx supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')"`; note the result `id` and both players' `winsTotal` from `private.profile_json`; `npx supabase migration up`; check the same `id` is in `private.game_results` with `game_type = 'portal-partners'`, two participant rows exist, and `winsTotal` is unchanged. Record the commands and output in the commit message body.
- [ ] **Step 7: Commit** `feat(db): one shared results table for every game`.

### Task 8: Runtime and mock save results by game type

**Files:**
- Modify: `shared/world/world.ts` (`FinishedRound.gameType`), `runtime/src/supabase.ts`, `runtime/src/results.ts`, `shared/mocks/world.ts:253`
- Test: `runtime/test/helpers.ts`, `runtime/test/supabase.test.ts`, `runtime/test/results.test.ts`, `shared/test/world-contract-suite.ts` (expected objects only)

**Interfaces:**
- Consumes: Task 7's `record_game_result` argument names.
- Produces: `FinishedRound.gameType: GameType`, set in `finishRound` from `room.config.game.gameType`. `PendingResults.due()` returns rounds with `gameType ?? 'portal-partners'` for rows stored before this change. `recordResult` posts to `rpc/record_game_result` with `game_type: round.gameType` plus today's fields. The mock's `toGameResult` uses `round.gameType`.

- [ ] **Step 1: Write the failing tests.** `supabase.test.ts`: the expected URL becomes `…/rpc/record_game_result` and the body includes `game_type: 'portal-partners'`. `helpers.ts`: `RECORD_FN = '/rest/v1/rpc/record_game_result'`, `RecordBody.game_type: string`, comments renamed. `results.test.ts`: rename the filter, and add `pending row without gameType saves as portal-partners`: write a row whose `round` JSON lacks `gameType` straight into `pending_results` (through the object's storage in the test, as the existing restart tests do), fire the alarm, and expect one `record_game_result` call with `game_type: 'portal-partners'` and the row deleted.
- [ ] **Step 2: Run** `npm run test:runtime`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:runtime`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runtime): save every game's results through record_game_result`.

### Task 9: Full verification and handover

**Files:** none (unless a check fails).

- [ ] **Step 1: Run the full local suite**, the same as CI: `npm run typecheck && npm run test:frontend && npm test && npm run test:runtime && npm run test:db && npm run test:integration && npx supabase db advisors --type security --fail-on warn`. Expected: all PASS. The integration suite's two-account Portal Partners scenarios (win, loss, cancellation, reconnect, `ROOM_LOCKED`) are the end-to-end gate.
- [ ] **Step 1a: Lobby guard, whole branch:** `git diff dev -- shared/world/__snapshots__/` shows only the file added in Task 2 Step 0 (compare with `git log --follow`: one commit), and `git diff dev -- shared/world/world.test.ts shared/test/world-contract-suite.ts` shows only imports and added `gameType` fields.
- [ ] **Step 2: Frontend unchanged:** `git diff --stat dev -- frontend/` prints nothing, and `npm run build:frontend` succeeds.
- [ ] **Step 3: Engine boundary:** `grep -rn "cloudflare\|supabase\|document\.\|window\.\|from 'node:" shared/world/` prints nothing.
- [ ] **Step 4: Push and open the pull request** to `dev` (only when Adam asks), listing for Ryan: what changed, the checks run with their results, and Adam's hosted checklist below.
- [ ] **Step 5: Adam's hosted checklist** (manual, after the pull request is approved; agents do not do these): apply the migration to hosted dev Supabase; check existing results still appear in history with the same `winsTotal`; deploy the dev Worker; with two accounts, walk around the courtyard, see each other move, check the board, and join and leave a room (lobby check); two accounts play one Portal Partners round to a win with the unchanged frontend, and the result appears in both players' history.

**Hosted run (11/24/2026, Adam):** after PR #32 merged into `dev`, the migration `20261124044041_shared_game_results` was applied to hosted dev Supabase and the dev Worker was deployed. The results tables showed the earlier Portal Partners results and a new result from a round played after the deploy.
