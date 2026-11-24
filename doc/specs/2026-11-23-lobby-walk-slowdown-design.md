# Lobby Walk Slowdown — Design

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/23/2026 | Initial diagnosis and proposed fix for the slower lobby walking seen when two online players move at once. The diagnosis is not yet confirmed in a browser. |

**Status:** Proposed. The cause below comes from reading the code and has not been measured yet. Steps 1–3 under **Confirm the cause** must be done before the fix is planned. **Owner of the affected code:** Ryan (`frontend/world.js`). **Raised by:** Adam. **Related:** [runtime design](2026-11-17-runtime-transport-design.md) §5.4 (movement), [load-check design](2026-11-21-load-check-design.md).

## Symptom

During a two-player test on hosted dev, Adam's own character walked noticeably slower in the lobby while both players were moving. His character never snapped back. The other player's character looked slightly jumpy.

## What it is not: server rejections

We first suspected that the server was rejecting moves (`player.corrected`) because the lobby speed limit (4.8) equals the client's walk speed. The code rules that out for normal play:

- **The server's limit has headroom.** The movement allowance refills at 1.25 × 4.8 = 6.0 units per second and can save up 4.8 + 0.5 = 5.3 units, about one second of walking (`shared/world/movement.ts`, `shared/world/config.ts`). The client can never move faster than 4.8 units per second, because each frame's step is capped (see below). A rejection would need the network to hold moves for more than about a second and then deliver them all at once.
- **A rejection would snap the character back.** `player.corrected` calls `emit(true)` (`frontend/live.js`), and the lobby then resets the hero to the server's position (`frontend/world.js` line 29). No snapping was seen.
- **The 20-moves-per-second server cap doesn't slow walking.** The hero's position is kept locally, so a dropped move only makes the next move longer, which the allowance covers.

## Likely cause: lower frame rate combined with the frame-step cap

1. **Every update from the other player redraws all five room signs.** Each `player.updated` message the client receives runs `emit()`, which dispatches `playhouse-online-state`. The lobby's listener calls `drawBoards()` every time (`frontend/world.js` line 34). That redraws five 768×440 canvases and marks five textures for GPU re-upload (`needsUpdate`). Each event also makes a full `structuredClone` of the world snapshot (`connection.snapshot()`).
   - The server doesn't send your own moves back to you, so walking alone causes none of this.
   - With another player moving, updates arrive up to 20 times per second: about 100 canvas redraws and texture uploads per second.
2. **Walking slows down when frames get long.** The frame loop caps the time step at 40 ms: `dt = Math.min((now - last) / 1000, .04)` (`frontend/world.js` line 170). The hero moves `dt × 4.8` per frame, so at 15 fps (66 ms frames) it moves 40/66 of normal speed, about 2.9 units per second. This slows the walk without any snap-back, as observed.
3. **The same cause explains the jumpy peer.** Peer smoothing (`frontend/world.js` line 173) uses the same capped step and runs in long, uneven frames.

## Confirm the cause

1. **No corrections:** in the browser's DevTools, open Network, select the WebSocket, then Messages. While both players walk, check that no `player.corrected` messages appear.
2. **Long frames:** record a few seconds with the DevTools Performance tab while the other player walks. Look for frames over 40 ms, with time spent in `drawBoards` or texture uploads.
3. **Isolate the redraw:** temporarily remove the `drawBoards();` call at the end of the `playhouse-online-state` listener (`frontend/world.js` line 34) and repeat the test. If the slowdown disappears, the cause is confirmed.

**Moving test player:** instead of a second person, Adam can run two bots walking in the lobby on hosted dev with the existing load check: `npx tsx --env-file=.env.development.local scripts/load-check.ts --hosted --scenario baseline --duration 600`. This also shows that the server isn't rejecting moves (the report counts `player.corrected`).

## Proposed fix

Both changes are in `frontend/world.js`. No change is needed in the shared client, the shared contract, or the runtime.

1. **Redraw signs only when their content changes (main fix).** In the `playhouse-online-state` listener, compute a small key from what `drawBoards()` actually shows from the snapshot: the Portal board entry's status and player count. Call `drawBoards()` only when that key differs from the last one drawn, and always when the connection state changes or the player goes offline. Changes to `lockedExample` or `activeGameId` already call `drawBoards()` themselves and stay as they are.
2. **Base walking on real elapsed time (optional, follows the main fix).** Raise the frame-step cap from 40 ms to about 100 ms, so a slower computer walks at normal speed instead of slowing down. The cap still guards against the huge step after a hidden tab resumes.
   - **Server:** this fits the server's allowance. Moves are still sent at most 20 times per second, and walking stays at 4.8 units per second.
   - **Risk to check:** `canMove` checks only the destination, so a step of up to 0.48 units could cut through a thin obstacle corner. Check obstacle thicknesses before choosing the cap.

### Considered and not proposed

- **Making the speed a shared setting between client and server.** The diagnosis doesn't point to the speed limit, so this would change a shared contract without fixing the symptom.
- **Reducing `structuredClone` in `snapshot()`.** It is a shared-client cost and smaller than the canvas work. Revisit only if the measurements in step 2 show it matters after the main fix.

## Verification for the fix

- **Two-player test** on hosted dev, or one player plus the load-check bots: walking speed is the same with and without another player moving, and Performance recordings show no regular frames over 40 ms from sign redraws.
- **Signs still update:** the Portal sign changes when someone joins or leaves the room and when a round starts or ends.
- **Offline practice:** signs and walking are unchanged.
- **Existing checks pass:** `npm run test:frontend`.

## Open questions for Ryan

- Do you agree with the diagnosis? Should we run checks 1–3 together, or will you run them?
- Should change 2 (the higher frame-step cap) be part of this fix or come separately?
- Who implements: Ryan, or Adam with your review, since this is frontend code?
