# Portal Playhouse - Five 3D Mini-Game Ideas

**Version:** 0.2

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.2 | 11/15/2026 | Prepared the proposals for sharing in the frontend review branch; no game selected. |
| 0.1 | 11/14/2026 | Added five game proposals, visual references, and Ryan's direction for dedicated 3D game views and earned results. |

## What we already agreed on

The [initial spec](initial-spec.md) mentions colored-tile gameplay as an idea, but the first game is still TBD. It calls for one two-player cooperative game, original characters, room availability, and saved results. The [contract](component-contract.md) gives the backend control over game outcomes. The [frontend roadmap](plans/2026-11-12-local-3d-preview.md) leaves game design open; [future features](future-features.md) defers extra games and voice/video.

Ryan's direction on 11/14/2026: mini-games must use real 3D models and convincing game animation, open in their own game UI, and give results that feel earned. These five options are proposals to review with Adam, not five games committed for the first release.

## How a game opens

Walk into a room -> both players ready -> open a dedicated 3D game view -> play -> see the actual result -> replay or return to the lobby.

Suggested presentation: a full-size game view inside the website, with its own camera, instructions, timer, and small controls overlay. A separate browser window is not assumed. Keep the selected characters. Pause rendering the lobby while playing; closing the view must follow the agreed leave/cancellation rules.

## 1. Portal Partners - my first choice

**Play:** Explore a small 3D puzzle room together. One player holds a pressure plate while the other crosses a moving bridge and opens a shortcut. Swap roles, collect two crystals, then reach the exit together. Color and symbol markings make the switches readable.

**Look and movement:** Characters press plates with their feet, pull levers, carry crystals, and walk across bridges that visibly extend. Use a polished overhead camera, soft shadows, and a clear view of both players.

**Earned result:** Win only when both players reach the unlocked exit. Record completion time; a visible round timer can provide the loss condition. Exact limits need agreement.

**First version:** One room and three connected puzzles. Lower relative complexity than the action-heavy options, though multiplayer still needs testing.

**See the style:** [Captain Toad official gameplay trailer](https://www.youtube.com/watch?v=9mNWNYelWq0). Watch the compact 3D environments and moving obstacles. Our two-player switch puzzle would be an original design.

## 2. Playhouse Cafe

**Play:** One player prepares ingredients while the other assembles and serves orders. Players can swap jobs. Complete a small order target before the round ends.

**Look and movement:** A modern 3D cafe with animated chopping, pouring, carrying, steam, and food visibly appearing on plates. Objects stay attached to the character's hands while carried.

**Earned result:** Count correctly served orders, not button presses. Show completed orders and mistakes at the end.

**First version:** One kitchen, two recipes, no fire or complicated ingredient physics. Medium-to-high complexity because actions and held items must stay synchronized.

**Visual reference:** [Overcooked! All You Can Eat - official game page](https://www.team17.com/games/overcooked-all-you-can-eat). Look at the kitchen layout, readable tasks, and character actions.

## 3. Room Rescue

**Play:** Restore a messy lounge together. Carry small objects individually, but lift a sofa together and turn it through a doorway. Put every item in its marked location before time runs out.

**Look and movement:** Reuse our modern furniture style. Characters lean into a lift, hold opposite ends, and lower objects onto the floor. Furniture has real volume and cannot pass through walls.

**Earned result:** Success means every required object is actually placed correctly. Show placement count and completion time.

**First version:** Four items and one shared sofa. High complexity: two-player carrying, collision, and animation must agree. Constrained carrying is more manageable than unrestricted physics.

**Visual reference:** [Moving Out - official game page and trailer](https://www.team17.com/games/moving-out). Focus on teamwork around large 3D furniture.

## 4. Tiny Train Team

**Play:** Work together to lay a short railway before a slow train reaches the unfinished section. One player brings track pieces while the other places and turns them; either can switch jobs.

**Look and movement:** A miniature 3D garden, tracks snapping into place, animated wheel rotation, and characters visibly carrying pieces.

**Earned result:** Win when the train reaches the station; lose if it reaches a missing connection. Show distance completed and remaining time.

**First version:** One fixed map and a limited set of track pieces. Medium-to-high complexity because the moving train and track placement must stay synchronized.

**Visual reference:** [Unrailed 2 - official website](https://unrailed-game.com/). Look at the shared building task and readable 3D environment; our version would be a short fixed challenge.

## 5. Power-Up Workshop

**Play:** Repair a 3D portal machine together. Each player operates a different station: rotate marked gears, connect matching sockets, and activate the final pair of switches. Both stations show the shared target, so voice chat is not required.

**Look and movement:** A close camera on solid machine parts, animated hands, turning gears, fitted cables, and a portal that powers up only after correct actions.

**Earned result:** Complete all repair steps before the timer ends. Record solved steps, mistakes, and completion time.

**First version:** Three mechanisms in one room. Medium complexity; needs satisfying object interaction but less movement synchronization than the cafe.

**Visual reference:** [Keep Talking and Nobody Explodes - official screenshots and gameplay](https://keeptalkinggame.com/). Use its physical control-panel presentation as inspiration. Our shared-target puzzle would not depend on its hidden manual or verbal communication.

## What makes the reward real?

Use the actual shared result: completed objectives, time, and a saved win. Animate the solved room or machine because players succeeded. Show saving, saved, or failed honestly; never announce a saved reward before confirmation. No invented coins, random scores, or automatic victory after a demo animation. Extra currencies, unlocks, and trophies would need a separate team decision.

All options need solid models, believable contact with objects, smooth action transitions, sound tied to actions, and consistent state for both players. References illustrate a quality direction, not a promise to match a commercial game's scope. Use our own characters, layouts, and assets.

**Recommendation:** Start with Portal Partners. Choose Power-Up Workshop if you prefer detailed close-up interactions. Pick one with Adam, then agree on the round length, controls, win/loss rules, disconnect behavior, and reward calculation before implementation.

Reference pages checked on 11/14/2026. These are brainstorming proposals shared for review, not selected games or authorization to implement them.
