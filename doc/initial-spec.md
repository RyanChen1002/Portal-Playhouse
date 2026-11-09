# Portal Playhouse — Initial Specification

**Version:** 0.1

**Date:** November 8, 2026

**Status:** Draft for Ryan and Adam; not authorization to implement

## Change History

| Version | Date | Change | Approval |
| --- | --- | --- | --- |
| 0.1 | November 8, 2026 | Initial spec from updated meeting notes and Ryan's clarification | Pending Ryan and Adam |

## 1. Purpose and Decisions

A browser-based 3D world where friends and classmates meet and play mini-games. Initial scope: accounts, a saved profile, a shared lobby, a room board, one two-player cooperative game, and persistent results.

Source: Ryan's updated meeting notes and November 8 clarification. **Confirmed direction:** Supabase Auth/database, Vercel frontend hosting, separate dev/production environments, 20 avatar choices, a 16-user lobby, and Superpowers workflow. **First mini-game: TBD.** Colored-tile gameplay is an idea only.

The [component contract](component-contract.md) owns interfaces. This spec owns product requirements. All publication and teammate approvals remain pending. Proposed defaults below need explicit agreement.

## 2. Player Journey

Register or sign in, load a profile, choose an avatar, enter the 3D lobby, check room availability, and move into an available game room. Both players mark ready. The round starts and locks participation; others can still see its score on the board. Finish or fail the game, see the result, then replay or return to the lobby. Profile, history, and wins remain available on a later login.

## 3. Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | Supabase Auth manages accounts and sessions. Provider and verification flow remain open. |
| FR-02 | Persist display name and avatar selection; offer exactly 20 options. Notes request Disney-style character roles without requiring exact matches. Actual assets remain undecided. |
| FR-03 | Lobby capacity is 16. **Open:** Is this a limit on the whole world including game rooms, or only users physically in the lobby? Do not silently choose. |
| FR-04 | Show players joining, moving, and leaving the same space. Integrate two users first, then verify 3+ users and the full capacity. |
| FR-05 | Board shows room availability, configured minimum/maximum players, participant display names, current score, and timing. **Proposed:** elapsed time from authoritative round start; remaining time only for timed games. |
| FR-06 | Each game has configurable minimum/maximum players. The first game requires exactly two players; other game sizes are future extensions. |
| FR-07 | Start when both required players are ready. Lock participation while playing; other authenticated users may read board score/status, but in-room spectator mode is deferred. |
| FR-08 | Deliver one complete cooperative game with explicit controls, legal actions, win/loss, scoring, and replay behavior. **Game and rules TBD.** |
| FR-09 | Persist results in a separate Supabase result table per game type and show personal history and total wins. **Proposed:** each winning participant gets one win per unique completed session; losses/cancellations add none. |
| FR-10 | Show clear errors for invalid actions, full/locked rooms, authentication failures, disconnects, and storage failures. A rejected room join preserves the previous location. |
| FR-11 | First release targets desktop browsers and keyboard controls. Camera view, controls, supported browsers, and exact layouts are open. |
| FR-12 | Vercel hosts the UI with separate dev/production configuration and separate Supabase environments. Exact frontend framework and authoritative game runtime/transport remain open. |

**Proposed disconnect policy:** Cancel the active two-player round when a participant explicitly leaves or is declared disconnected; explain why, award no win, and offer return to the lobby. Timeout, reconnect grace, and return-to-lobby capacity handling require agreement.

## 4. Scope Boundaries

Defer voice/video, complex avatar customization, more mini-games, public matchmaking, a world editor, and in-room spectator mode. Board visibility is part of the first version; entering a playing room as a spectator is not. Competitive games are a future possibility.

## 5. Quality and Data Rules

- Backend controls membership, valid actions, game state, outcomes, and stored results. Clients cannot set wins.
- Concurrent admissions and starts cannot overfill rooms or create duplicate rounds. Retried completion cannot duplicate results or win counts.
- Expose only permitted display information on the room board; protect account secrets and private history.
- Separate development credentials/accounts/data from production; no development test writes to production.
- Resume from authoritative state after connection gaps. Performance targets remain open and need measurement before declaring capacity supported.
- Free resources by default; team agreement before costs. Human review before merge; deployment/database changes need explicit authorization.

## 6. Acceptance Criteria

These are planned checks, not tests already run.

| ID | Expected result | Covers |
| --- | --- | --- |
| AC-01 | Separate accounts log in and reload their own saved profile after logout/login. Twenty avatar options are available and unknown IDs are rejected. | FR-01, FR-02 |
| AC-02 | Clients consistently see joins, movement, and departures. Under the agreed capacity definition, 16 users are supported and a simultaneous excess admission is rejected without exceeding capacity. | FR-03, FR-04 |
| AC-03 | Board correctly displays availability, names, limits, score, and agreed timing without private account data. | FR-05 |
| AC-04 | One player cannot start; two ready players create exactly one round. A third user cannot join a locked round but can see its board score. | FR-06, FR-07 |
| AC-05 | Both players receive matching win/loss outcomes and may replay or return. Add concrete winning/losing sequences once the first game is chosen. | FR-08 |
| AC-06 | Save one result per completed session in the correct table. Duplicate completion/retry does not duplicate history/wins. Verify the agreed win-count rule for both participants. | FR-09 |
| AC-07 | Invalid/unauthenticated actions do not mutate state. Failed joins preserve location. Disconnect/cancellation and full-lobby return follow approved rules. Failed persistence is shown as pending/failed and retried without duplication. | FR-09, FR-10 |
| AC-08 | The complete journey works in agreed desktop browsers with agreed controls. Dev and production connect only to their own Supabase environments. | FR-11, FR-12 |

## 7. Architecture Approaches to Review

Both options keep Vercel for UI and Supabase for Auth/persistence:

- **Dedicated authoritative game service:** Clear server ownership of movement/game loops, but adds another runtime to host and operate.
- **Supabase-centered commands/functions plus realtime delivery:** Fewer services, but authoritative action ordering, timing, validation, and concurrency need a feasibility check for the chosen game.

Neither approach is selected. Vercel UI hosting and Supabase storage alone do not define the authoritative multiplayer runtime. Decide after selecting game mechanics; do not assume a persistent socket server runs inside ordinary frontend requests.

## 8. Course Milestones and Open Decisions

Milestones: review spec/contract -> accounts/profile -> two-user lobby/board/rooms -> game/results -> 3+ and full-capacity verification -> class-access deployment. Insert the course-required midpoint component swap at the actual scheduled point, with agreed additions in each other's components. Dates and swap features remain TBD. Class access is required 1–2 weeks before presentation.

Implementation blockers: first game/rules; runtime/transport/framework; capacity definition and return admission; auth provider; disconnect/retry timing; controls/camera/browsers; board timing and win-count defaults; exact schemas. Avatar assets, performance targets, dates, and swap work also require agreement.

Use Superpowers for subsequent design/planning. Keep this as the single initial spec rather than duplicating it under another documentation tree. Do not write a detailed game implementation plan until its design is approved.
