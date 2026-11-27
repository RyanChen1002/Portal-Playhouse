# Portal Playhouse Five-Game Design

**Version:** 0.2

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.2 | 11/27/2026 | Fixed four tables, clarified Rescue and Train wording, and documented the proposed shared win rule during disconnects. |
| 0.1 | 11/25/2026 | Created one review document for all five games. Consolidated the three 11/24 drafts and linked the two merged designs. Game rules unchanged. |

Use this page to review the game rules and prepare the remaining Cloudflare implementations. The three drafts below each describe one online level. Review their interaction targets, state, and result handling together before building against them. All games reuse the [shared framework](2026-11-23-game-framework-design.md) and [component contract](../component-contract.md).

| Game | Design | Status |
| --- | --- | --- |
| Portal Partners | [Online rules](2026-11-17-runtime-transport-design.md#6-design-portal-partners-on-the-server) | Merged server design |
| Power-Up Workshop | [Online rules](2026-11-24-power-up-workshop-design.md) | Merged server design |
| Playhouse Cafe | [Draft rules](#playhouse-cafe) | Interface review pending |
| Room Rescue | [Draft rules](#room-rescue) | Interface review pending |
| Tiny Train Team | [Draft rules](#tiny-train-team) | Interface review pending |

## Proposed shared win rule

The engine may award a win only while both players are connected. A disconnected player can rejoin during the existing grace period, after which both players can finish together. Grace expiry and explicit leave still cancel the round. The shared engine change is a backend follow-up.

## Playhouse Cafe

### 1. Purpose and Scope

Define the first online Playhouse Cafe round for two players on separate computers. The server owns the order, held items, preparation, score, and outcome. This design adds the Cafe rules to the shared game-module framework; it does not change room admission, readiness, result persistence, or the shared wire envelope.

**Source baseline:** This design targets merged `dev` as checked on 11/24/2026: initial spec v0.9, component contract v0.12, and game framework design v0.3 ([source commit](https://github.com/RyanChen1002/Portal-Playhouse/tree/00250c289ff479c30d65da8dd42f19bc83b9a447)). Review this draft against the current spec and contract before implementation.

**Confirmed in this conversation**

- Online Cafe launches with one level. The existing five-level practice mode remains local.
- Both online players must each complete at least one correct order.
- Use a flexible order split. If one player has not completed an order when only the fourth order remains, that player must complete it.

**Project requirements and framework**

- The first release includes five cooperative real-time games, with the server deciding outcomes.
- The game uses the approved module framework and shared results flow; game type is `playhouse-cafe`.
- A two-player room starts after both players are ready. The game module receives both players in join order.
- Keep running during the 20-second reconnect grace; cancel on grace expiry or an explicit leave. Cancellations do not award wins.

These are design decisions for review, not authorization to implement. The team working agreement requires partner agreement on shared product scope before implementation.

### 2. Intent and Goals

Make a short, readable kitchen teamwork round that preserves the first local Cafe level while requiring both online teammates to finish an order. Players learn one repeatable loop: read the order, carry matching ingredients, prepare them at the correct station, and serve the dish.

The round should:

- Give both players visible, shared progress and show who must complete the final order when the participation rule applies.
- Reject invalid interactions without awarding progress.
- End in a server-authoritative win or timeout loss, with a score that means completed orders.
- Keep the existing practice mode and its later-level handoffs and order variations unchanged.

### 3. Approaches Considered

1. **Translate local Level 1 exactly.** Any player could complete every order. This is the closest port and simplest to build, but does not ensure both players participate.
2. **Keep the Level 1 loop and add a minimum-participation gate - selected.** Each player completes at least one order; the first three can be split freely, and the final order goes to the player with no completed order if there is one. This meets the chosen cooperative requirement without adding a tray or handoff mechanic.
3. **Alternate players for all four orders.** This guarantees participation and is easy to explain, but forces a stricter 1-2-1-2 schedule than requested. The flexible final-order gate is preferred.

### 4. Arena and Interactions

Proposal: retain the existing practice arena and interaction layout so the online view can reuse the current Cafe scene.

| Setting | Value |
| --- | --- |
| `gameType` | `playhouse-cafe` |
| Players | Exactly two |
| Round length | 180,000 ms (180 seconds) |
| Arena half-width / half-depth | 9.6 / 7.7 |
| Movement speed | 4 |
| Spawns, in join order | `(-3, 0, 6)`, `(0, 0, 6)` |
| Score range | 0-4; one point per correctly served order |
| Custom movement correction reasons | None |
| Disconnect settings | `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }` |
| Interaction range | 1.9 units from the target |

Target IDs and positions use the current practice layout (`y = 0`):

| Target | Position `(x, z)` | Rule |
| --- | --- | --- |
| `salad` | `(-7, -5)` | Take raw salad ingredients if hands are empty. |
| `soup` | `(-3, -5)` | Take raw soup ingredients if hands are empty. |
| `board` | `(2, -5)` | Prepare carried raw salad. |
| `stove` | `(7, -5)` | Prepare carried raw soup. |
| `serve` | `(6, 4)` | Serve the current requested prepared dish. |
| `bin` | `(-7, 4)` | Clear the interacting player's carried item; cancel only that player's preparation, if any. |

The movement hook rejects movement through the Cafe's existing furniture. The runtime continues to enforce arena bounds and movement budgets. Targets stay within the shared interaction-target syntax.

Furniture collision boxes follow the current practice layout. The values below are center coordinates and half-extents in the X/Z plane:

| Furniture | Center(s) | Half-width | Half-depth |
| --- | --- | --- | --- |
| Rear counter row | `(-7, -5)`, `(-3, -5)`, `(2, -5)`, `(7, -5)` | 1.7 | 1.1 |
| Serving counter | `(6, 4)` | 1.8 | 0.9 |
| Clear-item station | `(-7, 4)` | 0.8 | 0.8 |

The current practice scene renders the clear-item target at `(-7, 4)` as a planter. Proposal: give this interaction a distinct, clearly labeled clearing-station visual in the online Cafe; do not rely on the planter alone to communicate its function. Ryan should review the visual change before frontend implementation.

### 5. Round Rules

The fixed order sequence is **salad, soup, salad, soup**. The first order is active at round start.

```text
Read current order
  -> take matching raw ingredients
  -> use the matching station and remain nearby for 2.5 seconds
  -> carry the prepared dish to the serving counter
  -> correct dish: score +1 and reveal the next order
```

- A player may carry one item at a time. Taking ingredients while holding an item is rejected.
- `board` accepts only raw salad; `stove` accepts only raw soup. Only one preparation job may be active at a time.
- Preparation completes 2.5 seconds after it starts if its player remains within 2.4 units of the station. Walking farther away cancels that preparation; the raw ingredients remain held.
- A player may clear their own carried item at `bin`. Clearing an item must not cancel another player's preparation.
- A wrong-dish `serve` attempt is a valid gameplay attempt: it increments the session mistake counter, leaves the current order and score unchanged, keeps the dish held, and updates shared feedback. The player can clear the item and try again. It is accepted as a game event, not returned as an invalid-action error.
- Out-of-range actions, wrong-station actions, full-hands actions, and attempts by the ineligible player to take ingredients, prepare, or serve the reserved final order are rejected without changing game state.
- Credit an order to the player whose held prepared dish is accepted at `serve`. Items cannot be transferred between players.
- When the fourth order becomes current, if one player has completed zero orders, reserve the entire order for that player: only they may take ingredients, start or continue preparation, and serve it. If the other player's preparation is active at that transition, cancel it and leave their held item available to clear at `bin`. If both players have completed at least one order, either may complete the fourth order.
- The round wins after all four orders are served and both players have completed at least one. The engine ends the round on timeout as a loss if this condition has not been reached by 180 seconds.

There is no penalty beyond a mistake count for a wrong dish. Mistakes are round state for display only and are not part of the persisted result. The score is the number of completed orders, from 0 to 4.

### 6. State and Framework Mapping

The game module uses the shared `GameModule` interface. It does not read the system clock, generate IDs, access storage, or send network messages. Timed preparation uses `RoundView.now`; the engine owns `startedAt`, `durationSeconds`, and `serverTime`.

The game-specific `game.state` fields should include:

- `orders`: the four fixed dish IDs.
- `completedOrders`: integer from 0 to 4.
- `players`: both player IDs, each player's held item (or `null`) and completed-order count.
- `preparation`: `null` or the dish, owning player ID, and remaining milliseconds. Internally, the module stores a completion deadline derived from `RoundView.now`.
- `mistakes`: wrong-dish attempts in this round.
- `requiredOrderPlayerId`: `null` except when the final order is reserved for the player who has not completed an order.
- `feedback`: short shared text describing the latest gameplay result or required action.

The game view is public to both room participants and contains no account secrets. The engine adds the standard time fields and the outer `gameType`. The game module returns score 0-4; it uses the shared result table and creates no Cafe-specific database table or events.

### 7. Disconnects, Replay, and Results

- An unexpected disconnect leaves the round running during the 20-second grace. Held items and preparation state remain in the round; the disconnected player cannot issue actions.
- Round and preparation deadlines continue during grace. A preparation job completes normally if its player remains within range until its deadline.
- Reconnection within grace restores the player to the same position and game state.
- Grace expiry or an explicit leave cancels the round with no win. Use the shared cancellation reason and result flow.
- Replay creates a new session and resets orders, held items, preparation, mistakes, and per-player completion counts.
- A completed result records `gameType: playhouse-cafe`, outcome, score 0-4, and the shared timestamps/participants. Mistakes are not persisted.

### 8. Acceptance Checks

1. Two ready players start one round with the first salad order, score 0, empty hands, and a 180-second limit.
2. Correct ingredients prepared at the matching station complete after 2.5 seconds only while the player stays nearby; leaving cancels preparation.
3. A correct serving advances exactly one order and one point. A wrong-dish attempt increments mistakes and updates feedback but does not advance the order or score.
4. The first three orders may be completed by either player. If one player has no completed order before the final order, the whole final order is reserved for that player; the other player cannot take ingredients, prepare, or serve it. Any preparation owned by the other player is cancelled at the transition. The round wins at score 4 only after both players have order credit.
5. Unknown targets, out-of-range actions, invalid station use, and full-hands actions cannot award progress or mutate unrelated player state.
6. Movement cannot pass through furniture or outside engine bounds.
7. Timeout produces a loss with the current score. Reconnect within grace preserves the round and its running preparation timer; grace expiry and explicit leave cancel it without a win.
8. Both clients receive the same order, held-item, preparation, mistake, contribution, and score state; duplicate actions cannot advance an order twice.
9. Replay starts a clean round, and the shared result flow persists one result per session without a Cafe-specific table.

### 9. Not Included

- Online versions of Cafe practice levels 2-5.
- Tray handoffs, role locks, extra recipes, or order variation.
- Persistent mistake counts, currencies, unlocks, or Cafe-specific result storage.
- Changes to the shared engine, lobby, room lifecycle, or other games.

### 10. References and Builder Decisions

- [Initial specification](../initial-spec.md), especially FR-06, FR-08, FR-09, AC-04-AC-07, and the disconnect policy (v0.9 on the source baseline).
- [Component contract](../component-contract.md), especially the real-time envelope, shared state fields, and cancellation/result rules (v0.12 on the source baseline).
- [Game framework design](2026-11-23-game-framework-design.md), especially §§5-8 (v0.3 on the source baseline).
- [Local practice rules](../plans/local-playhouse/README.md) and [Cafe rules](../../frontend/games/rules.js), as the Level 1 starting point.

The implementation plan must define the concrete TypeScript state type and test organization within the approved module interface. The frontend plan must show the current order, preparation progress, score, mistakes, and any required final-order player. Confirm the collision layout against the Cafe scene and get Ryan's review of the proposed clear-item station before frontend implementation. This design does not approve changes to the shared component contract; both partners review any contract update before building against it.

## Room Rescue

### 1. Purpose and Scope

Define the first online Room Rescue round for two players on separate computers. The server owns item placement, sofa state and movement, score, and outcome. This design adds the Rescue rules to the shared game-module framework; it does not change room admission, readiness, result persistence, or the shared wire envelope.

**Source baseline:** This design targets merged `dev` as checked on 11/24/2026: initial spec v0.9, component contract v0.12, and game framework design v0.3 ([source commit](https://github.com/RyanChen1002/Portal-Playhouse/tree/00250c289ff479c30d65da8dd42f19bc83b9a447)). Review this draft against the current spec and contract before implementation.

**Confirmed in this conversation**

- Online Rescue launches with one level. The existing five-level practice mode remains local.
- The player who starts the sofa lift leads its movement; the partner follows automatically.

**Project requirements and framework**

- The first release includes five cooperative real-time games, with the server deciding outcomes.
- The game uses the approved module framework and shared results flow; game type is `room-rescue`.
- A two-player room starts after both players are ready. The game module receives both players in join order.
- Keep running during the 20-second reconnect grace; cancel on grace expiry or an explicit leave. Cancellations do not award wins.

The rules below are design decisions for review, not authorization to implement. The team working agreement requires partner agreement on shared product scope before implementation.

### 2. Intent and Goals

Restore the lounge by placing four small furnishings in their matching outlines and moving one shared sofa through the partition doorway. The four small deliveries may happen in any order. The sofa requires both teammates to gather and lift it, then the lift initiator steers the pair.

The round should:

- Make each placed object and the shared sofa visibly agree between both clients.
- Prevent carrying objects through the partition or room boundaries.
- Make the sofa's controlling player and follower state clear to both participants.
- End in a server-authoritative win or timeout loss, with a score that means placed objectives.
- Keep the five-level local practice mode unchanged.

### 3. Approaches Considered

1. **Lift initiator leads; partner follows - selected.** The initiator controls the pair at reduced speed; the server positions the partner at the sofa-relative offset. This matches the practice model and the framework's `speed`, `checkMove`, `afterMove`, and `onConnection` hooks. The follower has no independent movement during the lift.
2. **Allow a leadership handoff during the lift.** This gives each player control, but switching the leader changes the pair's anchor and needs extra transitions and UI. It is not part of this first online level.
3. **Combine both players' movement inputs.** This could give both players direct control, but the shared engine does not aggregate paired movement inputs. It would need a broader framework change and is outside this game's scope.

### 4. Arena and Interactions

Proposal: preserve the first practice level's room bounds, spawns, objects, and interaction positions.

| Setting | Value |
| --- | --- |
| `gameType` | `room-rescue` |
| Players | Exactly two |
| Round length | 240,000 ms (240 seconds) |
| Arena half-width / half-depth | 9.6 / 7.7 |
| Normal movement speed | 4 |
| Sofa leader speed | 2.4 |
| Spawns, in join order | `(-3, 0, 6)`, `(-5, 0, 6)` |
| Score range | 0-5; one point per correctly placed item or sofa |
| Correction reason | `sofaCarry` for server repositioning during a carry |
| Disconnect settings | `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }` |
| Interaction range | 1.9 units, except sofa lift proximity below |

Target IDs and positions use the current practice layout (`y = 0`):

| Target | Position `(x, z)` | Rule |
| --- | --- | --- |
| `item-0` through `item-3` | `(-7, 3i - 5)` | Pick up item `i` if it is not carried and the player has empty hands; if the same player is carrying it, return it here. |
| `spot-0` through `spot-3` | `(7, 3i - 5)` | Place only the matching item. |
| `sofa` | `(-5, 0)` | Lift only when both players have empty hands and are within 2.7 units. The player who interacts becomes leader. |
| `rotate-sofa` | No position | Rotate the carried sofa 90 degrees; leader only, and only in the safe rotation area. |
| `sofa-spot` | `(5, 0)` | Place the sofa while carrying; leader only. |

The partition is centered at `x = 0`, with a doorway open for `|z| <= 1.45`. Current practice places its wall sections at `z = -4.8` and `z = 4.8`. Small items use the player-sized collision footprint. While carrying the sofa, validate its full oriented footprint: half-extents are `(2, 0.7)` when horizontal and `(0.7, 2)` when vertical. The movement hook rejects a move whose path intersects the partition outside the doorway or crosses the arena boundary.

### 5. Round Rules

- The round starts with four unplaced items, the sofa at `(-5, 0)`, and score 0.
- A player may carry one small item at a time. An item can be held by only one player. Items can be placed in any order, but only on their matching outlines.
- A wrong outline, an already-carried item, or an attempt to pick up an item while carrying another is rejected without progress.
- Placing a matching small item adds one point and clears that player's held item.
- The sofa cannot be lifted while either player is carrying an item. Both players must be within 2.7 units of its target. The lift initiator becomes leader; on lift, the server aligns the partner at the follower offset.
- While carrying, the leader moves at speed 2.4. The follower's movement requests are ignored, and the server overrides the follower's position after each accepted leader move. The follower offset is `(-1.3, 0)` when horizontal and `(0, -1.3)` when vertical, matching the practice movement model.
- The follower's client must not predict independent movement during the carry. It renders authoritative follower updates with smooth interpolation. The server remains authoritative; the visual interpolation does not change accepted positions.
- The sofa starts vertical (`rotation = 1`, modulo 4). `rotate-sofa` is accepted only from the leader while `abs(x) >= 2.3` and `abs(z) <= 5.7`; rotate once to make it horizontal before crossing the center doorway. Recalculate the follower offset when orientation changes.
- On the final approach, the leader uses `sofa-spot` to place the sofa and end the paired-carry state. This adds one point. The round wins when the sofa and all four items are placed.
- `scoreMax` is 5. The engine ends the round on timeout as a loss if the win condition has not been reached by 240 seconds.

### 6. State and Framework Mapping

The game module uses the shared `GameModule` interface. It does not read the system clock, generate IDs, access storage, or send network messages. Movement and reconnect decisions use `RoundView.now` and the player positions/connections passed by the engine.

The game-specific `game.state` fields should include:

- `itemsPlaced`: four booleans, indexed by item number.
- `players`: both player IDs and each player's held item (or `null`).
- `sofa`: `atSource`, `carried`, or `placed`; while carried, include leader ID and orientation.
- `score`: derived from the number of placed items plus the placed sofa.
- `feedback`: short shared text for current objectives and rejected placement/carry attempts.

While carrying, the leader's accepted movement is checked against the sofa footprint. The follower's own moves return `ignore`; accepted leader movement and rotation return `sofaCarry` overrides for the follower. No new framework hook or event is required, but the contract must allow the game-declared `sofaCarry` correction reason before implementation.

### 7. Disconnects, Replay, and Results

- A disconnected participant's held item and position remain in state during the 20-second grace. The room remains active.
- If the sofa leader disconnects while the partner is connected, promote the connected partner to leader and reposition the disconnected player to the follower offset. If the previous leader reconnects, keep the current leader until the sofa is placed to avoid another position shift. This is a proposal to preserve control while the round keeps running.
- If the follower disconnects, the leader may keep moving the pair; server overrides continue to position the disconnected follower. A player with a held small item keeps it through grace.
- Grace expiry or an explicit leave cancels the round with no win. Use the shared cancellation reason and result flow.
- Replay creates a new session and resets placed items, held items, sofa state, and score.
- A completed result records `gameType: room-rescue`, outcome, score 0-5, and the shared timestamps/participants. No Rescue-specific result table or saved mistake counter is added.

### 8. Acceptance Checks

1. Two ready players start with four unplaced items, the sofa at its source, score 0, and a 240-second limit.
2. Each small item can be carried by one player and placed only at its matching outline; wrong placements do not score.
3. The sofa cannot be lifted with a carried item or unless both players are nearby. The lift initiator becomes leader and both clients see the same carry state.
4. The leader moves the sofa at speed 2.4; follower movement is ignored and the follower tracks the correct 1.3-unit offset. Rotation changes the offset consistently.
5. A sofa footprint cannot cross the partition outside the doorway or leave the arena. The sofa must be horizontal to fit the doorway.
6. Only the leader may rotate or place the sofa during a carry; attempts by the follower do not change game state.
7. Disconnecting the leader promotes the connected follower and preserves the pair; reconnecting does not cause a second leader swap. Grace expiry and explicit leave cancel without a win.
8. Timeout produces a loss with the current score. Both clients observe matching item, sofa, leader, position, and score state; duplicate actions cannot place an objective twice.
9. Replay starts a clean round, and the shared result flow persists one result per session without a Rescue-specific table.

### 9. Not Included

- Online versions of Rescue practice levels 2-5, including changed delivery orders, required take-turns, or teammate spotting at every small-item outline.
- Leadership handoff during a sofa carry or simultaneous two-person steering.
- Free physics-based furniture movement, new framework hooks, new server events, or Rescue-specific result storage.
- Changes to the shared engine, lobby, room lifecycle, or other games.

### 10. References and Builder Decisions

- [Initial specification](../initial-spec.md), especially FR-06, FR-08, FR-09, AC-04-AC-07, and the disconnect policy (v0.9 on the source baseline).
- [Component contract](../component-contract.md), especially the real-time envelope, shared state fields, correction reasons, and cancellation/result rules (v0.12 on the source baseline).
- [Game framework design](2026-11-23-game-framework-design.md), especially §§5-8 (v0.3 on the source baseline).
- [Local practice rules](../plans/local-playhouse/README.md) and [Rescue rules](../../frontend/games/rules.js), as the Level 1 starting point.

The implementation plan must define the concrete TypeScript state type, paired movement checks, override handling, and test organization within the approved module interface. The frontend plan must use the authoritative `leaderId`, disable follower movement prediction while carried, and interpolate server corrections. Confirm the sofa footprint against the rendered sofa before implementation. This design does not approve changes to the shared component contract; both partners review any contract update before building against it.

## Tiny Train Team

### 1. Purpose and Scope

Define the first online Tiny Train Team round for two players on separate computers. The server owns rail placement, the train's progress, score, and outcome. This design adds the Train rules to the shared game-module framework; it does not change room admission, readiness, result persistence, or the shared wire envelope.

**Source baseline:** This design targets merged `dev` as checked on 11/24/2026: initial spec v0.9, component contract v0.12, and game framework design v0.3 ([source commit](https://github.com/RyanChen1002/Portal-Playhouse/tree/00250c289ff479c30d65da8dd42f19bc83b9a447)). Review this draft against the current spec and contract before implementation.

**Confirmed in this conversation**

- Online Train launches with one level. The existing five-level practice mode remains local.

**Proposal for online play**

- Do not require a minimum number of rail placements from each player; either player may complete any part of the route.

**Project requirements and framework**

- The first release includes five cooperative real-time games, with the server deciding outcomes.
- The game uses the approved module framework and shared results flow; game type is `tiny-train-team`.
- A two-player room starts after both players are ready. The game module receives both players in join order.
- Keep running during the 20-second reconnect grace; cancel on grace expiry or an explicit leave. Cancellations do not award wins.

The rules below are design decisions for review, not authorization to implement. The team working agreement requires partner agreement on shared product scope before implementation.

### 2. Intent and Goals

Give the team a short, readable race against a small train. Players fetch rails from the shared supply, match the route markers, and complete each segment before the train reaches it. The train must arrive at the station for a win; fitting all rails early is not enough.

The round should:

- Preserve the first practice level's straight six-piece route and timing.
- Make rail orientation, placement progress, and the train's next segment visible to both players.
- Reject invalid placements without placing a rail or changing score.
- End in a server-authoritative win or a loss as soon as the train reaches a missing segment.
- Keep all five local practice levels unchanged.

### 3. Approaches Considered

1. **Keep the fixed Level 1 route and schedule the train from round time - recommended.** The server checks each connection at its absolute deadline, while clients animate the train between those checkpoints. This preserves current rules and avoids trusting client movement or a per-frame physics simulation.
2. **Allow players to design or switch the route during the round.** This could add variety, but it changes the current fixed-route puzzle and needs route-generation and additional validation rules. It is not part of this online level.
3. **Make the train a continuously simulated server object.** This could model detailed collisions, but the practice game uses a fixed schedule and only needs the server to validate each segment. Continuous physics adds complexity without changing the outcome.

### 4. Arena and Interactions

Proposal: preserve the first practice level's room bounds, spawns, route, supply, and station layout.

| Setting | Value |
| --- | --- |
| `gameType` | `tiny-train-team` |
| Players | Exactly two |
| Round length | 120,000 ms (120 seconds) |
| Arena half-width / half-depth | 9.6 / 7.7 |
| Movement speed | 4 |
| Spawns, in join order | `(-3, 0, 6)`, `(0, 0, 6)` |
| Score range | 0-6; one point per correctly placed rail |
| Custom movement correction reasons | None |
| Disconnect settings | `{ duringGrace: 'keepRunning', onExpiry: 'cancel' }` |
| Interaction range | 1.9 units from a positioned target |

All positions are `(x, z)` with `y = 0`. The route contains six horizontal segments:

| Target | Position | Required orientation |
| --- | --- | --- |
| `rail-0` | `(-6, 0)` | Horizontal |
| `rail-1` | `(-3, 0)` | Horizontal |
| `rail-2` | `(0, 0)` | Horizontal |
| `rail-3` | `(3, 0)` | Horizontal |
| `rail-4` | `(6, 0)` | Horizontal |
| `rail-5` | `(9, 0)` | Horizontal |
| `supply` | `(-7, 6)` | Pick up one rail if hands are empty |
| `rotate-track` | No position | Rotate the held rail; no range check |

The train starts at `(-9, 0)`. The station platform is beside the final route marker, centered near `(9, -2)`, with its label at `(9, -3)`. The scene displays six numbered route markers, the rail supply rack, and the station label. No furniture-specific movement blockers are defined in the current Train rules; the engine enforces the arena bounds and movement budget.

### 5. Round Rules

- The round begins with six unplaced rails, both players with empty hands, train position `(-9, 0)`, score 0, and a 25-second preparation window.
- A player may carry one rail at a time. The supply is reusable; a player with a rail in hand must place it before fetching another.
- The route markers are all horizontal in this level. Proposal for online play: each player's carried rail has its own orientation, begins horizontal when picked up, and changes by 90 degrees on `rotate-track`. This avoids the shared orientation state used by the one-person practice controller.
- To place a rail, the interacting player must be within 1.9 units of an unfilled marker, hold a rail, and have the correct orientation. The server places that segment once, clears the player's hands, and adds one point.
- Attempting a wrong orientation is a gameplay mistake: increment `mistakes`, keep the rail in hand, leave the route and score unchanged, and update shared feedback. Do not treat it as an invalid target or award progress.
- A rail cannot be placed on an already filled segment or a segment the train has passed. A player without a rail cannot place one. These rejected actions do not change score or unrelated player state.
- The train leaves at `startedAt + 25 seconds`. It advances one route connection every 10 seconds. At each arrival deadline, the server checks that segment; if it is missing, the round immediately ends in a loss.
- The deadlines are based on round start, not tick count: first segment at `startedAt + 35 seconds`, then one per 10 seconds through the sixth segment at `startedAt + 85 seconds`. If the sixth segment is present when the train reaches the station, the round wins. A complete track before arrival does not win by itself.
- `scoreMax` is 6. The engine's 120-second limit is an upper bound; in a normally ticking round, the train resolves the game by 85 seconds.

If a tick arrives late, process every due arrival in order against the authoritative route state. A missing earlier segment still causes a loss; a delayed tick must not skip it.

### 6. State and Framework Mapping

The game module uses the shared `GameModule` interface. It does not read the system clock, generate IDs, access storage, or send network messages. Train deadlines use `RoundView.now` and the engine-provided `startedAt`.

The game-specific `game.state` fields should include:

- `railsPlaced`: six booleans, indexed by route segment.
- `players`: both player IDs, each player's held rail and its orientation (or `null`).
- `trainStep`: the index of the next segment the train must pass, from 0 to 6.
- `mistakes`: rejected wrong-orientation placement attempts.
- `score`: number of rails placed, from 0 to 6.
- `feedback`: short shared text for the next rail and the train's progress.
- Standard `startedAt`, `durationSeconds`, and `serverTime` fields from the framework.

`tick` checks all due arrivals using absolute times and returns `end: 'loss'` on a missing rail or `end: 'win'` when the train reaches the station with every segment present. `view` supplies the train step, rail states, held rail/orientation, and standard time fields to both clients. No new framework hook, event, correction reason, or error code is required.

### 7. Disconnects, Replay, and Results

- An unexpected disconnect leaves the round running during the 20-second grace. The train schedule continues.
- Proposal: if a disconnected player is holding a rail, return it to the supply and clear their held state on disconnect. This lets the connected partner fetch that rail during grace rather than making it unavailable. A reconnecting player returns at the same position with empty hands.
- Grace expiry or an explicit leave cancels the round with no win. Use the shared cancellation reason and result flow.
- Replay creates a new session and resets the six segments, both held rails, train step, mistakes, and score.
- A completed result records `gameType: tiny-train-team`, outcome, score 0-6, and the shared timestamps/participants. Mistakes are not persisted; no Train-specific result table is added.

### 8. Acceptance Checks

1. Two ready players start with six unfilled horizontal markers, empty hands, score 0, a 25-second preparation window, and a 120-second round limit.
2. Either player may fetch one rail, place it on an unfilled marker when nearby, and fetch another after a successful placement.
3. A wrong orientation increments mistakes and leaves the rail held; out-of-range, empty-handed, duplicate, or already-passed placements cannot change route state or score.
4. Each player's rail orientation is independent; rotating one player's held rail does not rotate the other player's rail.
5. The train remains at the start during preparation, then uses the fixed 10-second segment schedule based on `startedAt`.
6. Missing a segment produces a loss at its arrival deadline, even if a later segment is complete. A delayed tick cannot skip missing-segment checks.
7. Placing all rails early does not win; the train must reach the station. Reaching it with all six rails wins with score 6.
8. Disconnect keeps the train schedule running; a disconnected player's held rail returns to supply. Grace expiry and explicit leave cancel without a win.
9. Both clients see matching route, held-rail, mistake, train-step, score, and outcome state. Replay creates a clean round and the shared result flow persists one result per session.

### 9. Not Included

- Online versions of Train practice levels 2-5 or dynamically generated routes.
- Rail removal, route switching, train braking, train-speed controls, physics simulation, or penalties beyond the mistake counter.
- A required minimum number of rail placements per player.
- Persistent mistake counts, new framework events, or Train-specific result storage.
- Changes to the shared engine, lobby, room lifecycle, or other games.

### 10. References and Builder Decisions

- [Initial specification](../initial-spec.md), especially FR-06, FR-08, FR-09, AC-04-AC-07, and the disconnect policy (v0.9 on the source baseline).
- [Component contract](../component-contract.md), especially the real-time envelope, shared state fields, and cancellation/result rules (v0.12 on the source baseline).
- [Game framework design](2026-11-23-game-framework-design.md), especially §§5-8 (v0.3 on the source baseline).
- [Local practice rules](../plans/local-playhouse/README.md) and [Train rules](../../frontend/games/rules.js), as the Level 1 starting point.

The implementation plan must define the concrete TypeScript state type and test organization within the approved module interface. The frontend plan must interpolate the train from server time while showing authoritative train-step and route state. Confirm marker, rail, train, and station geometry against the current scene before implementation. This design does not approve changes to the shared component contract; both partners review any contract update before building against it.
