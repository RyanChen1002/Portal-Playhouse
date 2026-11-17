# Local Playhouse: games and courtyard

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.3 | 11/16/2026 | Completed local games and checks (0.2); added five direct-entry rooms, then redesigned them around a furnished courtyard. Fixed dismiss/escape controls and consolidated the two local plans here. |
| 0.1 | 11/15/2026 | Defined local-only playable versions of the five proposed games, controls, backend boundaries, and verification tasks. |

## Scope and design

Requested by Ryan: implement all five ideas locally, retain the original 3D characters and modern lobby style, show clear instructions, test the games, and wait for approval before any branch creation or publication. Design choices are delegated to the implementer. This is a prototype expansion, not joint approval of five production games.

Sources: [game ideas](../../mini-game-ideas.md), [spec](../../initial-spec.md), [contract](../../component-contract.md), [governance](../../governance.md).

### Approach

Reuse the bundled Three.js renderer and character models. Keep deterministic game rules separate from rendering, behind a local session interface. This allows meaningful tests now and replacement with an authoritative runtime later. A new engine adds unnecessary dependencies; connecting games directly to Supabase is inappropriate because no game-session or result interface exists yet.

Implementer default pending user feedback: one tester controls both teammates, switching with Q. The inactive teammate stays put and can hold a pressure plate. No bot is presented as a real player. WASD/arrows move, E interacts nearby, R rotates carried furniture/track, and explicit buttons pause, switch, restart, and leave. Rules are readable at the doorway. Press K to start immediately; pause/help is available inside. Losing focus pauses play. Return cancels unfinished rounds without a win. Results remain in memory and say not saved online; reload clears them. No database writes, fake rewards, or new credentials.

### Game rules for local testing

- **Portal Partners:** 180 seconds. Hold the west plate with one teammate, cross the bridge with the other, and operate the far lever to latch the bridge open. Collect two crystals, then bring both teammates to the exit. The gap blocks movement until the bridge is open; crossing off the bridge is blocked.
- **Playhouse Cafe:** 180 seconds. Prepare and serve four alternating salad/soup orders. Collect the matching raw ingredient, prepare it at the chopping board or stove, and serve only the requested prepared dish. Carrying and preparation progress are visible. Wrong servings count as mistakes, not completed orders.
- **Room Rescue:** 240 seconds. Carry four small furnishings to matching outlines and move one sofa through the partition doorway. Both teammates must be nearby to lift the sofa. In sofa-carry mode they move as a pair; rotate to fit the opening. Collisions consider carried furniture dimensions. Wrong placement does not complete an objective.
- **Tiny Train Team:** 120 seconds. Carry rails from the supply rack and place six correctly oriented pieces along a marked fixed route. The train starts after a 25-second preparation window and travels one connection every 10 seconds. It stops with a loss at a missing/wrong connection. Victory occurs only at the station, not when rails are merely placed.
- **Power-Up Workshop:** 180 seconds. Rotate three numbered gears to the visible target 1/2/3; connect three color-and-symbol matched sockets; leave one teammate holding the left power station and use the other to activate the right. Final switches cannot complete an unfinished repair.

All five open in a dedicated full-size 3D view with a live objective list, two teammate indicators, timer, interaction prompt, instructions, and real completion summary. Reuse warm materials, original models, and legible labels. Motion shows actual actions: walking, carried objects, extending bridge, preparation progress, rotating wheels/gears, and powered portal. Reduced-motion preference limits decorative effects.

### Backend boundary

Current PortalClient supports Auth and profiles only. No result persistence or networked game state is assumed. Later work needs joint agreement on per-game commands, validation, sessions, result tables, reconnect/cancellation, and win aggregation. Preserve existing backend interfaces and migrations.

## Implementation plan

Use Superpowers executing-plans inline. No commits, branches, worktrees, or deployment for this task.

- [x] Add pure game-session rules and meaningful tests for legal/invalid actions, timers, cancellation, restart isolation, and actual win conditions for all five games.
- [x] Extract the existing character factory into a shared visual module without changing the roster; create a reusable game renderer and original furnishings for each scene.
- [x] Add the game chooser, instructions, controls, pause/results panels, local result history, and room entry link. Pause lobby rendering while a game is open.
- [x] Replace local-machine wording with practice wording while retaining truthful account/multiplayer/save disclosures.
- [x] Serve the added assets through the existing loopback server, using the same port and no extra service.
- [x] Run rule tests, existing backend tests, syntax checks, browser win/loss/restart checks, and inspect screenshots. Record actual limitations.

## Verification and remaining work

Local checks on 11/16/2026: 11 game-rule tests and 99 existing backend unit tests passed; TypeScript checking passed. Browser keyboard sequences reached earned wins in all five games. Missing track caused a train loss. Pause, window-focus loss, restart, and return to the lobby passed without browser errors.

These are local practice prototypes with one tester switching two roles. The simple fixed train route and room puzzles still need user playtesting, difficulty tuning, and visual review. No live teammate, server-authoritative game state, reconnect handling, or saved results are implemented. Supabase game tables and the multiplayer runtime require agreement with the backend owner. No branch, commit, push, or deployment is authorized by this plan.

## Review focus

Invalid interactions cannot award progress. Finished/cancelled sessions cannot advance. Restart creates independent state. Focus changes clear held keys and pause time. A carried sofa cannot clip through a wall. Leaving a game releases graphics/input resources and restores the lobby. No result is represented as saved to Supabase.

## Courtyard design and current tasks

The user requested a connected circular arrangement instead of a long street. Five inward-facing rooms surround a shared circular lounge. Each uses its game color for the floor/rug and has original furniture, plants, shelves, window details, and game-specific props. The existing Three.js renderer is retained, with rotated furniture collision bounds and unobstructed radial paths.

The street layout was replaced because it required long walks. A central courtyard was chosen over a maze of connected corridors because every room is visible from the center and entrances are close together. These are local prototypes, not a change to the agreed first production-game scope.

- Rules appear near the matching world board. X or Escape dismisses them; H reopens them. Dismissal lasts until you leave that doorway.
- K starts the nearby game directly. Locked doors reject entry. All five start open, with a switch for one locked example.
- Escape during play returns to the courtyard. Escape from pause/help resumes play. An explicit Close game button is available in play and pause views. Leaving cancels unfinished practice rounds without awarding a win.
- Returning keeps the lobby position and restores movement focus.
- Remove unused chooser code/styles and duplicate plans; preserve the 11/15 and 11/16 history here.

Courtyard verification on 11/16/2026: all five walking routes, board dismissal with Escape and X, H reopening, K entry, Escape exit, return position, pause resume, close buttons, and locked/unlocked entry passed browser checks with no page errors. All 13 game/doorway tests passed; syntax and editor checks passed. Screenshots were inspected. Shared database and multiplayer behavior remain unimplemented and untested by these local checks.

Publication: files remain local. After user approval, prepare a task PR into dev. Vercel should serve the same frontend directory when the reviewed changes reach dev; no build tool or backend dependency is added. Do not claim the live site has changed before that deployment is verified.
