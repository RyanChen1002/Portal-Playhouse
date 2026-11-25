# Power-Up Workshop Design: Real-Time Rules on the Game Framework

**Version:** 0.1

**Date:** 11/24/2026

**Author:** Adam (backend lead), drafted with Claude Code using Superpowers brainstorming

**Status:** Draft for review.

**Implements:** [initial spec](../initial-spec.md) §8 blocker "server designs for the other four games" for Power-Up Workshop; FR-06 to FR-09 and AC-03 to AC-06 for this game. **Builds on:** [game framework design](2026-11-23-game-framework-design.md) (the module interface, wire protocol and shared results table) and the [runtime design](2026-11-17-runtime-transport-design.md). **Interfaces:** [component contract](../component-contract.md) §3, §5, §7. **Game source:** the practice version in `frontend/games/rules.js` and `frontend/games/practice.js`, and the [game ideas](../mini-game-ideas.md) §5.

Labels: **Decided** means Adam decided it in brainstorming on 11/24/2026. **Proposal** means a call made while drafting; review of the pull request accepts it. **Proposal for Ryan** means it changes an approved requirement or the shared contract and needs Ryan's explicit agreement.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/24/2026 | Initial design: Power-Up Workshop as the second game module; either player can do any step; the five practice combinations rotate round by round; hook exceptions are contained before this module is added. |

## 1. Intent

Power-Up Workshop is the second game to run in real time, and the first new one on the game framework. Two players on separate computers repair a machine together: turn three gears to their targets, plug three cables into their matching sockets, then power the machine with one player on each power pad. The server decides every step and the outcome, and the result is saved in the shared results table like Portal Partners.

It goes first among the four remaining games (**Decided**) because it is the simplest: no walls, no moving objects, and no shared carrying. That tests the framework on an easy case before Room Rescue, Tiny Train Team and Playhouse Cafe.

## 2. Goals, non-goals, anti-goals

**Goals**

- Two players play Power-Up Workshop to a win or a loss in real time, with the server deciding every step; the result is saved under `power-up-workshop` and counts in history and total wins.
- The rules match the practice version closely enough that someone who has played practice knows what to do.
- An exception thrown by a game module no longer stops the whole world (§6). This comes first, before the new module.

**Non-goals**

- Split roles, where each player has their own station or cables must be handed across (**Decided**: left out for simplicity and speed; recorded as an idea in [future features](../future-features.md)).
- Changes to the lobby, movement rules, admission, readiness, reconnects or Portal Partners.
- The frontend's live view of this game. That is Ryan's work, built against the state and targets in §5 (see §8).
- Practice mode changes. Offline practice keeps its own rules and levels.

**Anti-goals**

- One player can finish the game while the other is disconnected. The final step needs both players connected (§4.4).
- A held cable is lost because its holder disconnected, leaving the other player unable to finish (§4.5).
- A bug in this module takes down the lobby or other rooms (§6).

## 3. Approaches

**Who does what** (**Decided**: A).

- **A. Either player does any step**, as in practice. Simplest and fastest to build. The partner is only strictly needed at the final step.
- **B. Split stations.** Each player has their own side of the machine (for example one on gears, one on cables). Makes both players necessary throughout, but needs side assignment and showing the partner's progress.
- **C. Cable handoffs.** Anyone turns gears, but cables sit on one side and sockets on the other, so a cable has to be passed across.

B and C are recorded in [future features](../future-features.md).

**Which target the machine shows** (**Decided**: rotate).

- **One fixed combination** (gears 1, 2, 3; each cable into its own letter). Simplest, but the same every round.
- **Rotate through the five practice combinations**, one per round in the room. Costs about the same, and replays differ. The machine shows the target, so players read it rather than memorize it.

This answers, for this game only, the initial spec §8 open question "whether real-time (server) play includes the five practice levels per game". The pull request for this design highlights it for Ryan.

**How it is built.** One new game module on the framework. There is no sensible alternative: this is what the framework is for.

## 4. Rules

### 4.1 Room and timing

| Setting | Value | Source |
| --- | --- | --- |
| `gameType` | `power-up-workshop` | **Proposal** |
| Board name | Power-Up Workshop | practice |
| Players | exactly 2 (FR-06) | spec |
| Round length (`roundMs`) | 180 000 ms; reaching it without a win is a loss | practice |
| Arena | `halfX` 9.6, `halfZ` 7.7, speed 4 | practice |
| Spawns, in join order | (-3, 0, 6) and (0, 0, 6) | practice |
| Room entrance | (-3.24, 0, -9.99), join radius 3.2: the fifth slot on Ryan's courtyard ring (`frontend/games/rooms.js`, angle 198°) | courtyard |
| Disconnect settings | `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }`, as Portal Partners | **Proposal** |
| Interaction radius | 1.9 from the player's accepted position to the target point | practice |

The room ID is `workshop`, matching the practice room's ID (**Proposal**).

Movement has no obstacles: `checkMove` always allows. The engine's arena bounds and movement budget apply as for every game.

### 4.2 Machine layout

| Target | Point (x, z) | What it is |
| --- | --- | --- |
| `gear-0`, `gear-1`, `gear-2` | (-6, -5), (0, -5), (6, -5) | Gears 1 to 3 |
| `socket-0`, `socket-1`, `socket-2` | (-6, -2), (0, -2), (6, -2) | Sockets 1 to 3 |
| `cable-0`, `cable-1`, `cable-2` | (-6, 1), (0, 1), (6, 1) | Racks for cables A, B and C |
| `power-right` | (4, 5) | The right power pad, where the activating player stands |
| (no target) | (-4, 5) | The left power pad, where the partner stands |

These are the practice positions. The left pad is a place to stand, not an interaction: practice's `power-left` only showed a message, so the server does not accept it (**Proposal**). The module's `targets` list is exactly the ten target names above.

### 4.3 Combinations

Each round uses one of the five practice combinations, taken from `frontend/games/practice.js`:

| Level | Gear targets (gears 1, 2, 3) | Cable each socket needs (sockets 1, 2, 3) |
| --- | --- | --- |
| 1 | 1, 2, 3 | A, B, C |
| 2 | 2, 3, 1 | A, B, C |
| 3 | 3, 1, 2 | B, C, A |
| 4 | 1, 3, 2 | C, A, B |
| 5 | 3, 2, 1 | C, B, A |

The room's first round uses level 1, the next level 2, and so on, back to level 1 after level 5 (**Decided**: rotate). The count is per room and starts again at level 1 whenever the World restarts (a Durable Object restart, or a new mock); that is accepted (**Proposal**). The engine does not count rounds today, so it gains one small change: it passes the room's round number (0 for the first round since the World started) to `start`, and the level is `roundNumber % 5 + 1` (**Proposal**; §6).

### 4.4 Actions

All actions are `game.interact` with a target from §4.2. Each checks the interaction radius first; out of range gets `INVALID_ACTION` "Move closer to interact." Every rejected action leaves the state unchanged except where a mistake is counted.

| Target | Succeeds when | Effect | Rejected with `INVALID_ACTION` |
| --- | --- | --- | --- |
| `gear-n` | always, in range | Gear n turns one step: 0 → 1 → 2 → 3 → 0. A matched gear can be turned past its target (as in practice) | never |
| `cable-n` | the player holds nothing, cable n is not plugged in, and the partner is not holding it | The player now holds cable n | "Plug in the cable you are holding first." / "That cable is already plugged in." / "Your teammate has that cable." |
| `socket-n` | the player holds the cable socket n needs, and socket n is empty | The cable is plugged in; the player holds nothing | Empty-handed: "Bring a cable to this socket." Socket filled: "That socket is already connected." **Wrong cable: "This socket needs cable X."**, and the mistake count goes up by one; the player keeps the cable |
| `power-right` | all three gears match, all three sockets are filled, both players are connected, and the partner is within 1.9 of the left pad | The round ends with a **win** | "Match the gears and cables, then hold both power stations." |

All gears start at 0, so no gear matches at the start. Every combination's targets are 1 to 3, never 0.

Every gear has a matching target and every cable has a socket, so there is no "put down" action: a held cable can always be plugged in (**Proposal**).

Only a wrong cable counts as a mistake, as in practice (**Proposal**). Pressing `power-right` too early does not.

### 4.5 Disconnects

When a player disconnects, any cable they hold goes back to its rack (`onConnection`), so the other player can still finish (**Proposal**). Nothing happens on return within grace. The round keeps running for the 20-second grace, then is cancelled if they have not returned (as for Portal Partners).

### 4.6 Score and result

- **Score:** matched gears plus filled sockets, 0 to 6; `scoreMax` is 6. It is shown on the board and saved with the result. It can go down when someone turns a matched gear past its target.
- **Win:** `power-right` succeeds (§4.4). The saved score is then 6.
- **Loss:** 180 s pass without a win. The saved score is the score at that moment.
- **Cancel:** a player leaves or is declared disconnected, as for every game.
- **Mistakes** are shown to both players during the round but not saved: the shared results table has no column for them (framework design §7.4). A wrong cable is a rejected action, and a rejection carries no effect, so the new count reaches both players with the engine's regular `game.state` refresh, within one second (**Proposal**). The player who made the mistake sees the rejection message at once. This avoids a third framework change.

## 5. Wire protocol

`game.state.state` for this game (**Proposal for Ryan**, since his frontend reads it):

| Field | Type | Meaning |
| --- | --- | --- |
| `level` | 1 to 5 | The combination in use (§4.3) |
| `gears` | `[number, number, number]` | Each gear's current position, 0 to 3 |
| `gearTargets` | `[number, number, number]` | Each gear's target, 1 to 3 |
| `sockets` | `[boolean, boolean, boolean]` | Whether each socket is filled |
| `socketCables` | `[number, number, number]` | The cable each socket needs: 0 = A, 1 = B, 2 = C |
| `held` | `[number \| null, number \| null]` | The cable each player holds, in join order (the order of `players` in the room snapshot) |
| `mistakes` | number | Wrong-cable attempts this round |

plus the engine's `startedAt`, `durationSeconds` and `serverTime`, and `gameType: 'power-up-workshop'` beside `sessionId`. A cable's rack is empty while it is held or plugged in; the frontend can tell which from `held` and `sockets`.

Other contract changes (**Proposal for Ryan**):

- `GAME_TYPES` gains `power-up-workshop`; `RoomSummary.gameType` and `Result.gameType` can be it.
- The ten target names in §4.2 are exported from `shared/contracts/` for the frontend.
- `CancelReason` gains `error` (§6).

No new correction reasons: this game never moves a player.

## 6. Framework changes first

Two engine changes come before the module, in this order.

**1. Contain hook exceptions** (planned in the framework design §5.2, "Known limits"). If any module hook throws (`start`, `checkMove`, `speed`, `afterMove`, `interact`, `tick`, `onConnection`, `view` or `score`), the engine:

- reports it through `onModuleError` (logged as `module.error` by the runtime, a console warning in the mock);
- cancels that round with the new cancel reason `error` (**Proposal for Ryan**): both players get `game.finished` with outcome `cancelled`, no one gets a win, and the result is saved as cancelled like any other cancel;
- carries on with everything else: other rooms, the lobby, and the players in the failed room, who are back in a waiting room as after any cancel.

The module's state for that round is thrown away, since it may be half-changed. If the exception happens while building a message (`view` or `score`), the round is cancelled before anything partial is sent.

Saving `error` cancels needs the results table's cancel-reason check to accept `error`. That goes in this game's migration (§7).

**2. Pass the round number to `start`** (§4.3). The engine counts rounds started in each room and passes the count to `start`. Portal Partners ignores it.

Both changes keep Portal Partners and the lobby unchanged: the recorded lobby session from the framework work must still match, and the Portal Partners tests must still pass.

## 7. Database

One migration (**Proposal**):

- adds `('power-up-workshop', 6)` to `private.game_types`;
- allows the cancel reason `error`, in both places that check it: the `game_results_cancel_reason_rule` constraint on `private.game_results`, and the validation in `record_game_result`, which is replaced with the same signature and grants.

The game type and its score range need no function change: `record_game_result` already checks them against `private.game_types`. Applying the migration to hosted dev is Adam's step, as before; the Worker deploy goes right after it.

## 8. Frontend

The live view of Power-Up Workshop is Ryan's (he leads frontend). This design gives him the state (§5), targets (§4.2), layout (§4.2) and error messages (§4.4). Until his view exists, the game can be played through tests and the mock. The courtyard already has the workshop room from the practice version.

## 9. Testing and verification

All local and in CI; no hosted resources.

| Layer | Covers |
| --- | --- |
| Engine (Vitest, fake clock) | A throwing hook, for each hook, cancels only its round with `error`, reports through `onModuleError`, and leaves another room's round and the lobby running; the round number reaches `start` and counts per room |
| Module (Vitest) | Every action in §4.4, with each rejection and its message; gear wrap-around and a matched gear turned past its target lowering the score; a wrong cable counting one mistake and staying held; a cable the partner holds; out of range for each target; `power-right` with each condition missing (a gear, a socket, the partner off the pad, the partner disconnected); a disconnect returning the held cable; all five combinations, and level 1 again after level 5; win score 6; loss at 180 s with the score at that moment |
| Lobby guard | The recorded lobby session from the framework work is unchanged, and the Portal Partners tests pass |
| Contract | The parser accepts the new game type and state; the mock and real client still agree |
| Database (pgTAP) | `power-up-workshop` results with scores 0 to 6 save; 7 is rejected; an `error` cancel saves; other cancel reasons are still checked |
| Integration | Two accounts play Power-Up Workshop to a win and to a loss against local Supabase; the result appears in both players' history; Portal Partners scenarios still pass |
| Manual (Adam, hosted dev) | After the migration and Worker deploy: Portal Partners still plays and saves; the workshop room appears on the board. A full workshop round on hosted dev waits for Ryan's frontend view |

## 10. Items for Ryan

1. **Rotating combinations** (§4.3): real-time Power-Up Workshop uses the five practice combinations, one per round. This answers the spec's open question about practice levels for this game only.
2. **The game state and targets** (§5), which his live view will read.
3. **The new cancel reason `error`** (§6), which his frontend shows like the other cancel reasons.

## 11. Left to the builder

- Exact names of constants, types and files, following the Portal Partners module.
- How the engine counts rounds per room, and how containment is structured inside the engine (one wrapper or per call site), within §6.
- The player-facing text for an `error` cancel.
- Test organization.
