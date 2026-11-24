# Portal Playhouse — Initial Specification

**Version:** 0.9

**Date:** 11/23/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.9 | 11/23/2026 | Ryan approved the game framework design: FR-09 and AC-06 now use one shared results table; the §8 blocker for the other four games' designs now asks for a score range instead of a result table. Earlier the same day (0.8): frontend approach confirmed by Ryan: static ES modules, with esbuild bundling the shared client; no frontend framework (FR-12); removed it from the §8 blockers. |
| 0.7 | 11/22/2026 | **Scope change:** the first release now includes all five games (Portal Partners, Playhouse Cafe, Room Rescue, Tiny Train Team, Power-Up Workshop), each playable in real time by two players, instead of one game. Updated §1, FR-06, FR-08, FR-09, AC-03 to AC-06, §4, and §8, and listed the four new game designs as blockers. Removed "pending Ryan's approval" from the runtime wording, because the runtime design merged in PR #22. Shortened §7 to the chosen architecture, linking the research for the options compared. Defined real-time (server) play and offline practice. The disconnect policy is no longer marked Proposed, because the runtime design adopted it (PR #22). Recorded in §8 that the hosted two-account Portal Partners test passed on 11/22/2026. |
| 0.6 | 11/18/2026 | AC-05 now points to the Portal Partners winning and losing sequences in the [runtime design](specs/2026-11-17-runtime-transport-design.md) §6 and §10, replacing "once the first game is chosen". No other requirements changed. |
| 0.5 | 11/17/2026 | Pointers to the [runtime design](specs/2026-11-17-runtime-transport-design.md) (proposed by Adam; tentative until Ryan approves the pull request): the tentative runtime choice in FR-12, §7, and §8; removed "reconnect slot retention" and "disconnect timing" from the blockers; Portal Partners named as the first networked game. No other requirements changed. |
| 0.4 | 11/15/2026 | Aligned authentication wording with merged PR #18. First game and multiplayer runtime remain open. |
| 0.3 | 11/13/2026 | Replaced the previous character-style reference with the original local-preview roster selected by Ryan. Kept 20 avatar choices. |
| 0.2 | 11/11/2026 | Standardized history dates and columns; removed approval status fields and updated the document version. Requirements unchanged. |
| 0.1 | 11/08/2026 | Initial spec from updated meeting notes, including PR #2 review clarifications |

## 1. Purpose and Decisions

A browser-based 3D world where friends and classmates meet and play mini-games. Initial scope: accounts, a saved profile, a shared lobby, a room board, five two-player cooperative games in real-time (server) play, and persistent results.

**First-release games** ([game ideas](mini-game-ideas.md)): Portal Partners, Playhouse Cafe, Room Rescue, Tiny Train Team, and Power-Up Workshop.

**Real-time (server) play:** two players on separate computers, each controlling their own character, with the server deciding the outcome. **Offline practice:** the frontend-only versions, where one person controls both teammates and nothing is saved.

Source: Ryan's updated meeting notes and November 8 clarification. **Confirmed direction:** Supabase Auth/database, Vercel frontend hosting, a Cloudflare Worker plus one World Durable Object as the authoritative runtime ([runtime design](specs/2026-11-17-runtime-transport-design.md)), separate dev/production environments, 20 avatar choices, an initial 16-player limit across the whole world (lobby and all game rooms), and Superpowers workflow. Colored-tile gameplay is an idea only.

The [component contract](component-contract.md) owns interfaces. This spec owns product requirements. Ryan and Adam approved this initial spec, including the PR #2 review clarifications. Proposed defaults below still need explicit agreement.

## 2. Player Journey

Register or sign in, load a profile, choose an avatar, enter the 3D lobby, check room availability, and move into an available game room. Both players mark ready. The round starts and locks participation; others can still see its score on the board. Finish or fail the game, see the result, then replay or return to the lobby. Profile, history, and wins remain available on a later login.

## 3. Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | Supabase Auth manages accounts and sessions. The merged account milestone uses email/password with email confirmation off; password reset and OAuth are outside this milestone. |
| FR-02 | Persist display name and avatar selection; offer exactly 20 options. Use the 20 original procedural 3D storybook characters from the local preview, selected by Ryan on 11/13/2026. The [character roster](plans/2026-11-12-local-3d-preview.md#character-roster) maps names to avatar IDs. Use original designs rather than recognizable franchise characters. |
| FR-03 | Start with a maximum of 16 players total across the lobby and all game rooms. Moving between rooms does not consume another slot. Revisit capacity after performance testing. |
| FR-04 | Show players joining, moving, and leaving the same space. Integrate two users first, then verify 3+ users and the full capacity. |
| FR-05 | Board shows room availability, configured minimum/maximum players, participant display names, current score, and timing for every game room. **Proposed:** elapsed time from authoritative round start; remaining time only for timed games. |
| FR-06 | Each game has configurable minimum/maximum players. Portal Partners requires exactly two players; **proposed:** the other four games do too, as their offline practice versions do. Other game sizes are future extensions. |
| FR-07 | Start when both required players are ready. Lock participation while playing; other authenticated users may read board score/status, but in-room spectator mode is deferred. |
| FR-08 | Deliver five complete cooperative games for real-time (server) play, each with explicit controls, server-validated actions, win/loss, scoring, and replay. Rules: Portal Partners in the [runtime design](specs/2026-11-17-runtime-transport-design.md) §6; the other four games in their approved designs, starting from the offline practice rules in the [local playhouse plan](plans/local-playhouse/README.md). |
| FR-09 | Persist results in one shared Supabase results table keyed by game type ([framework design](specs/2026-11-23-game-framework-design.md) §7), and show personal history and total wins across all games. **Proposed:** each winning participant gets one win per unique completed session; losses/cancellations add none. |
| FR-10 | Show clear errors for invalid actions, full/locked rooms, authentication failures, disconnects, and storage failures. A rejected room join preserves the previous location. |
| FR-11 | First release targets desktop browsers and keyboard controls. Camera view, controls, supported browsers, and exact layouts are open. |
| FR-12 | Vercel hosts the UI with separate dev/production configuration and separate Supabase environments. The frontend uses static ES modules, with esbuild bundling the shared client; no frontend framework. The authoritative runtime is a Cloudflare Worker plus one World Durable Object over WebSocket; see the [runtime design](specs/2026-11-17-runtime-transport-design.md). |

**Disconnect policy:** Cancel the active two-player round when a participant explicitly leaves or is declared disconnected; explain why, award no win, and offer return to the lobby. A 20-second reconnect grace retains the slot and position, and each game declares its own disconnect settings ([runtime design §5.6](specs/2026-11-17-runtime-transport-design.md)).

## 4. Scope Boundaries

Defer voice/video, complex avatar customization, mini-games beyond the five above, public matchmaking, a world editor, and in-room spectator mode. Board visibility is part of the first version; entering a playing room as a spectator is not. Competitive games are a future possibility.

## 5. Quality and Data Rules

- Backend controls membership, valid actions, game state, outcomes, and stored results for every game. Clients cannot set wins.
- Concurrent admissions and starts cannot overfill rooms or create duplicate rounds. Retried completion cannot duplicate results or win counts.
- Expose only permitted display information on the room board; protect account secrets and private history.
- Separate development credentials/accounts/data from production; no development test writes to production.
- Resume from authoritative state after connection gaps. Performance targets remain open and need measurement before declaring capacity supported.
- Free resources by default; team agreement before costs. Human review before merge; deployment/database changes need explicit authorization.

## 6. Acceptance Criteria

These are planned checks, not tests already run. Unless stated otherwise, each applies to all five games.

| ID | Expected result | Covers |
| --- | --- | --- |
| AC-01 | Separate accounts log in and reload their own saved profile after logout/login. Twenty avatar options are available and unknown IDs are rejected. | FR-01, FR-02 |
| AC-02 | Clients consistently see joins, movement, and departures. Support 16 players total distributed across the lobby and game rooms; reject a 17th admission, including concurrent joins. Moving between rooms preserves the player's existing world slot. | FR-03, FR-04 |
| AC-03 | Board correctly displays availability, names, limits, score, and agreed timing for all five rooms, without private account data. | FR-05 |
| AC-04 | In each game room, one player cannot start; two ready players create exactly one round. A third user cannot join a locked round but can see its board score. | FR-06, FR-07 |
| AC-05 | Two players on separate clients see the same game state, receive matching win/loss outcomes, and may replay or return. Winning and losing sequences: Portal Partners in the [runtime design](specs/2026-11-17-runtime-transport-design.md) §6 and §10; the others in their designs. | FR-08 |
| AC-06 | Save one result per completed session in the shared results table, under that game's type. Duplicate completion/retry does not duplicate history/wins. History and total wins include all games. Verify the agreed win-count rule for both participants. | FR-09 |
| AC-07 | Invalid/unauthenticated actions do not mutate state. Failed joins preserve location. Disconnect/cancellation follows approved rules; an admitted player can return to the lobby without requesting another world slot. Failed persistence is shown as pending/failed and retried without duplication. | FR-09, FR-10 |
| AC-08 | The complete journey works in agreed desktop browsers with agreed controls. Dev and production connect only to their own Supabase environments. | FR-11, FR-12 |

## 7. Architecture

Vercel serves the UI, Supabase handles Auth and persistence, and one World Durable Object on a Cloudflare Worker runs the authoritative world, with one room per game ([runtime design](specs/2026-11-17-runtime-transport-design.md); options compared in the [runtime research](research/runtime-transport.md)). Repeat the [load check](specs/2026-11-21-load-check-design.md) with all five rooms in play before declaring capacity supported.

## 8. Course Milestones and Open Decisions

Milestones: review spec/contract -> accounts/profile -> two-user lobby/board/rooms -> Portal Partners/results -> the other four games/results -> 3+ and full-capacity verification -> class-access deployment. Accounts/profile, the lobby, and Portal Partners are built; two accounts played Portal Partners together on the hosted dev environment on 11/22/2026. Insert the course-required midpoint component swap at the actual scheduled point, with agreed additions in each other's components. Dates and swap features remain TBD. Class access is required 1–2 weeks before presentation.

Implementation blockers:

- Server designs for the other four games: rules with one character per player, interaction targets, timing, score, win/loss, disconnect settings, and score range (the results table is shared). Hardest to synchronize: Room Rescue's shared sofa carry, Tiny Train Team's moving train, and Playhouse Cafe's carried items.
- Whether real-time (server) play includes the five practice levels per game, and whether offline practice stays in the release.
- Controls/camera/browsers; board timing and win-count defaults.

Ryan selected the current original character roster; final production artwork review, performance targets, dates, and swap work remain open.

Use Superpowers for subsequent design/planning. Keep this as the single initial spec rather than duplicating it under another documentation tree. Do not write a detailed game implementation plan until its design is approved.
