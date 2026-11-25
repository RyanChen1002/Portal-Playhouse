# Power-Up Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.1

**Date:** 11/24/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/24/2026 | Initial implementation plan for the approved Power-Up Workshop design: hook-exception containment and the room round number first, then the database change, the module, its registration and contract, integration tests, and the documentation updates. |

**Goal:** Two players play Power-Up Workshop in real time, with the server deciding every step and the result saved under `power-up-workshop`; a game module that throws cancels only its own round.

**Architecture:** The World engine (`shared/world/world.ts`) gains two changes: every module hook call is guarded, and a throw cancels that round with the new cancel reason `error`; and `start` receives the room's round number. A new module `shared/world/games/power-up-workshop.ts` implements the rules on the existing hook interface. One migration adds the game type and allows the `error` cancel reason.

**Tech Stack:** TypeScript, Vitest (unit and Cloudflare Workers pools), Supabase Postgres (PL/pgSQL, pgTAP), npm workspaces, Node 22. No new dependencies.

**Spec:** [Power-Up Workshop design](../specs/2026-11-24-power-up-workshop-design.md) (approved 11/24/2026), on the [game framework design](../specs/2026-11-23-game-framework-design.md).

## Global Constraints

- **Local only.** All automated checks use the local Supabase stack and the local Workers runtime. Agents never run `wrangler deploy`, never use `--remote`, and never touch hosted Supabase. Hosted steps are Adam's checklist in Task 8.
- **Lobby and Portal Partners unchanged.** `shared/world/__snapshots__/lobby-transcript.test.ts.snap` is never modified or regenerated (`vitest -u` is forbidden). Portal Partners behaviour tests may not change; only mechanical type narrowing (Task 5) is allowed in them.
- **Exact values** come from the design: `gameType` `power-up-workshop`; room ID `workshop`; `roundMs` 180 000; arena `halfX` 9.6, `halfZ` 7.7, speed 4; spawns (-3, 0, 6) and (0, 0, 6); entrance (-3.24, 0, -9.99), join radius 3.2; interaction radius 1.9; `scoreMax` 6; disconnect `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }`; the target points in design §4.2; the five combinations in design §4.3; the messages in design §4.4.
- **Messages are copied verbatim** from design §4.4, including "Move closer to interact."
- **Cancel reason** `error` is added everywhere a cancel reason is listed: `CancelReason`, the `game_results_cancel_reason_rule` constraint, and `record_game_result`'s validation.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No pushes; Adam opens the pull request.
- **Docs** edited get a Change History row (Version | Date | Change, MM/DD/YYYY, one row per date, newest first) and a matching version header.

## Review Focus

1. **The partner is on the left pad but disconnected** (in grace): `power-right` is rejected, and the round keeps running. Test in Task 4.
2. **Both players ask for the same cable in one tick:** the first gets it, the second gets "Your teammate has that cable." and nothing else changes. Test in Task 4.
3. **A repeated `actionId` on a gear press** (a client retry): the gear turns once, and the retry gets the same reply. Test in Task 5 (engine plus module).
4. **A module throws while lobby players are walking and another room is playing:** only the throwing room's round is cancelled; lobby moves and the other round keep flowing. Test in Task 1.
5. **A module's `score` throws as its round ends in a win:** the round is cancelled with `error` exactly once, and one `FinishedRound` is recorded, not two. Test in Task 1.

---

### Task 1: Contain module hook exceptions

**Files:**
- Modify: `shared/world/world.ts`, `shared/contracts/realtime.ts` (`CancelReason`), `shared/world/test-game.ts`
- Test: `shared/world/world-games.test.ts`

**Interfaces:**
- Produces: `CancelReason = 'left' | 'disconnected' | 'error'`. When any hook (`start`, `checkMove`, `speed`, `afterMove`, `interact`, `tick`, `onConnection`, `view`, `score`) throws, the engine calls `onModuleError("<gameType>: <hook> threw: <error message>")` and finishes the round with outcome `cancelled`, reason `error`. The cancelled round's score is the room's last board score (`room.score ?? 0`), never a fresh `score()` call. A `game.interact` whose hook threw gets `NOT_IN_GAME` "The round ended because of a game error."
- Consumes: the existing `finishRound`, `applyEffect`, `scoreOf`, `onModuleError`.

- [ ] **Step 0: Lobby guard baseline.** Run `npx vitest run shared/world/lobby-transcript.test.ts`. Expected: PASS. Run again after Step 4.
- [ ] **Step 1: Extend the test game.** Add `throwIn: string | null` to `TestState` (default `null`); each hook throws `new Error('boom')` when `throwIn` equals its name. `start` reads a module-level `throwOnStart` flag instead, since there is no state yet. Let `testWorld` take a second option `extraRoom: boolean`; when true, the config also holds a room `test2` running an unmodified `TEST_GAME` at entrance (10.5, 0, 0) for players 3 and 4, started the same way.
- [ ] **Step 2: Write the failing tests** in `world-games.test.ts`, `describe('hook exceptions')`:
  - `it.each(['checkMove','speed','afterMove','interact','tick','onConnection','view','score'])('%s throwing cancels the round with error')`: trigger the hook (a move for `checkMove`/`speed`/`afterMove`, `game.interact` for `interact`, `tw.advanceBy(100)` for `tick`, a disconnect for `onConnection`, `stateChanged` via `nextTick` for `view`, and for `score` set `throwIn` and trigger `interact`). Assert: both connected players get `game.finished` with `outcome: 'cancelled'`, `reason: 'error'`; `tw.world.takeFinishedRounds()` has exactly one entry with `cancelReason: 'error'`; `errors` has one message containing the hook name; the room is back to `waiting`.
  - `'start throwing cancels the round with error'`: same assertions, with no `game.state` sent.
  - `'interact throwing replies NOT_IN_GAME'`: the request gets `request.error` with `NOT_IN_GAME`.
  - `'a throw cancels only its own room'` (Review Focus 4): with `extraRoom`, a lobby player 5 walking, room `test` throws in `tick`; `test2`'s round is still `playing`, gets its next `game.state`, and player 5's moves still reach the lobby.
  - `'score throwing at a win records one cancelled round'` (Review Focus 5): `interactResult` is `{ok: true, effect: {end: 'win'}}` and `throwIn` is `score`; exactly one `FinishedRound`, `outcome: 'cancelled'`, `cancelReason: 'error'`.
  - `'the cancelled score is the last board score'`: score 2 on the board, then `tick` throws; `game.finished.score` is 2.
- [ ] **Step 3: Run** `npx vitest run shared/world/world-games.test.ts`. Expected: the new tests FAIL (uncaught `boom`).
- [ ] **Step 4: Implement.** One private guard in `World`, for example `private guarded<T>(room, hook: string, fn: () => T): T | Aborted`, used at every hook call site, plus `abortRound(room, hook, err)` that reports and calls `finishRound(room, 'cancelled', 'error', undefined, room.score ?? 0)`. `finishRound` gains an optional score argument used instead of `scoreOf`. After an abort, the caller stops: no further hook calls, sends or deadline work for that round in that pass. Callers that send messages (`sendState`, `roomSnapshot`) compute `view` before sending anything.
- [ ] **Step 5: Run** `npm run typecheck && npm test`. Expected: PASS, including `lobby-transcript.test.ts` and every Portal Partners test unchanged.
- [ ] **Step 6: Commit** `feat(world): contain game module exceptions; cancel the round with reason error`.

### Task 2: Pass the room's round number to `start`

**Files:**
- Modify: `shared/world/games/types.ts`, `shared/world/world.ts`, `shared/world/test-game.ts`
- Test: `shared/world/world-games.test.ts`

**Interfaces:**
- Produces: `start(view: RoundView, roundNumber: number): S`. `roundNumber` is 0 for the first round started in that room since the World was created, then 1, 2, … It counts rounds started, whatever their outcome. Portal Partners ignores it.

- [ ] **Step 1: Write the failing test** `'start receives the room round number'`: the test game records `roundNumber` in its state; play three rounds in `test` (end each with an `interact` win), and one round in `test2`; expect 0, 1, 2 in `test` and 0 in `test2`. Also: a round cancelled by `left` still counts.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** a per-room counter on `RoomState`, incremented in `maybeStartRound` after passing it to `start`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): pass the room's round number to a game's start`.

### Task 3: Database: the new game type and the `error` cancel reason

**Files:**
- Create: `supabase/migrations/<timestamp>_power_up_workshop.sql` (via `npx supabase migration new power_up_workshop`)
- Modify: `supabase/tests/database/05_results.test.sql`

**Interfaces:**
- Produces: `private.game_types` row `('power-up-workshop', 6)`; `game_results_cancel_reason_rule` allows `left`, `disconnected` and `error`; `public.record_game_result` accepts `cancel_reason = 'error'` for a cancelled outcome. Same signature, owner, `security definer`, `search_path` and grants as in `20261124044041_shared_game_results.sql`, which the new function body copies with only the cancel-reason check changed.

- [ ] **Step 1: Write the failing pgTAP tests** (update `plan(...)`): a `power-up-workshop` win with score 6 saves; score 7 is `VALIDATION_ERROR`; a `cancelled` result with `error` saves for each game type; `error` with outcome `win` is rejected by the function and by the table constraint; an unknown cancel reason (`timeout`) is still rejected; `game_types` has exactly the rows `portal-partners` 2 and `power-up-workshop` 6.
- [ ] **Step 2: Run** `npm run db:reset && npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `npm run db:reset && npm run test:db && npx supabase db advisors --type security --fail-on warn`. Expected: PASS, no advisor warnings.
- [ ] **Step 5: Commit** `feat(db): add power-up-workshop and the error cancel reason`.

### Task 4: The Power-Up Workshop module

**Files:**
- Create: `shared/world/games/power-up-workshop.ts`, `shared/world/games/power-up-workshop.test.ts`
- Modify: `shared/contracts/realtime.ts` (add `PowerUpWorkshopState` and `PowerUpWorkshopTarget` only; registration is Task 5)

**Interfaces:**
- Consumes: `GameModule`, `RoundView`, `InteractOutcome`, `Effect` from `games/types.ts`; `start(view, roundNumber)` from Task 2.
- Produces: `export const POWER_UP_WORKSHOP: GameModule<PUWState, PUWView>`, not yet in `GAMES`. In contracts:
  ```ts
  export type PowerUpWorkshopTarget =
    | 'gear-0' | 'gear-1' | 'gear-2' | 'cable-0' | 'cable-1' | 'cable-2'
    | 'socket-0' | 'socket-1' | 'socket-2' | 'power-right';
  export const POWER_UP_WORKSHOP_TARGETS: readonly PowerUpWorkshopTarget[];
  export interface PowerUpWorkshopState extends GameStateBase {
    level: number; // 1..5
    gears: [number, number, number]; // 0..3
    gearTargets: [number, number, number]; // 1..3
    sockets: [boolean, boolean, boolean];
    socketCables: [number, number, number]; // 0 = A, 1 = B, 2 = C
    held: [number | null, number | null]; // join order
    mistakes: number;
  }
  ```
- The game's `gameType` is `'power-up-workshop' as GameType` in this task (the contract list grows in Task 5).

Tests call the hooks directly with a hand-built `RoundView` (a helper `viewAt(posA, posB, {connectedB?})`), as `portal-partners.test.ts` does.

- [ ] **Step 1: Write the failing tests**, one `it` per line:
  - static config equals the Global Constraints values; `targets` equals `POWER_UP_WORKSHOP_TARGETS`; `checkMove` always returns `'allow'`.
  - `start(view, n)` gives level `n % 5 + 1`, gears `[0,0,0]`, the design §4.3 targets for that level; `n = 5` gives level 1 again; all five levels match the table.
  - out of range (2.0 from the point) for each of the ten targets: "Move closer to interact."; exactly 1.9 is in range.
  - `gear-n` turns 0→1→2→3→0; turning a matched gear past its target lowers `score` by one.
  - `cable-n`: picks up; holding another: "Plug in the cable you are holding first."; already plugged: "That cable is already plugged in."; partner holds it: "Your teammate has that cable." (Review Focus 2: two calls back to back for players A then B).
  - `socket-n`: empty-handed: "Bring a cable to this socket."; wrong cable: "This socket needs cable X." with X the needed letter, `mistakes` +1, cable still held; right cable: plugged, hands empty, `score` +1; filled socket: "That socket is already connected."
  - `power-right`: each missing condition rejected with "Match the gears and cables, then hold both power stations.": one gear off, one socket empty, partner 2.0 from the left pad, partner on the pad but `connected: false` (Review Focus 1); all met: `{ok: true, effect: {end: 'win'}}` and `score` 6.
  - `onConnection(…, false)` while holding a cable: `held` becomes null for that player, `stateChanged: true`; while empty-handed: `{}`; on return: `{}`.
  - `view` matches `PowerUpWorkshopState` without the base fields; `held` follows join order.
  - Every successful `interact` returns `effect: {stateChanged: true}`.
- [ ] **Step 2: Run** `npx vitest run shared/world/games/power-up-workshop.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module, following `portal-partners.ts`: exported point constants, a `targetPoint` lookup, `invalid(message)`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): Power-Up Workshop game module`.

### Task 5: Register the game, add its room, widen the contract

**Files:**
- Modify: `shared/contracts/realtime.ts`, `shared/world/games/index.ts`, `shared/world/config.ts`, `shared/world/index.ts` (exports), `shared/client/world.ts` (session typing only), `shared/world/lobby-transcript.test.ts` (config only), `shared/test/world-contract-suite.ts` and other Portal Partners tests (type narrowing only)
- Test: `shared/world/games/index.test.ts`, `shared/contracts/realtime.test.ts`, `shared/world/world-rounds.test.ts` (or a new `shared/world/world-workshop.test.ts`)

**Interfaces:**
- Produces: `GAME_TYPES = ['portal-partners', 'power-up-workshop']`; `GameStatePayload` and `SessionSnapshot` become unions discriminated by `gameType`; `GAMES` holds both modules; `WORKSHOP_ROOM: GameRoomConfig` (`id: 'workshop'`, entrance and radius from Global Constraints); `DEFAULT_WORLD_CONFIG.rooms = [PORTAL_ROOM, WORKSHOP_ROOM]`.
- **Lobby guard ruling:** the lobby transcript's `world.snapshot` messages include the board, so a second room would change the recorded session. `lobby-transcript.test.ts` therefore builds its world with `{ ...DEFAULT_WORLD_CONFIG, rooms: [PORTAL_ROOM] }`. The `.snap` file stays untouched and must still pass. A separate test checks the default board lists `portal` then `workshop`.
- Portal Partners test code that reads session fields (for example `session?.bridgeOpen`) narrows on `gameType` first; a small helper such as `ppSession(conn)` is fine. No assertion changes.

- [ ] **Step 1: Write the failing tests:**
  - registry: the existing "registers exactly the contract game types" test now expects both.
  - contract: `game.interact` with each workshop target parses; `GAME_TYPES` includes `power-up-workshop`.
  - world (engine plus module, through `makeWorld()` and the default config): two players walk to `WORKSHOP_ROOM.entrance`, join `workshop`, ready; `game.state` has `gameType: 'power-up-workshop'`, level 1, `durationSeconds` 180; a second round in the same room is level 2; the board's workshop summary has `name: 'Power-Up Workshop'` and its score follows plugged cables; a full scripted win (walk to each gear and press to its target, carry each cable to its socket, partner to (-4, 5), `power-right`) records `outcome: 'win'`, `score: 6`, `gameType: 'power-up-workshop'`.
  - Review Focus 3: the same `actionId` sent twice on `gear-0` turns the gear once, and both replies are `request.accepted`.
  - a disconnect while holding a cable: the partner's next `game.state` shows `held` empty for that player.
  - the default board lists `['portal', 'workshop']`.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the registration, room and contract changes, and the mechanical narrowing.
- [ ] **Step 4: Run** `npm run typecheck && npm run test:frontend && npm test && npm run test:runtime`. Expected: PASS. `git diff dev -- shared/world/__snapshots__/` prints nothing.
- [ ] **Step 5: Commit** `feat: register Power-Up Workshop and add its room`.

### Task 6: Integration: two accounts play Power-Up Workshop

**Files:**
- Modify: `shared/test/real.world.integration.test.ts`, `shared/test/world-contract-suite.ts` (export a `playWorkshopToWin(a, b)` helper beside `playToWin`)

**Interfaces:**
- Consumes: `WORKSHOP_ROOM`, the workshop point constants, `walkTo`, `waitFor`, `record`.
- `playWorkshopToWin` reads `gearTargets` and `socketCables` from the session state; it never assumes a level.

- [ ] **Step 1: Write the tests**, in `describe('real runtime: Power-Up Workshop')`:
  - a win: the result appears in both players' history with `gameType: 'power-up-workshop'`, `outcome: 'win'`, `score: 6`, and `winsTotal` rises by exactly 1 for both.
  - a loss with `runtime.restart({ ROUND_MS: '3000' })`: saved as a loss with the score at that moment; restore the runtime in `finally`, as the Portal Partners loss test does.
- [ ] **Step 2: Run** `npm run db:reset && npm run test:integration`. Expected: PASS, including every existing Portal Partners scenario.
- [ ] **Step 3: Commit** `test: two-account Power-Up Workshop win and loss`.

### Task 7: Contract and spec documents

**Files:**
- Modify: `doc/component-contract.md` (v0.13), `doc/initial-spec.md` (v0.10)

- [ ] **Step 1: Component contract:** §3 `Result.cancelReason` lists `left`, `disconnected` or `error`, and the game types note lists `power-up-workshop`; §5 adds the Power-Up Workshop state and targets by pointing to design §4.2 and §5; §7 notes the `error` cancel reason (saved, never a win). Change History row for 11/24/2026, marked as needing Ryan's approval in the pull request.
- [ ] **Step 2: Initial spec:** §8 blockers: Power-Up Workshop's server design is done (link it); the practice-levels question is answered for Power-Up Workshop only (rotating the five combinations), still open for the other games. FR-08's "approved designs" now include one. Change History row for 11/24/2026.
- [ ] **Step 3: Commit** `docs: contract and spec for Power-Up Workshop`.

### Task 8: Full verification and handover

**Files:** none (unless a check fails).

- [ ] **Step 1: Run the full local suite**, the same as CI: `npm run db:reset && npm run typecheck && npm run test:frontend && npm test && npm run test:runtime && npm run test:db && npm run test:integration && npx supabase db advisors --type security --fail-on warn`. `test:db` runs before `test:integration` because the database tests count whole tables. Expected: all PASS.
- [ ] **Step 2: Lobby guard, whole branch:** `git diff dev -- shared/world/__snapshots__/` prints nothing; `git diff dev -- shared/world/lobby-transcript.test.ts` shows only the config line from Task 5.
- [ ] **Step 3: Frontend unchanged:** `git diff --stat dev -- frontend/` prints nothing, and `npm run build:frontend` succeeds.
- [ ] **Step 4: Engine boundary:** `grep -rn "cloudflare\|supabase\|document\.\|window\.\|from 'node:" shared/world/` prints nothing.
- [ ] **Step 5: Hand over** for Adam to push and open the pull request. The description highlights for Ryan the three items in design §10 (rotating combinations, the state and targets, the `error` cancel reason) and lists the checks run.
- [ ] **Step 6: Adam's hosted checklist** (manual, after the pull request is approved; agents do not do these): apply the migration to hosted dev Supabase, then deploy the dev Worker straight after; check the board shows the workshop room; with two accounts, walk around the courtyard and see each other move (lobby check); play one Portal Partners round to a win and check it saves. A full Power-Up Workshop round on hosted dev waits for Ryan's live view.
