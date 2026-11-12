# Portal Playhouse — Initial Component Contract

**Version:** 0.2

**Date:** 11/08/2026

**Status:** Approved by Ryan and Adam

**Project option:** A — Contract-first build with midpoint swap

## Change History

| Version | Date | Change | Approval |
| --- | --- | --- | --- |
| — | 11/11/2026 | Standardized history dates to MM/DD/YYYY; no requirement or version changes. | Requested by Ryan |
| 0.2 | 11/08/2026 | Updated notes and PR #2 review clarifications: Supabase Auth/data, Vercel, separate environments, 16-player whole-world limit, 20 avatars, room board/locking, game-specific results and wins | Approved |
| 0.1 | 11/05/2026 | Initial proposed component contract | Approved |

The [initial spec](initial-spec.md) defines product behavior and acceptance criteria. This contract defines component responsibilities and proposed interfaces. First game remains **TBD**. Proposed defaults require review. Transport and game-specific schemas are incomplete, so this is an initial contract, not yet a frozen implementation interface.

## 1. Ownership and Environments

- **Ryan:** Frontend/UI, world, controls, avatar selection, board, game visuals, account/profile screens, and errors.
- **Adam:** Auth integration, Supabase schema/access policies, authoritative multiplayer/game behavior, results, and win totals.
- **Both:** Shared interfaces/mocks, architecture, security, integration, and contract changes.
- Vercel hosts the frontend. Separate dev/production configuration and Supabase environments; no cross-environment account/result writes. Frontend framework and game-service hosting are open.
- Midpoint swap: add agreed features to each other's component. Date and additions remain TBD.

## 2. Authentication and Trust

Supabase Auth handles sign-up, sign-in, sign-out, and sessions. The earlier custom `/api/auth/register`, `/api/auth/login`, and `/api/auth/logout` proposal is superseded: use the selected Supabase client flow. Provider, verification behavior, and framework/SDK are open.

Protected application requests present a Supabase access token; the backend verifies it and derives identity from the authenticated session, not a client player ID. Define real-time authentication/refresh once transport is chosen. Invalid/expired identity cannot mutate protected state.

Protect exposed Supabase tables with appropriate access policies. Private history is limited to permitted participants; the board exposes only display information. Trusted credentials remain server-side. Clients cannot directly write authoritative membership, outcomes, results, or wins.

Sources: [Supabase Auth](https://supabase.com/docs/guides/auth), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime). Realtime delivery is distinct from authoritative game logic; runtime/transport remain open.

## 3. Proposed Shared Models

Server-generated string IDs; Supabase user identity for player IDs; UTC ISO 8601 timestamps; JSON camelCase. Database naming and mapping remain to be agreed.

| Model | Fields |
| --- | --- |
| Profile | `id: string`, `displayName: string`, `avatarId: string`, `winsTotal: integer >= 0` derived from trusted results |
| Presence | `playerId`, `roomId`, `position: {x: number, y: number, z: number}`, `rotation: number` (proposed yaw in radians) |
| RoomSummary | `id`, `name`, `gameType: string or null`, `minPlayers: integer`, `maxPlayers: integer`, `status: waiting/playing`, `players: [{id, displayName, avatarId}]`, `sessionId: string or null`, `startedAt: timestamp or null`, `durationSeconds: integer or null`, `score: number or null`, `revision: integer` |
| Session | `id`, `roomId`, `gameType`, fixed `playerIds`, `status: waiting/playing/finished/cancelled`, `startedAt`, `completedAt` (nullable timestamps), `revision: integer` |
| Result | `id`, `sessionId`, `gameType`, `playerIds: string[]`, `outcome: win/loss`, `score: number or null`, `completedAt: timestamp` |

Unless typed otherwise, identity/name/game fields above are strings. Propose stable avatar IDs `avatar-01` through `avatar-20`; actual assets remain open. Reject unknown IDs. Display-name limits, world bounds, axes, score units, and movement cadence require agreement. Board timing is derived from authoritative start time; remaining time applies only to timed games.

## 4. Proposed Application Data Operations

These are proposed adapter operations, not deployed endpoints. Both partners may select Supabase SDK/RPC equivalents before implementation while preserving agreed semantics.

| Operation | Input | Success |
| --- | --- | --- |
| `GET /api/me` | Authenticated session | `200`: Profile |
| `PATCH /api/me` | `{displayName?, avatarId?}`; at least one editable field | `200`: Profile; cannot edit identity or wins |
| `GET /api/rooms` | Authenticated session | `200`: `{rooms: RoomSummary[]}` |
| `GET /api/me/results` | Proposed cursor pagination, `limit` 1–50, default 20 | `200`: `{results: Result[], nextCursor: string or null}`; own participating results, newest first |

Application errors: `{error: {code: string, message: string}}`. Proposed statuses: 400 VALIDATION_ERROR, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 ROOM_NOT_FOUND, 409 ROOM_FULL/ROOM_LOCKED/WORLD_FULL, 503 SERVICE_UNAVAILABLE. These mappings do not override Supabase Auth's own HTTP responses; normalize provider errors for UI display.

## 5. Proposed Real-Time Interface

Transport and authoritative runtime are open. Client envelope: `{type, requestId, payload}`. Authenticated connection supplies identity. Success reply: `{type: "request.accepted", requestId, payload}`. Failure: `{type: "request.error", requestId, error: {code, message}}`.

| Direction | Event/payload | Purpose |
| --- | --- | --- |
| Client -> backend | `room.join {roomId}` | Atomic admission; acknowledge and send snapshot; failure preserves current location |
| Client -> backend | `room.leave {}` | Return to lobby using the existing world slot; apply agreed cancellation policy |
| Client -> backend | `player.move {sequence, input}` | Submit movement input; exact input depends on agreed controls |
| Client -> backend | `game.ready {ready: boolean}` | Set readiness in the current waiting room |
| Client -> backend | `game.action {sessionId, actionId, action}` | Validate membership/state; deduplicate; game-specific action schema TBD |
| Backend -> client | `room.snapshot {room, players, session, revision}` | Initial/resynchronized current-room state; game payload TBD |
| Backend -> room | `player.joined {player, revision}` | Announce admission |
| Backend -> room | `player.updated {playerId, position, rotation, sequence, revision}` | Validated movement |
| Backend -> room | `player.left {playerId, reason, revision}` | Announce departure |
| Backend -> board subscribers | `room.updated {room: RoomSummary}` | Availability, participants, score, and timing without spectator access |
| Backend -> participants | `game.state {sessionId, revision, state}` | Authoritative game update; game-specific state TBD |
| Backend -> participants | `game.finished {sessionId, outcome, score, persistenceStatus}` | Outcome win/loss/cancelled; persistence pending/saved/failed/notApplicable |
| Backend -> participants | `result.saved {sessionId, resultId}` | Confirm persistence after retry/pending state |

Additional proposed errors: NOT_IN_GAME, INVALID_ACTION, GAME_NOT_READY. Command acknowledgement schemas, sequence/revision scopes, retry windows, and snapshot-resync procedure must be finalized with transport. Ignore stale updates and use a fresh snapshot after gaps; do not treat message delivery as authorization.

## 6. Shared Rules

- Start with a maximum of 16 players total across the lobby and all game rooms. The backend enforces world admission atomically and rejects excess admissions with WORLD_FULL. Room transfers, including return to the lobby, preserve the existing world slot. Per-game room limits still apply. Revisit total capacity after performance testing; reconnect slot retention remains open.
- Each player has one current location. Failed joins preserve it. Room admission is atomic and enforces the configured maximum; players may join a waiting room before its minimum is reached. The minimum is required to start, not to admit the first player.
- Initial game requires exactly two players. Start once when both are ready; fixed participants cannot be replaced mid-round.
- Playing rooms reject new participants with ROOM_LOCKED. Others can see limited board information; in-room spectators are deferred.
- Proposed lifecycle: waiting -> playing -> finished or cancelled. Replay creates a new session ID and resets readiness. Finished/cancelled rooms return to waiting.
- Backend validates actions, computes outcomes, and persists results. Concrete game rules remain TBD.
- Proposed disconnect rule: explicit leave/declared disconnect cancels the active two-player round with no win; explain why and offer return. Timeout/reconnect grace and membership recovery remain open.

## 7. Results and Wins

Use one Supabase result table per game type as requested. Concrete table names follow game selection. Maintain consistent Result fields and participant associations for aggregation/access checks.

Proposed persistence rules:

- Unique `sessionId` per game result table; retries cannot duplicate a result. New replay, new session ID.
- One cooperative win per participant per unique winning session; no wins for loss/cancellation. Derive total wins from authoritative records, or maintain totals atomically/idempotently if materialized.
- Cancelled sessions record cancellation state but do not produce a win/loss result under this proposal.
- If saving fails, report pending/failed status and retry on the backend; never claim unsaved results are persisted. Send `result.saved` after successful recovery. Durable retry/recovery mechanism remains open.
- Enforce participant access to private history; nonparticipants see only approved board summaries.

## 8. Parallel Work and Verification

Ryan develops against shared mocks; Adam implements matching operations/events. Proposed future schema/mock locations: `shared/contracts/` and `shared/mocks/` (not yet created). Update schemas, mocks, and relevant checks together.

Verify the spec's AC-01 through AC-08: distinct accounts/persistence; 20 avatars; consistent movement and capacity; room board privacy; atomic start/locked-room rejection; matching outcomes; exactly-once persistence/wins; invalid actions/disconnects; desktop browsers and environment separation. These checks are planned, not passed runtime tests.

Milestones: accounts/profile, two-user lobby/board/rooms, first game/results, 3+ and full-capacity validation, deployed class access. Schedule the required midpoint component swap using actual course dates. Dates/swap features remain TBD; give class access 1–2 weeks before presentation.

## 9. Changes and Approval

Both partners approve interface changes before building against them. Record versions and actual approvals at the top, newest first. Task branches from dev -> reviewed PR into dev -> separate release PR from dev to main. Humans review and merge. Breaking changes need a coordinated update plan; after 1.0 use major increments for incompatibilities and minor increments for compatible changes.

This draft does not configure deployments, database projects, branch protections, or publish anything. Open decisions: first game/rules, runtime/transport/framework, auth provider, reconnect slot retention, timing/reconnect/retry semantics, concrete schemas, avatar assets, controls, performance targets, course dates, and swap additions.
