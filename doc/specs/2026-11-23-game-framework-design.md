# Game Framework Design: One Engine, Five Game Modules

**Version:** 0.3

**Date:** 11/23/2026

**Author:** Adam (backend lead), drafted with Claude Code using Superpowers brainstorming

**Status:** Approved by Ryan on 11/23/2026 (framework, generic wire protocol, shared results table).

**Implements:** [initial spec](../initial-spec.md) §8 blocker "server designs for the other four games" (the shared part); prepares FR-06, FR-08, FR-09 and AC-03 to AC-06 for the four remaining games. **Builds on:** [runtime design](2026-11-17-runtime-transport-design.md) (unchanged except where §7 and §8 here say so). **Interfaces:** [component contract](../component-contract.md) §3, §5, §7. **Game source:** `frontend/games/rules.js` and the [local playhouse plan](../plans/local-playhouse/README.md).

Labels: **Decided** means Adam decided it in brainstorming on 11/23/2026. **Proposal** means a call made while drafting; review of the pull request accepts it. **Proposal for Ryan** means it changes an approved requirement and needs Ryan's explicit agreement.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.3 | 11/23/2026 | After the final review: the "Builds on" line names §7 and §8; §5.2 tick timing gains a known-limits note (late `advance()` ordering, uncontained hook exceptions). Earlier the same day (0.2): Ryan approved the framework, the generic wire protocol, and the shared results table (§7); §7.5 stays as the record of the fallback not taken, and the three items in §11 are marked approved. Earlier the same day (0.1): initial framework design, with game modules behind hooks in the existing World engine, with position overrides; Portal Partners moved onto it unchanged; a generic wire protocol keyed by game type; a shared results table proposed for Ryan. |

## 1. Intent

Portal Partners runs in real time today, but its rules are partly wired into the general engine (`shared/world/world.ts`). The first release needs four more games (initial spec §1). This design separates "running a two-player room" from "the rules of one game", so that each remaining game becomes **one game module plus a short game design**, without touching admission, rooms, readiness, reconnects, movement budgets, or result saving.

Sequence (**Decided**): this framework design first, then one design per game (Playhouse Cafe, Room Rescue, Tiny Train Team, Power-Up Workshop). Each game design defines that game's rules on this framework; this document does not.

## 2. Goals, non-goals, anti-goals

**Goals**

- A game-module interface in `shared/world/` (§5) that the `World` engine calls for every game-specific decision.
- Portal Partners moved onto that interface with **no change in behavior**: every existing engine, runtime, integration and contract test passes unchanged, apart from mechanical renames.
- The interface checked against the four remaining games' practice rules (§6), so no game design has to reopen it for a need already known.
- A wire protocol that carries any game's targets and state, backwards compatible for Portal Partners (§8).
- One shared results table and save function for all games (§7, **Proposal for Ryan**), with a fallback if Ryan declines.
- An updated component contract (§9).

**Non-goals**

- Rules, layouts, scores and disconnect settings for the four remaining games. Each gets its own design.
- Registering the four new rooms on the server. A game's room is added with its module, by its own plan.
- Frontend changes beyond what keeps Portal Partners working (none are expected; §8).
- Pause-on-disconnect and finish-alone settings (still deferred, runtime design §5.6).
- One Durable Object per room, or capacity above 16.

**Anti-goals** (failures even if everything else works)

- Portal Partners behaves differently after the refactor, or its frontend (`frontend/live.js`) breaks.
- A game module can bypass the engine's guarantees: the movement budget, one round per start, exactly-once results, identity from the token.
- Game modules reach the network, storage, clock, or random numbers other than through what the engine passes in. The engine must stay deterministic under a fake clock, and the mock must run the same code.
- A new game needs edits to `World` beyond registering its module and room.

## 3. Constraints

- Everything in the runtime design §3 still holds: Cloudflare Workers Free plan, one World Durable Object, free resources only, hosted steps done by Adam, no production changes.
- `shared/world/` stays free of Cloudflare, Supabase and DOM imports (runtime design §9).
- Two players per game room (FR-06); the interface does not need to support other sizes now.
- Ryan's frontend already plays Portal Partners against the real runtime (`frontend/live.js`, hosted test on 11/22/2026), so Portal Partners messages must keep their current shape.

## 4. Approaches considered

1. **Hooks: the engine runs the room, the game supplies rules** (**Decided**). `World` keeps players, positions, budgets, readiness, grace, lifecycle, broadcasting and timers. Each game is a module of functions over its own round state. Hooks can return **position overrides** for any player, generalizing today's hard-coded bridge set-back. Cost: when a game needs something the hooks do not offer, the interface grows; §6 reduces that risk by checking all four games now.
2. **The game owns its room.** `World` handles admission and the lobby, then hands every in-room message, including moves, to a game object that validates and broadcasts itself. Most flexible (a game could invent its own movement model), but each game re-implements or rewires budgets, corrections and rebroadcasts, the refactor is much larger, and games drift apart in behavior. Rejected.
3. **Declarative games** (zones, targets and conditions as data). Fits Portal Partners, but not a moving train or a two-person carry, so it would become approach 1 with extra steps. Rejected.

Not considered further: four separate servers. The runtime design already puts every room in one World Durable Object (runtime design §4.1), and nothing in the four games argues against that.

## 5. Design: the game-module interface

### 5.1 What stays in the engine

`World` continues to own, for every game: admission and the 16-player limit, room joins and their checks, readiness and its reset rule, the round lifecycle (`waiting` -> `playing` -> `finished`/`cancelled` -> `waiting`), session IDs and `startedAt`, the round time limit and time-out loss, the movement budget and sequence numbers, bounds checks, `player.corrected`/`player.updated` broadcasting, revisions, grace and cancellation on leave or grace expiry, duplicate `actionId` handling, `game.state` cadence (on change and at least once per second), `game.finished`, and handing finished rounds to the runtime for saving.

### 5.2 What a game module supplies

Names are indicative; the builder may adjust them in the plan. A module is a plain object registered under its `gameType`.

**Static configuration**

| Field | Purpose | Portal Partners value |
| --- | --- | --- |
| `gameType` | Contract identifier | `portal-partners` |
| `name` | Board label | Portal Partners |
| `roundMs` | Round length; reaching it with no win is a loss | 180 000 |
| `arena` | Bounds (`halfX`, `halfZ`) and base speed | 9.6, 7.7, speed 4 |
| `spawns` | Two spawn positions, in join order | (-3, 6), (0, 6) |
| `scoreMax` | Highest possible score, for the board and the results check | 2 |
| `targets` | The interaction target names the game accepts | `lever`, `crystal-a`, `crystal-b`, `exit` |
| `disconnect` | `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }`; only these values are built | as shown |

The room itself (ID, entrance coordinates, join radius) stays in `WorldConfig.rooms`, which gains a `gameType` per room. Each game's round length comes from its module. `WorldConfig.roundMs` becomes an optional test-only override applied to every game, so the runtime's existing local test setting that shortens rounds (`runtime/test/world-object.test.ts`) keeps working. Entrances follow Ryan's courtyard ring (`frontend/games/rooms.js`).

**Round hooks.** Each receives the module's own round state and a read-only **round view**: the two player IDs in join order, each player's accepted position and rotation, whether each is connected, `now` (from the engine's clock), and `startedAt`. Modules never read the clock or create IDs themselves.

| Hook | Called | Returns |
| --- | --- | --- |
| `start(view)` | When a round starts | The module's initial round state |
| `checkMove(state, view, playerId, from, to)` | For each move that passed the budget and bounds | `allow`, `reject` (engine sends `player.corrected {reason: "rejected"}`), or `ignore` (dropped without reply; used when the game is moving this player itself) |
| `speed(state, view, playerId)` | Optional, when the budget refills | That player's current speed; defaults to `arena.speed`. Lets a game slow a player (for example while carrying something heavy) |
| `afterMove(state, view, playerId)` | After an accepted move | An **effect** (below) |
| `interact(state, view, playerId, target)` | For `game.interact` with a valid session and target | `ok` or an error (`INVALID_ACTION` with a message), plus an effect |
| `tick(state, view)` | On the engine's round timer, at least 10 times per second while playing | An effect |
| `onConnection(state, view, playerId, connected)` | Optional, when a participant disconnects or returns in grace | An effect |
| `view(state, view)` | When building `game.state` and `room.snapshot.session` | The game's state payload (§8) |
| `score(state)` | After every effect | The current score, 0 to `scoreMax`, shown on the board |

**Effects.** Hooks that change things return an effect object with any of:

- `overrides`: a list of `{playerId, position, rotation?, reason}`. The engine sets each player's accepted position, resets their movement budget origin to it (so the next move is measured from there), sends `player.corrected {reason}` to that player and `player.updated` to the others. `reason` is one of the module's declared correction reasons; Portal Partners declares `bridgeClosed`. Positions must still be inside the arena bounds; the engine rejects an override that is not (a module bug, logged).
- `end`: `win` or `loss`. The engine finishes the round exactly as it does today (score from `score(state)`, `game.finished`, saving).
- `stateChanged`: true when `game.state` should be sent now, rather than at the next one-second refresh.

The engine applies overrides before sending anything, so both clients see one consistent result. If a hook returns `end`, no later hook runs for that round. Hooks run only while the round is playing.

**Override details.** `player.corrected` for an override carries the player's latest move `sequence`, so the client drops any prediction older than the correction (as it does today for `bridgeClosed`). A disconnected player's character is moved the same way; they receive the position in their next snapshot, and others receive `player.updated`.

**Tick timing.** The engine's `advance()` runs on the 100 ms timer in both the Durable Object and the mock, and also after every message, so `tick` may be called at irregular intervals. Modules compute from `now` and their own stored times (for example "train step due at `startedAt` + 25 s + n × 10 s"), never by counting calls. Within one `advance()`, `tick` runs **before** the time-out check (**Proposal**): if a module's own win is due by the same `now` that also reaches `roundMs`, the win counts.

**Known limits.** If `advance()` runs late, `tick` can run before an already-overdue grace or idle deadline in the same pass (a window of about one 100 ms interval). Exceptions thrown by a hook are not yet contained; that is planned before the next game module.

**Interaction rules.** Interactions with a position (a lever, a station) check their own range inside `interact`; the engine no longer checks range. Targets without a position, such as `rotate`, are allowed. A target not in the module's `targets` list gets `VALIDATION_ERROR` from the engine without calling the module (**Proposal**). Duplicate `actionId` handling stays in the engine.

### 5.3 Portal Partners on the interface

Moved behavior, all unchanged as seen by players:

- The bridge gap becomes `checkMove` (reject).
- "Bridge closes under a player": the bridge check that today runs after every move (`world.ts`, `bridgeCheck`) becomes `afterMove`, returning `bridgeClosed` overrides. The `lastOutside` position currently kept on each player moves into the module's round state. Portal Partners needs no `tick` or `onConnection`.
- Lever, crystals and exit become `interact`; the exit's "both connected" rule reads `connected` from the round view.
- `game.state` content comes from `view`.

The Portal Partners tests in `shared/world/*.test.ts` are the acceptance test for this step. Tests that only pass because of internal names may be updated mechanically; tests of behavior may not change.

## 6. Check against the four remaining games

Based on the practice rules in `frontend/games/rules.js`. Each game's own design may change its rules; this table only checks that the interface can express what is known.

| Need | Game(s) | How the interface covers it |
| --- | --- | --- |
| Furniture and walls inside the arena | Cafe, Rescue | `checkMove` returns `reject` |
| Different round lengths: 120 s, 240 s | Train, Rescue | `roundMs` |
| Different spawn points | Rescue | `spawns` |
| Something each player is holding, visible to both | Cafe, Rescue, Train, Workshop | Kept in round state, published through `view` |
| Interactions with no position: rotate the sofa or a rail | Rescue, Train | Targets without a position (§5.2) |
| Timed work that is cancelled if a player walks away (cooking) | Cafe | `tick` reads positions from the round view |
| Something moving on its own, ending the round with a win or loss | Train | `tick` returns `end` |
| Two players moving one object together | Rescue | `speed` slows the carriers; the follower's own moves return `ignore`, and `afterMove` on the leader returns an override for the follower. Who leads, and how the follower's client behaves, is Room Rescue's design |
| A player must hold a station while the other acts | Workshop | `interact` reads the partner's position from the round view, as Portal Partners' exit does |
| Mistake counters | Cafe, Train, Workshop | Round state, published through `view` if wanted. Not saved (§7.4) |
| A disconnected player is holding something | Cafe, Rescue, Train, Workshop | `onConnection` may drop it or keep it; each game decides |
| Scores up to 4, 5 or 6 | Cafe, Rescue, Train, Workshop | `scoreMax` |

Known stress point: the sofa carry. Overriding the follower's position about 10 times per second works on the server, but how it looks on the follower's screen is a frontend question. Room Rescue's design must settle it, and may propose an extra hook if this one proves insufficient.

## 7. Results: one shared table

### 7.1 Proposal

Replace "one Supabase result table per game type" (FR-09, contract §7) with **one shared results table that has a `game_type` column**.

Why: every game's result is the same shape (two players, outcome, cancel reason, score, start and end times; contract §3 already requires consistent Result fields). Separate tables would repeat about 200 lines of SQL per game (tables, grants, row-level security, save function, pgTAP tests). Worse, `get_my_results` and `winsTotal` would have to combine five tables and be edited for every new game; forgetting one silently drops that game's wins. With one table, adding a game is one row of data.

Trade-off accepted: checks specific to one game are limited to its score range; any extra per-game fields would need a column that holds different things per game. No game currently needs one (§7.4).

### 7.2 Data

All in the `private` schema, with the same rules as today: not exposed through the Data API, no privileges for `anon` or `authenticated`, row-level security enabled as defense in depth, grants to `service_role` only.

- **`game_types`**: `game_type` (primary key, text) and `score_max` (smallint). One row per game; `portal-partners` with 2 now. Each game's migration adds its row.
- **`game_results`**: same columns as `portal_partners_results` today, plus `game_type` (references `game_types`). `session_id` unique across all games (session IDs are server-generated UUIDs). Score checked as `0 <= score <= score_max` for its game type, in the save function.
- **`game_result_participants`**: same as `portal_partners_participants`, referencing `game_results`, indexed by player.

### 7.3 Functions

- `record_game_result(game_type, session_id, player_ids, outcome, cancel_reason, score, started_at, completed_at)` replaces `record_portal_partners_result`. Runtime only; same validation as today plus a known `game_type` and its score range; idempotent by session ID, returning the existing result ID on a retry.
- `get_my_results` and `get_me` (`winsTotal`) read the shared tables. Their output is unchanged; `gameType` now comes from the row instead of being fixed.
- The runtime passes the module's `gameType` with each finished round. The pending-save and retry path (runtime design §7.3) is unchanged, and pending records written before the change must still save after it (the builder handles records that lack a game type by treating them as `portal-partners`).

### 7.4 Migration

One migration creates the shared tables and functions, copies existing Portal Partners rows and participants (dev only; production has not been created), and drops the old tables and function. pgTAP tests move to the shared tables and add: unknown game type rejected, score above that game's maximum rejected, and history and wins covering more than one game type (using a test-only game type row).

Game-specific details such as mistake counts are **not saved** in the first release. A game design that needs a saved detail proposes a column then.

### 7.5 Fallback (not taken; Ryan approved the shared table)

Keep one table pair and save function per game, and add a single view that combines them for `get_my_results` and `winsTotal`. The engine and runtime do not change: the runtime chooses the save function by `gameType` instead of passing it. Only §7.2 to §7.4 change.

## 8. Wire protocol

**Proposal.** One generic shape for every game, backwards compatible for Portal Partners:

- `game.interact {sessionId, actionId, target}` is unchanged. The contract parser accepts any `target` string of 1 to 32 characters from letters, digits and hyphens; the engine checks it against the room's module (§5.2).
- `game.state {sessionId, revision, state}` and `room.snapshot.session` gain a **`gameType`** field beside `sessionId`. `state` keeps the Portal Partners fields exactly as now (`bridgeOpen`, `latched`, `crystals`, `startedAt`, `durationSeconds`, `serverTime`); other games define their own fields in their designs, always including `startedAt`, `durationSeconds` and `serverTime`. In TypeScript, the state is a union discriminated by `gameType`.
- `RoomSummary.gameType` widens from `'portal-partners'` to the union of game types; `durationSeconds` comes from the module's `roundMs`; `score` from `score(state)`.
- `player.corrected.reason` is `rejected` or a game-declared reason. Portal Partners keeps `bridgeClosed`.
- `GameResult.gameType` widens the same way.
- The client's `WorldConnection.interact(target)` takes a string; per-game target types are exported from `shared/contracts/` for the frontend's convenience.

Portal Partners' existing messages are a subset of this, so `frontend/live.js` needs no change. The new `gameType` field is additive.

## 9. Code layout and contract update

**Proposal** (the builder may refine in the plan):

- `shared/world/games/types.ts`: the module interface, round view and effect types.
- `shared/world/games/portal-partners.ts`: today's `portal-partners.ts`, reshaped into a module. Portal Partners constants move from `config.ts` into it.
- `shared/world/games/index.ts`: the registry from `gameType` to module.
- `shared/world/world.ts`: loses every Portal Partners import; `RoomState.round` holds `{module, state}`; `movement.ts` takes speed and bounds as values instead of a `'courtyard' | 'arena'` location.
- `shared/contracts/realtime.ts`: the §8 changes. `shared/mocks/` gets the change for free, since it runs the same engine.
- `runtime/src/supabase.ts`: calls `record_game_result`.
- `supabase/migrations/`: §7.4.

**Contract update** (component contract, next version; both partners approve before building against it, contract §9): §3 `Result.gameType` and the game-types note; §5 the `game.interact` target rule, the `gameType` field on `game.state` and `room.snapshot.session`, and game-declared correction reasons, replacing the "Other games (open)" paragraph with a pointer here; §7 the shared results table, if Ryan accepts it. The initial spec's FR-09 changes from "a separate Supabase result table per game type" to "one shared results table keyed by game type", if accepted.

## 10. Testing and verification

All local and in CI, as in runtime design §10; no hosted resources.

| Layer | Covers |
| --- | --- |
| Engine (Vitest, fake clock) | All existing Portal Partners tests pass unchanged in behavior. New tests with a small **test-only game module**: `checkMove` reject and ignore; a speed override changing the budget; overrides from `afterMove`, `interact`, `tick` and `onConnection` reaching the right players with the right messages and resetting the budget origin; an out-of-bounds override rejected; `end` from `tick` and from `interact` finishing exactly one round; an unknown target rejected without calling the module; `onConnection` called on disconnect and on return within grace; `score` reaching the board |
| Contract | Parser accepts valid generic targets and rejects invalid ones; `gameType` present on `game.state` and `room.snapshot.session`; mock and real client still agree |
| Database (pgTAP) | §7.4, plus the existing privilege and idempotency tests on the shared tables |
| Runtime | Pending results written before the change still save; finished rounds carry `gameType` to `record_game_result` |
| Integration | The existing two-account Portal Partners scenarios (win, loss, cancellation, reconnect, `ROOM_LOCKED`) pass unchanged |
| Manual (Adam, hosted dev) | After applying the migration to hosted dev: existing results still appear in history with the same `winsTotal`; two accounts play one Portal Partners round to a win with the unchanged frontend |

## 11. Items for Ryan (all approved 11/23/2026)

1. Approved: the shared results table (§7), which changes FR-09 and contract §7. The fallback (§7.5) was not taken.
2. Approved: the generic wire protocol (§8), including the new `gameType` field and target strings checked by the server.
3. Approved: each new game's frontend reads its own `game.state` fields; he confirmed this shape works for his game views.

## 12. Left to the builder

- Exact names of hooks, types and files, within §5 and §9.
- How round state is typed per module (generics or `unknown` with a cast at the registry).
- Whether `checkMove` samples the path itself or the engine provides a path-sampling helper (Portal Partners samples every 0.1 units today).
- How the migration copies rows and the order of drops; SQL bodies and grants, within §7.
- Logging for module bugs (an out-of-bounds override, a score out of range).
- Test organization.
