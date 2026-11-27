# Held-Win Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.1

**Date:** 11/27/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/27/2026 | Initial plan for the two shared rules in the five-game design v0.3: the engine holds a win while a player is disconnected, and Power-Up Workshop accepts a wrong cable as a mistake with shared `feedback`. |

**Goal:** No round is won while a player is disconnected (the win is held until both are back), and a Workshop wrong cable reaches both players at once as an accepted mistake.

**Architecture:** The World engine (`shared/world/world.ts`) gains a held state on `Round`. When an effect ends the round with a win while a round player is disconnected, the engine stores the score and the game's view, stops the clock and freezes the module. It finishes the win when both players are connected again. `GameStateBase` gains `winHeldAt`. The Workshop module changes only its `socket-n` wrong-cable branch and adds `feedback`.

**Tech Stack:** TypeScript, Vitest (unit and Cloudflare Workers pools), npm workspaces, Node 22. No new dependencies; no database change.

**Spec:** [Five-game design v0.3](../specs/five-game-design.md#shared-rules), sections "Held win" and "Mistakes are accepted actions"; [Power-Up Workshop design](../specs/2026-11-24-power-up-workshop-design.md) v0.3, note in §4.4.

## Global Constraints

- **Local only.** No `wrangler deploy`, no `--remote`, no hosted Supabase.
- **Lobby unchanged.** `shared/world/__snapshots__/lobby-transcript.test.ts.snap` is never modified or regenerated (`vitest -u` is forbidden).
- **Existing tests:** Portal Partners and engine tests change only mechanically, by adding `winHeldAt: null` where a test compares a whole `game.state`. Workshop tests change only where they asserted the wrong-cable rejection or a whole view.
- **Frontend untouched.** Showing `feedback` and freezing the countdown on `winHeldAt` are Ryan's (handover, Task 4).
- **Exact text**, verbatim from the spec:
  - held interaction: `INVALID_ACTION` "Waiting for your teammate to reconnect."
  - Workshop `feedback`: "Gear n is now k.", "Connect cable X to its matching socket.", "Cable fitted.", "Socket n needs cable X.", "Cable X went back to its rack." Gears and sockets are numbered 1 to 3 here, cables A to C.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No pushes; Adam opens the pull request.
- **Docs** edited get a Change History row (Version | Date | Change, MM/DD/YYYY, one row per date, newest first) and a matching version header.

## Review Focus

1. **The win is held, then the round clock runs out:** no loss. The time-out is skipped for a held round, and a tick-driven win at exactly `startedAt + roundMs` holds rather than losing (tick runs before deadlines). Tests in Task 1.
2. **Both players disconnect after the hold:** the first to return still sees the held state; the win comes only when the second returns. Test in Task 1.
3. **Grace expires on a held round:** cancelled with `disconnected` and the held score, without calling `score`. Test in Task 1, with `throwIn: 'score'` set after the hold.
4. **The winning action is retried with the same `actionId` after the hold:** it gets `request.accepted` again (the stored reply), not the waiting rejection. Test in Task 1.
5. **Workshop: a wrong cable, then the right one:** `mistakes` stays 1 and `feedback` becomes "Cable fitted." Test in Task 2.

---

### Task 1: Hold a win while a player is disconnected

**Files:**
- Modify: `shared/contracts/realtime.ts` (`GameStateBase`), `shared/world/world.ts`, `shared/world/world-rounds.test.ts` (and any other test comparing a whole `game.state`: add `winHeldAt: null`)
- Test: `shared/world/world-games.test.ts`, new `describe('held win')`

**Interfaces:**
- Produces: `GameStateBase.winHeldAt: string | null`, the ISO time the win was held, otherwise `null`. `Round` gains `held: { at: number; score: number; view: object } | null`.
- Consumes: `finishRound`, `applyEffect`, `scoreOf`, `gameState`, `notifyConnection`, `nextDeadline`, `advance`, `handleInteract`, `move`, `speedOf`, and the test game's `nextTick`, `interactResult` and `throwIn`.

Engine behaviour, per call site (the module is frozen once `round.held` is set):

| Where | While held |
| --- | --- |
| `applyEffect`, `end: 'win'` with a round player whose `conn` is `null` | Hold instead of finishing. Store `at: now`, `score` from `scoreOf`, and `view` from the module's `view` (either may abort the round). Bump the revision, send `game.state`, and update the board score. |
| `advance` tick loop | Skip `tick` |
| `nextDeadline` | No round time-out |
| `handleInteract`, after the `prior` lookup | Return `INVALID_ACTION` "Waiting for your teammate to reconnect."; do not store it in `actions` |
| `move` | Use `arena.speed` (no `speed` hook); `checkMove` still applies; no `afterMove` |
| `notifyConnection` | No `onConnection`. When `connected` and both round players are connected, `finishRound(room, 'win', null, undefined, held.score)` |
| `gameState` | The stored `view` instead of calling `view`; `winHeldAt: iso(held.at)` |
| `finishRound` with no `fixedScore` (leave, grace expiry) | Use `held.score`, not `scoreOf` |

- [ ] **Step 0: Lobby guard baseline.** Run `npx vitest run shared/world/lobby-transcript.test.ts`. Expected: PASS.
- [ ] **Step 1: Write the failing tests** in `describe('held win')`. Each uses `testWorld()`, then `tw.world.connectionLost(conn(2))` unless stated:
  - `'a win with the partner disconnected is held'`: `state.score = 3`, `interactResult = {ok: true, effect: {end: 'win'}}`, player 1 interacts. Player 1 gets `request.accepted` and one `game.state` with `winHeldAt: iso(tw.now())` and `score: 3`. No `game.finished`; `takeFinishedRounds()` is empty; the board shows `status: 'playing'` and score 3.
  - `'the round clock stops while held'`: hold, then `tw.advanceBy(10_000 + 5_000)` within grace (graceMs 20 000). No `game.finished`; `takeFinishedRounds()` is empty.
  - `'a tick win at the time-out holds'` (Review Focus 1): `tw.advanceBy(10_000 - 1)`, set `state.nextTick = {end: 'win'}`, `tw.advanceBy(1)`. The round is held, not lost.
  - `'interactions are rejected while held'`: after the hold, player 1 interacts with a new `actionId`: `request.error` `INVALID_ACTION` "Waiting for your teammate to reconnect."; `state.calls.interact` does not grow.
  - `'the winning action retried gets its first reply'` (Review Focus 4): the same `actionId` again gets `request.accepted`.
  - `'the module is frozen while held'`: after the hold, set `state.throwIn` to each of `tick`, `view`, `speed`, `afterMove`, `onConnection` in turn and exercise it: `tw.advanceBy(1000)`, a move by player 1, and a return of player 2 for `onConnection` (in its own world). `errors` stays `[]`, and the periodic `game.state` still carries `winHeldAt`.
  - `'the win completes when the partner returns'`: hold with score 3, then `admit(tw, 2)`. Player 2 gets `world.snapshot` (session with `winHeldAt` set) before `game.finished`; both get `game.finished` `{outcome: 'win', score: 3}`. One `FinishedRound` with `outcome: 'win'`, `cancelReason: null`, score 3; the room is back to `waiting`.
  - `'both disconnected: the win waits for both'` (Review Focus 2): hold, `connectionLost(conn(1))`, `admit(tw, 1)` (still held, no `game.finished`), then `admit(tw, 2)` (win).
  - `'grace expiry cancels a held round with the held score'` (Review Focus 3): hold with score 3, set `state.throwIn = 'score'`, `tw.advanceBy(20_000)`. Player 1 gets `game.finished` `{outcome: 'cancelled', reason: 'disconnected', score: 3}`; `errors` is `[]`.
  - `'leaving cancels a held round'`: hold, player 1 sends `room.leave`; one `FinishedRound` `cancelled`/`left`.
  - `'a win with both connected is not held'`: no disconnect, a win interaction finishes at once, as before.
- [ ] **Step 2: Run** `npx vitest run shared/world/world-games.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the contract field and the table above. Give the hold its own private method, for example `holdWin(room)`, called from `applyEffect`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Fix only the mechanical `winHeldAt: null` assertions in existing tests. Expected: PASS, including `lobby-transcript.test.ts`.
- [ ] **Step 5: Commit** `feat(world): hold a win while a player is disconnected`.

### Task 2: Workshop wrong cable as an accepted mistake, with `feedback`

**Files:**
- Modify: `shared/contracts/realtime.ts` (`PowerUpWorkshopState.feedback: string`), `shared/world/games/power-up-workshop.ts`
- Test: `shared/world/games/power-up-workshop.test.ts`, `shared/world/world-workshop.test.ts`

**Interfaces:**
- Produces: `PUWState.feedback: string`, `''` from `start`; `view` includes it.
- Every accepted action sets `feedback` and returns `{ok: true, effect: {stateChanged: true}}`. The wrong-cable branch stays after the "already connected" and "empty-handed" checks; those remain rejections.

- [ ] **Step 1: Write the failing tests** (module):
  - `start` gives `feedback: ''`.
  - gear: turning `gear-1` from 0 sets "Gear 2 is now 1."
  - cable: taking `cable-2` sets "Connect cable C to its matching socket."
  - right cable: "Cable fitted."
  - wrong cable: holding A at `socket-0` when it needs B returns `{ok: true, effect: {stateChanged: true}}`, `mistakes` 1, still holding A, `feedback` "Socket 1 needs cable B." Replace the old rejection assertions at lines 129 and 133 of the existing test.
  - Review Focus 5: then plug A into its own socket. `mistakes` stays 1 and `feedback` is "Cable fitted."
  - disconnect while holding cable B: `feedback` "Cable B went back to its rack."; empty-handed disconnect leaves `feedback` unchanged.
  - the `view` equality test includes `feedback`.
- [ ] **Step 2: Write the failing world test** in `world-workshop.test.ts`: player 1 plugs a wrong cable; player 1 gets `request.accepted`, and both players get a `game.state` with `mistakes: 1` and the `feedback` text in the same pass, without `tw.advanceBy`.
- [ ] **Step 3: Run** `npx vitest run shared/world/games/power-up-workshop.test.ts shared/world/world-workshop.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run test:runtime`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(workshop): accept a wrong cable as a mistake; add shared feedback`.

### Task 3: Component contract

**Files:**
- Modify: `doc/component-contract.md` (v0.14)

- [ ] **Step 1:** §5: `game.state` always includes `winHeldAt` beside `startedAt`, `durationSeconds` and `serverTime`. The Power-Up Workshop line notes `feedback` and that a wrong cable is accepted, pointing to the five-game design's shared rules. §7 (disconnects): no round is won while a player is disconnected; the win is held, the clock stops, and the round completes on return or is cancelled at grace expiry or leave. Change History row for 11/27/2026, marked as needing Ryan's approval in the pull request.
- [ ] **Step 2: Commit** `docs: contract v0.14 for the held win and Workshop feedback`.

### Task 4: Full verification and handover

- [ ] **Step 1: Run the full local suite**, as CI does: `npm run db:reset && npm run typecheck && npm run test:frontend && npm test && npm run test:runtime && npm run test:db && npm run test:integration`. Expected: all PASS.
- [ ] **Step 2: Guards:** `git diff dev -- shared/world/__snapshots__/ frontend/` prints nothing. `grep -rn "cloudflare\|supabase\|document\.\|window\.\|from 'node:" shared/world/` prints nothing.
- [ ] **Step 3: Hand over** for Adam to push and open the pull request. The description lists the checks run and asks Ryan to:
  - sign off on five-game design v0.3 and contract v0.14;
  - show `feedback` in the Workshop live view, since the wrong-cable hint is no longer a rejection message;
  - freeze the countdown and show "waiting for teammate" while `winHeldAt` is set. No merged game triggers a hold yet, but the three new games will.
