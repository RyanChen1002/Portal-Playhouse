# Portal Playhouse — Frontend Design and Build Roadmap

**Version:** 0.4

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.4 | 11/15/2026 | Recorded merged PR #18 and remaining frontend integration; flagged research-only Cloudflare proposal and grid versus smooth movement assumptions. Updated authorization to publish the preview for review. |
| 0.3 | 11/13/2026 | Recorded Ryan's selection of the existing 20 original characters and their avatar IDs; clarified artwork and licensing direction. |
| 0.2 | 11/12/2026 | Expanded the original local 3D preview plan (0.1) into a frontend roadmap with current draft progress, remaining work, decisions, acceptance checks, and a reusable task template. |

## 1. Purpose and how to use this plan

Build a welcoming, modern, walkable 3D playhouse where players sign in, choose a character, meet in a lobby, enter rooms, and play together. Gather is a reference for connected spaces and readable room information. Ryan selected 3D, a welcome/login-first flow, original storybook characters, and more modern furniture for the local draft.

This is a planning checklist, not a claim that the product is finished or that every visual choice is approved. The [initial spec](../initial-spec.md) owns requirements; the [component contract](../component-contract.md) owns shared interfaces. Read those plus [governance](../governance.md), [development rules](../development-rules.md), and [AGENTS.md](../../AGENTS.md) before implementing a task. The [frontend README](../../frontend/README.md) explains how to run the current draft.

- Checked items below mean implemented in the local draft only.
- Unchecked items remain work or decisions, even when related sample behavior exists.
- Record evidence before marking verification complete. Visual approval and technical verification are separate.
- Add new ideas to section 8. Changes to scope or shared interfaces need Ryan and Adam's agreement and updates to the source documents.
- Turn the next agreed milestone into small implementation tasks before coding. Do not invent detailed game tasks while the first game is TBD.

**Current authorization (11/15/2026):** organize and publish the existing preview and documentation in a review branch and PR targeting dev. No merge, deployment, or hosted database changes. Backend connection remains a separate implementation task.


### Character roster

Ryan selected these existing local-preview characters on 11/13/2026. They are original procedural 3D models built in [world.js](../../frontend/world.js), with portraits rendered from the same models. Keep their existing avatar IDs when connecting profiles to the backend. Final production polish and verification remain separate tasks.

| Avatar ID | Character |
| --- | --- |
| avatar-01 | Ember Fox |
| avatar-02 | Cloud Scout |
| avatar-03 | Violet Mage |
| avatar-04 | Fern Keeper |
| avatar-05 | Rose Ranger |
| avatar-06 | River Sprite |
| avatar-07 | Acorn Knight |
| avatar-08 | Moon Explorer |
| avatar-09 | Sunbeam Cub |
| avatar-10 | Berry Bard |
| avatar-11 | Copper Fox |
| avatar-12 | Frost Scout |
| avatar-13 | Twilight Mage |
| avatar-14 | Moss Keeper |
| avatar-15 | Peach Ranger |
| avatar-16 | Lagoon Sprite |
| avatar-17 | Oak Knight |
| avatar-18 | Star Explorer |
| avatar-19 | Honey Cub |
| avatar-20 | Plum Bard |

Use original character designs, names, clothing, and accessories. Any future third-party assets must have documented permission and required notices. Keep the bundled Three.js license.

## 2. Current draft and its limits

| Area | What exists locally | What is still missing |
| --- | --- | --- |
| Welcome | Welcome page, fake login, demo entry | Real registration, authentication, session recovery |
| Characters | 20 procedural 3D choices, matching portraits, walking and idle animation | Final artwork review, persistent selection, complete identity/nameplate synchronization |
| World | Furnished 3D map, perspective follow camera, zoom, keyboard movement | Final map, exhaustive collision/camera testing, performance targets |
| Rooms | Sample room boards in the scene, detail panel, entry/return, ready toggle | Real membership, synchronized readiness, live board updates |
| Results | Empty history view | Played games, saved results, real win totals |
| Services | Local HTTP preview and vendored Three.js | Shared-client integration, multiplayer transport, Vercel configuration |

Browser checks already performed during development: welcome-to-world flow; 20 unique loaded character portraits; selection reflected in profile portrait; keyboard movement changes position; sample room admission/return changes location; locked/full requests retain prior membership; local asset requests succeed. JavaScript syntax and editor diagnostics were checked. These are ad hoc local checks, not a maintained regression suite or proof of AC-01 through AC-08.

Still unverified comprehensively: diagonal speed, every collision boundary, all doorways, keyboard-only navigation, focus-loss behavior, reduced motion, WebGL failure/recovery, GPU resource cleanup, multiple browsers, and actual multiplayer capacity.

## 3. Decisions to fill in

| Decision | Current direction | Who decides / what to record |
| --- | --- | --- |
| Visual direction | Modern, warm 3D spaces; original characters; Gather-inspired layout | Ryan: approved screenshots and remaining changes |
| Camera and movement | Follow camera, zoom, WASD/arrows, E near entrances in draft | Ryan; coordinate world axes, bounds, and movement messages with Adam |
| Room layout | Three sample room instances, one first game TBD | Both: actual room count, names, capacity configuration, entry behavior |
| First mini-game | TBD; exactly two cooperative players | Both: rules, controls, scoring, win/loss, replay |
| Production frontend structure | Plain JS/HTML and Three.js in draft | Both: framework/build setup and shared TypeScript-client integration |
| Authentication | Backend design selects email/password | Merged through PR #18; connect frontend screens through the shared client |
| Disconnects | Cancellation behavior is proposed in the spec | Both: grace period, slot retention, reconnect and retry behavior |
| Device/performance targets | Desktop keyboard first | Both: supported browsers, minimum test hardware, measurable performance goals |
| Timeline and handoff | Dates and midpoint swap features TBD | Both: milestone dates, swap tasks, class-access deadline |

## 4. Work in recommended order

### A. Finish and review the visual design — Ryan

**Covers:** FR-02, FR-05, FR-11. Work mainly in [world.js](../../frontend/world.js), [world.css](../../frontend/world.css), and [styles.css](../../frontend/styles.css).

- [x] Build a 3D map with modern seating, workstations, plants, materials, and lighting.
- [x] Put room status information inside the world; retain a separate accessible board view.
- [x] Build 20 character models and portraits using original artwork.
- [ ] Review welcome, character selection, lobby, room interior, profile, and history screenshots together.
- [ ] Agree on typography, colors, spacing, button styles, error styles, and room-status colors.
- [ ] Refine room proportions, signage, clear walkways, and furniture placement without adding clutter.
- [ ] Make character names and avatar appearance consistent in the picker, profile, world, and nameplates after edits.
- [ ] Decide whether current procedural art is sufficient or selected models need replacement; record source/license for any third-party asset.
- [ ] Check readability at normal laptop resolution, browser zoom, and both camera zoom limits.

**Done when:** Ryan accepts the screens and map, room signs are readable, and artwork choices and remaining limitations are recorded. Visual approval does not prove backend behavior.

### B. Stabilize the local world and controls — Ryan

**Covers:** FR-04, FR-10, FR-11; local preparation for AC-02 and AC-07.

- [x] Add keyboard movement, animated walking, camera follow, and zoom.
- [x] Add local collision checks and room admission/return behavior.
- [ ] Test walls, corners, furniture, and every doorway; fix clipped or blocked walking routes.
- [ ] Confirm diagonal speed equals straight-line speed and movement is consistent across frame rates.
- [ ] Confirm typing in forms, using menus, switching tabs, and losing focus never leaves movement running.
- [ ] Review entry/exit feedback: one action enters once; rejected admission never moves the player.
- [ ] Ensure camera tracking and zoom keep the avatar and interaction prompt visible without showing through walls.
- [ ] Add a clear loading state and usable WebGL-unavailable/context-loss state.
- [ ] Verify reduced-motion behavior and remove unnecessary animation when the page or world is hidden.
- [ ] Dispose replaced geometry, textures, materials, listeners, and subscriptions appropriately; check repeated avatar changes do not grow GPU memory indefinitely.

**Done when:** a recorded local test route covers every room and obstacle, invalid actions preserve state, and controls recover after focus changes.

### C. Prepare maintainable frontend boundaries — Ryan, shared decisions with Adam

**Covers:** FR-12 and contract sections 4 and 8. The current prototype is not the agreed shared-client mock.

- [ ] Agree the production build/package structure before adopting a framework or moving to TypeScript.
- [ ] Separate scene rendering, characters, furniture, movement, account UI, room UI, and data adapters into focused modules.
- [ ] Replace DOM-derived room state and display-name membership keys with typed state and stable player IDs.
- [ ] Define one source of truth for membership, current location, readiness, and profile; render both signs and panels from it.
- [ ] Keep mock and real data behind agreed interfaces. Do not let the renderer query Supabase tables.
- [ ] Add repeatable tests for meaningful behavior: failed joins, profile validation, session changes, and movement boundaries.
- [ ] Keep dependency versions and licenses recorded; review asset size and loading strategy.

**Done when:** scene/UI code can switch from the agreed mock to the real client without duplicating rules or changing the contract.

### Backend handoff on 11/15/2026

PR #18 is merged and synced locally. Account/profile client, mocks, migrations, and tests now exist. Frontend integration is not complete. Use Node 22, shared client errors, persistent browser storage, and a stable session key. PR #19 is research only: Cloudflare has not been selected. Its grid-step movement assumptions must be compared with this preview's smooth 3D controls before choosing a transport.

### D. Implement real account and profile screens — Ryan with Adam's client

**Covers:** FR-01, FR-02, AC-01; [backend design](../specs/2026-11-11-backend-foundation-auth-profiles-design.md).

- [ ] Build registration with email, password, and display name; follow the agreed first-release auth scope.
- [ ] Wire sign-up, sign-in, sign-out, session loading, and session changes through PortalClient.
- [ ] Replace demo-only entry in the release flow; keep demo mode explicitly separate if the team chooses to retain it.
- [ ] Use shared display-name validation and exactly the shared 20 avatar IDs.
- [ ] Show loading, duplicate-submit prevention, invalid credentials, taken names, weak passwords, rate limits, and unavailable-service states.
- [ ] Attach field errors accessibly; keep invalid-credentials errors general.
- [ ] Handle generated fallback names from sign-up and allow the player to change them.
- [ ] Save profile changes through updateMe; show pending/success/failure without claiming failed saves succeeded.
- [ ] Clear sensitive/session state at sign-out; never persist passwords or expose service-role keys.

**Done when:** two separate accounts can sign out and back in with their own saved profiles, and invalid/failed changes leave stored data unchanged. Run against the agreed local backend first; hosted access needs authorization.

### E. Connect multiplayer lobby and room board — Ryan and Adam

**Covers:** FR-03 through FR-07, FR-10; AC-02, AC-03, AC-04, AC-07. Blocked on agreed transport/runtime and message schemas.

- [ ] Agree movement inputs, world coordinates, update cadence, snapshots, request acknowledgement, and revision handling.
- [ ] Show real joins, movement, departures, display names, and avatars for other players.
- [ ] Apply server-authoritative room admission before relocating the local avatar.
- [ ] Keep all room signs and the accessible board synchronized with participants, capacities, score, timing, and status.
- [ ] Add connection-lost, reconnecting, session-expired, world-full, room-full, and room-locked UI.
- [ ] Restore from authoritative snapshots after gaps and ignore stale updates.
- [ ] Show both players' readiness and only enter gameplay when the backend confirms the start.
- [ ] Verify the 16-player whole-world limit, including a rejected 17th admission; moving rooms must not take an extra world slot.
- [ ] Verify no private emails, tokens, or history appear on public room boards.

**Done when:** two browser sessions agree on movement/membership/board state, then 3+ and full-capacity scenarios pass. A sample population counter is not capacity verification.

### F. Build the first mini-game UI — after joint game selection

**Covers:** FR-06 through FR-10; AC-04, AC-05, AC-07. Do not invent a game from the furniture or sample board score.

- [ ] Record the chosen game's rules, legal actions, controls, scoring, win/loss conditions, and replay behavior in the spec/contract.
- [ ] Create a game-specific design and implementation plan linked to that decision.
- [ ] Design instructions, waiting-for-partner, ready, playing, finished, and cancelled states.
- [ ] Render game state and send permitted actions through the agreed adapter; backend decides outcomes.
- [ ] Show partner departure/disconnection according to the agreed policy.
- [ ] Add replay and return-to-lobby actions; a new round resets readiness and uses a new session.
- [ ] Verify an outsider cannot join an active round or access an in-room spectator view.

**Done when:** two real participants complete agreed winning and losing scenarios and see matching outcomes. The frontend never assigns authoritative scores or wins.

### G. Build saved results and history — Ryan with Adam's results service

**Covers:** FR-09, AC-06, AC-07.

- [ ] Design result summaries and history rows using agreed game-specific score meaning.
- [ ] Show personal history and total wins from trusted records, with empty/loading/error states.
- [ ] Handle pagination if required by the agreed results interface.
- [ ] Display pending, saved, and failed persistence distinctly; avoid duplicate result rows after retries.
- [ ] Ensure cancelled sessions follow the agreed outcome rules and do not incorrectly add a win.
- [ ] Verify users see only permitted personal results after sign-out/sign-in.

**Done when:** results survive a new session, duplicate completion does not duplicate history/wins, and failed saves remain visibly pending or failed.

### H. Accessibility, performance, and release preparation — both

**Covers:** FR-10 through FR-12 and AC-08. Can be refined throughout earlier milestones.

- [ ] Test keyboard-only welcome, selection, room board, dialogs, and profile flows; restore focus after closing overlays.
- [ ] Test labels, errors, contrast, reduced motion, readable canvas signs, and alternatives to canvas-only actions.
- [ ] Test agreed desktop browsers, resizing, browser zoom, and long display names.
- [ ] Measure frame rate, draw calls, memory, and asset loading on agreed hardware; set targets jointly and record results.
- [ ] Reduce unnecessary geometry/material duplication, inactive rendering, texture work, and shadow cost based on measurements.
- [ ] Confirm no secrets, real test passwords, or personal data enter the frontend bundle or Git.
- [ ] Prepare distinct Vercel dev/main project settings and matching Supabase environment values; validate separation before deployment.
- [ ] Prepare setup instructions, deployment checklist, and a human-readable PR summary once publishing is authorized.
- [ ] Obtain teammate review through the agreed task PR to dev and separate release PR to main. Deployment remains separately authorized.
- [ ] Schedule midpoint component swap work and class access 1–2 weeks before presentation once actual course dates are known.

**Done when:** agreed functional/accessibility/performance checks are recorded, review is complete, and deployment is explicitly authorized. This document grants no publishing permission.

## 5. Suggested next work session

1. Review the current appearance and fill in the visual decisions in section 3.
2. Complete B's collision, camera, focus, and room-transition checks before adding more decoration.
3. Agree the frontend/shared-client structure with Adam, then implement C and D.
4. Choose the first game and multiplayer approach together before E and F depend on them.

The order is a proposal, not a deadline or a promise that every milestone is unblocked.

## 6. Verification record

Use actual observations; leave unknowns blank. A screenshot verifies appearance, not multiplayer correctness.

| Date | Task / scenario | Environment | Result and evidence | Remaining issue |
| --- | --- | --- | --- | --- |
| 11/12/2026 | Local preview smoke checks | Local browser, sample data | Welcome flow, 20 portraits, selection, movement, room entry/exit, rejection, and asset loading checked during development; see section 2 for limits | Full regression, accessibility, performance, and backend integration not yet verified |

## 7. Reusable task template

Copy this block when adding an agreed task:

```markdown
### UI-XX — Short task name

- Owner: Ryan / Adam / both
- Stage: Idea / Ready / In progress / Needs review / Done
- Requirement: FR-XX / AC-XX or link to approved design
- User goal: What the player should be able to do
- Screen or world area:
- Design reference or sketch:
- Files/components affected:
- Depends on:
- Shared contract changes: None / describe and obtain agreement
- [ ] Agree on design and scope
- [ ] Implement normal, loading, empty, and error states as applicable
- [ ] Verify behavior and relevant accessibility
- [ ] Record evidence and remaining limitations
- [ ] Obtain human review
- Acceptance checks: Observable results, including invalid actions
- Evidence: Commands/results, screenshots, or later PR link
- Open questions:
```

## 8. Ideas and changes for later

| Idea | Why it helps the player | Required now or later? | Decision / next step |
| --- | --- | --- | --- |
| Add your next UI idea here | Describe the player benefit | Undecided | Discuss before implementation |

Voice/video, extra games, public matchmaking, complex avatar customization, world editing, and in-room spectators remain outside the current first-release scope. Use the [future-features list](../future-features.md) for deferred product features; this roadmap does not bring them into scope.
