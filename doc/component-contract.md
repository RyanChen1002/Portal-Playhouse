# Portal Playhouse — Initial Component Contract

**Version:** 0.8

**Date:** 11/18/2026

**Project option:** A — Contract-first build with midpoint swap

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.8 | 11/18/2026 | Proposed by Adam on `feature/runtime-transport`; tentative until Ryan approves the pull request. Aligned the §5 message table and the §3 Result model with the built wire shapes in `shared/contracts/realtime.ts` (`world.snapshot`, `room.snapshot`, `player.left` reasons, `GameResult`). Added client notes on reconnect outcomes, late `failed` results, and close codes, and the connection's `closeReason`. Pointed the stale "game rules remain TBD" line to runtime design §6. |
| 0.7 | 11/17/2026 | Proposed by Adam on `feature/runtime-transport`; **tentative until Ryan approves the pull request**. Records the runtime and real-time interface from the [runtime design](specs/2026-11-17-runtime-transport-design.md) (§11 there): a Cloudflare Worker plus one World Durable Object over WebSocket (tentative); first-message real-time authentication, refresh, one connection per account, idle limit; position-based `player.move`; the new message table (including `player.ready`) and error handling; the board delivered on the world connection instead of `GET /api/rooms`; `get_my_results` instead of `GET /api/me/results`; `Result.outcome` gains `cancelled` with `cancelReason`; the 20-second reconnect grace with per-game disconnect settings; cancellations saved but never counted as wins; and the `PortalClient` additions. Portal Partners is the first networked game. |
| 0.6 | 11/15/2026 | Aligned account/profile documentation with merged PR #18, including session storage, subscriptions, name checks, and null handling. Multiplayer remains undecided. |
| 0.5 | 11/13/2026 | Linked the original character roster selected by Ryan; retained existing avatar IDs and profile data fields. |
| 0.4 | 11/12/2026 | Auth: email + password, no confirmation/reset/OAuth. Profile operations become database functions behind a shared TypeScript client and mock. Unique display names with an agreed rule. New error codes and an optional error `field`. Adds `shared/client/`. Details: [backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) |
| 0.3 | 11/11/2026 | Standardized history dates and columns; removed approval status fields and updated the document version. Requirements unchanged. |
| 0.2 | 11/08/2026 | Updated notes and PR #2 review clarifications: Supabase Auth/data, Vercel, separate environments, 16-player whole-world limit, 20 avatars, room board/locking, game-specific results and wins |
| 0.1 | 11/05/2026 | Initial proposed component contract |

The [initial spec](initial-spec.md) defines product behavior and acceptance criteria. This contract defines component responsibilities and proposed interfaces. Portal Partners is the first networked game (see the [runtime design](specs/2026-11-17-runtime-transport-design.md)); the five local demo games are not part of the server contract. Proposed defaults require review. The runtime and transport choice is **tentative** until Ryan approves the pull request, and wire-level details beyond §5 are left to the builder, so this is an initial contract, not yet a frozen implementation interface.

## 1. Ownership and Environments

- **Ryan:** Frontend/UI, world, controls, avatar selection, board, game visuals, account/profile screens, and errors.
- **Adam:** Auth integration, Supabase schema/access policies, authoritative multiplayer/game behavior, results, and win totals.
- **Both:** Shared interfaces/mocks, architecture, security, integration, and contract changes.
- Vercel hosts the frontend. Separate dev/production configuration and Supabase environments; no cross-environment account/result writes. **Runtime (v0.7, tentative):** a Cloudflare Worker plus one World Durable Object on the Workers Free plan hosts the authoritative real-time runtime, with separate Workers (and therefore separate Durable Object state) for dev and production. Adam owns the Cloudflare account. The frontend framework remains open. Details: [runtime design](specs/2026-11-17-runtime-transport-design.md) §5.1.
- Midpoint swap: add agreed features to each other's component. Date and additions remain TBD.

## 2. Authentication and Trust

Supabase Auth handles sign-up, sign-in, sign-out, and sessions. The earlier custom `/api/auth/register`, `/api/auth/login`, and `/api/auth/logout` proposal is superseded: use the selected Supabase client flow. **Proposed v0.4:** email + password only, minimum password length 8. No email confirmation, password reset, magic links, OAuth, or anonymous sign-in for the first release ([auth research](research/auth-provider.md)). Frontend framework remains open; the shared client (§4) wraps `@supabase/supabase-js`.

Protected application requests present a Supabase access token; the backend verifies it and derives identity from the authenticated session, not a client player ID. For the profile functions (§4), Supabase verifies the token and the functions use only the session's user ID. **Real-time authentication (v0.7, tentative):** the client opens a WebSocket and sends `auth {token}` with its Supabase access token as the first message; no other message is accepted before it, and it must arrive within 10 seconds. The runtime verifies the token's signature against the Supabase project's public signing keys (asymmetric algorithms only), plus expiry, issuer, audience, and role. The verified user ID is the player ID. Before expiry the client sends `auth.refresh {token}` for the same user; otherwise the connection closes with `UNAUTHORIZED`. One connection per account: a new connection takes over the existing slot and the older one receives `session.replaced`. A connection idle for 10 minutes is closed. Details: [runtime design](specs/2026-11-17-runtime-transport-design.md) §5.2. Invalid/expired identity cannot mutate protected state.

Protect exposed Supabase tables with appropriate access policies. Private history is limited to permitted participants; the board exposes only display information. Trusted credentials remain server-side. Clients cannot directly write authoritative membership, outcomes, results, or wins.

Sources: [Supabase Auth](https://supabase.com/docs/guides/auth), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime](https://supabase.com/docs/guides/realtime). Realtime delivery is distinct from authoritative game logic; the v0.7 runtime is the Cloudflare Worker and World Durable Object above (tentative).

## 3. Proposed Shared Models

Server-generated string IDs; Supabase user identity for player IDs; UTC ISO 8601 timestamps; JSON camelCase. Database naming and mapping remain to be agreed.

| Model | Fields |
| --- | --- |
| Profile | `id: string`, `displayName: string`, `avatarId: string`, `winsTotal: integer >= 0` derived from trusted results |
| Presence | `playerId`, `roomId`, `position: {x: number, y: number, z: number}`, `rotation: number` (proposed yaw in radians) |
| RoomSummary | `id`, `name`, `gameType: string or null`, `minPlayers: integer`, `maxPlayers: integer`, `status: waiting/playing`, `players: [{id, displayName, avatarId}]`, `sessionId: string or null`, `startedAt: timestamp or null`, `durationSeconds: integer or null`, `score: number or null`, `revision: integer` |
| Session | `id`, `roomId`, `gameType`, fixed `playerIds`, `status: waiting/playing/finished/cancelled`, `startedAt`, `completedAt` (nullable timestamps), `revision: integer` |
| Result (`GameResult`, v0.8) | `id`, `sessionId`, `gameType: "portal-partners"`, `outcome: win/loss/cancelled`, `cancelReason: left/disconnected or null` (set exactly when cancelled), `score: number`, `startedAt: timestamp`, `completedAt: timestamp` (for a cancellation, when it was cancelled), `durationSeconds: integer`, `players: [{id, displayName, avatarId}]` (each participant's current display name and avatar) |

Unless typed otherwise, identity/name/game fields above are strings. Propose stable avatar IDs `avatar-01` through `avatar-20`; the local preview maps these IDs to the [20 original characters](plans/2026-11-12-local-3d-preview.md#character-roster) selected by Ryan on 11/13/2026. Names are UI labels; persist the avatar ID, not the character name. Reject unknown IDs. **Proposed v0.4:** new profiles start with `avatar-01`, and `winsTotal` is `0` until results exist.

**Display names (proposed v0.4):** trim leading and trailing whitespace and collapse internal runs to one space. The stored and returned name is that normalized form. It must be 1–24 Unicode code points, with no control or invisible/formatting characters. Names are **unique, compared case-insensitively**, and players may change them later, including changing only the case of their own name. The exact character sets are in the [backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) and its plan. `shared/contracts/` exports the rule so the UI can validate before calling.

World bounds, axes, score units, and movement cadence require agreement. Board timing is derived from authoritative start time; remaining time applies only to timed games.

## 4. Proposed Application Data Operations

PR #18 is merged into dev. Account/profile operations now exist in the shared client and database migrations. The real-time operations (rooms, movement, and game) are proposals in §5, tentative until Ryan approves.

**Proposed v0.4: the shared client is the frontend/backend boundary.** The frontend calls a TypeScript `PortalClient`, not Supabase tables or endpoints directly. There are two implementations with the same interface and behavior: a real one in `shared/client/` and an in-memory mock in `shared/mocks/`. One contract test suite runs against both. Async client methods return `{data, error: null}` or `{data: null, error}`. The exception is `onSessionChange(callback)`, which returns an unsubscribe function; its callback receives session state.

| Client method | Backend (proposed v0.4) | Success data | Replaces |
| --- | --- | --- | --- |
| `signUp({email, password, displayName})` | Supabase Auth; a database trigger creates the profile | Profile | — |
| `signIn({email, password})` | Supabase Auth | Profile | — |
| `signOut()` | Supabase Auth | `null` | — |
| `getSession()` / `onSessionChange(callback)` | Supabase Auth | `{signedIn, playerId}` | — |
| `getMe()` | `rpc get_me` | Profile | `GET /api/me` |
| `updateMe({displayName?, avatarId?})` | `rpc update_me` | Profile; cannot edit identity or wins | `PATCH /api/me` |
| `checkDisplayName(displayName)` | `rpc check_display_name` (callable signed out) | `{available: boolean}`; advisory only | new |

Merged client behavior from PR #18:

- Checking your own current display name returns available, including case-only changes.
- Session subscribers receive the current state asynchronously; identical states may be omitted.
- Sessions default to memory-only storage. Browser integration must supply storage and a stable storage key to survive reloads. Automatic background token refresh is disabled; session-aware calls can refresh an expired session.
- Explicit null profile fields are rejected by the shared client; the SQL function treats null as unchanged.
- Signing up signs out the current client session first. Signing out is local to that client's session.

If a display name is taken between `signUp`'s availability check and account creation, the account is still created with a generated `Player-xxxxxx` name, and the returned Profile shows it.

**Proposed v0.7 additions (tentative):**

| Client method | Backend | Success data | Replaces |
| --- | --- | --- | --- |
| `getMyResults({limit?, cursor?})` | `rpc get_my_results`; `limit` 1–50, default 20 | `{results: Result[], nextCursor: string or null}`; the caller's own results across game types, newest first, including cancellations, with each teammate's current display name and avatar | `GET /api/me/results` |
| `connectWorld()` | WebSocket to the runtime (§5) | `WorldConnection`, resolved after the first `world.snapshot` | new |

`WorldConnection` provides commands that return the same `{data, error}` shape (`joinRoom`, `leaveRoom`, `setReady`, `interact`, `leaveWorld`), a non-awaited `sendMove(position, rotation)`, and `on(event, callback)` for every server event in §5, each returning an unsubscribe function. The client handles token refresh, sequence numbers, `requestId` matching, and automatic reconnection within the grace period (§6), and reports connection state (`connecting`, `connected`, `reconnecting`, `closed`) through a subscription. The mock runs the same world and game engine in-process, and one contract test suite runs against both implementations. Exact names may be adjusted in the plan with both partners' agreement.

`GET /api/rooms` is replaced: the room board (`RoomSummary` for each game room; the lobby is not listed) arrives in `world.snapshot` and is kept current by `room.updated` on the world connection. `GET /api/me/results` is replaced by `getMyResults` above. `get_me` now derives `winsTotal` from winning results, one per unique winning session.

Application errors: `{error: {code: string, message: string, field?: string}}`. **Proposed v0.4** adds the optional `field`: `displayName`, `avatarId`, `email`, or `password`. It names the input an error belongs to, so the UI can attach the message to that input for screen readers (WCAG 3.3.1). It's omitted when no single input is at fault, and always for `INVALID_CREDENTIALS`. `message` is fallback text; the UI shows its own wording keyed on `code` and `field`.

Proposed statuses: 400 VALIDATION_ERROR, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 ROOM_NOT_FOUND, 409 ROOM_FULL/ROOM_LOCKED/WORLD_FULL, 503 SERVICE_UNAVAILABLE. **Proposed v0.4 adds:** 409 DISPLAY_NAME_TAKEN. Real-time errors (§5) carry the same codes in `request.error`; HTTP statuses do not apply to the WebSocket. The shared client also normalizes Supabase Auth's errors into EMAIL_TAKEN, INVALID_CREDENTIALS, WEAK_PASSWORD, RATE_LIMITED, VALIDATION_ERROR, and SERVICE_UNAVAILABLE. These mappings do not override Supabase Auth's own HTTP responses; they are what the client returns to the UI.

## 5. Proposed Real-Time Interface

**Tentative (v0.7):** WebSocket to the World Durable Object ([runtime design](specs/2026-11-17-runtime-transport-design.md) §5 and §8.2). Client envelope: `{type, requestId, payload}`. Identity comes only from the verified `auth` token (§2). Success reply: `{type: "request.accepted", requestId, payload}`. Failure: `{type: "request.error", requestId, error: {code, message}}`. Server events carry no `requestId`.

| Direction | Message | Notes |
| --- | --- | --- |
| Client -> backend | `auth {token}` | First message only |
| Client -> backend | `auth.refresh {token}` | Same user only |
| Client -> backend | `player.move {sequence, position, rotation}` | `position` is `{x, y, z}` in the current location's coordinate space; `rotation` is yaw in radians. No reply when accepted |
| Client -> backend | `room.join {roomId}` | Atomic admission; replies with the room snapshot or an error; failure preserves the current location |
| Client -> backend | `room.leave {}` | Returns to the lobby at the room's entrance, keeping the world slot; leaving a playing room cancels the round |
| Client -> backend | `game.ready {ready}` | Waiting rooms only |
| Client -> backend | `game.interact {sessionId, actionId, target}` | Replaces the generic `game.action`; Portal Partners targets are `lever`, `crystal-a`, `crystal-b`, `exit` |
| Client -> backend | `world.leave {}` | Frees the slot immediately, with no grace |
| Backend -> client | `world.snapshot {self, room, board, lastFinished}` | After auth and after every reconnect. `self` is `{playerId, roomId, position, rotation}`; `room` is a room snapshot (below); `board` is `RoomSummary[]`; `lastFinished` is the player's latest `game.finished` payload or null |
| Backend -> client | `room.snapshot {roomId, summary, players, session, revision}` | A room snapshot: `summary` is the `RoomSummary` (null for the lobby), `players` the presences, `session` the running round's state with its `sessionId` (or null). Also the `request.accepted` payload of `room.join` and `room.leave` |
| Backend -> location | `player.joined`, `player.left {playerId, reason, revision}` (`reason`: `moved`, `left`, `disconnected`, or `idle`), `player.updated {playerId, position, rotation, sequence, revision}`, `player.connection {playerId, connected}` | Same location only |
| Backend -> location | `player.ready {playerId, ready, revision}` | Readiness changes in a waiting room |
| Backend -> client | `player.corrected {sequence, position, rotation, reason}` | `reason`: `rejected` (a move was refused) or `bridgeClosed` (sent back off a closing bridge). Not an error and does not close the connection |
| Backend -> all admitted | `room.updated {room}` | Board: availability, participants, score, and timing without spectator access |
| Backend -> participants | `game.state {sessionId, revision, state}` | Portal Partners state: `bridgeOpen`, `latched`, `crystals`, `startedAt`, `durationSeconds`, `serverTime` |
| Backend -> participants | `game.finished {sessionId, outcome, score, persistenceStatus, reason?}` | `outcome`: `win`, `loss`, or `cancelled`; persistence pending/saved/failed. A cancellation reports `pending` first, not `notApplicable` |
| Backend -> participants | `result.saved {sessionId, resultId}` | Confirm persistence after retry/pending state |
| Backend -> client | `session.replaced {}` | Sent to an older connection before it is closed |

Errors: the existing codes in §4 plus NOT_IN_GAME, INVALID_ACTION, and GAME_NOT_READY (readying outside a waiting room), all now adopted; they are added to `shared/contracts/`. `SERVICE_UNAVAILABLE` is also returned when a connection cannot be admitted (for example, Supabase unreachable or too many connections awaiting sign-in).

**Client notes (v0.8):**

- **Missed outcomes.** When a round ends while a player is away, its outcome reaches that player on reconnect only as `world.snapshot.lastFinished`; no `game.finished` event is sent. Show it if its `sessionId` differs from the last outcome shown.
- **Late failures.** A `game.finished` with `persistenceStatus: "failed"` can arrive later for an older `sessionId`, even during a new round. Compare `sessionId` before updating the screen. `result.saved` confirms a save.
- **`player.left` reasons.** `moved` (went to another location), `left` (`world.leave`), `disconnected` (the grace period ran out), `idle` (closed after 10 minutes idle).
- **Close codes.** The shared client handles these and reports why a connection ended as `WorldConnection.closeReason` (`idle`, `replaced`, `left`, `unauthorized`, `invalid`, `worldFull`, `unavailable`, `lost`), set before the `closed` state is reported:

| Close | Meaning | Client behavior |
| --- | --- | --- |
| 1000 with reason `session.replaced`, `idle`, or `left` | Replaced by a newer connection, idle, or left | Terminal |
| 4401 `UNAUTHORIZED` | Token missing, invalid, or expired | Refresh the session once, then retry |
| 4409 `WORLD_FULL` | The world has 16 players | Terminal |
| 4503 `SERVICE_UNAVAILABLE` | Not admitted right now (for example, Supabase or the signing keys unreachable) | Retried on the schedule below |
| 4400 | Invalid messages | Terminal |
| Any other close | Connection lost | Retried at 0.5, 1, 2, 4, and 8 s, then `closed` with `lost` |

Revisions: one counter per room, increasing on every change to that room's membership, positions, or game state. Clients ignore events older than their latest snapshot; after a gap or reconnect they use a fresh snapshot. Movement is server-validated against a speed budget, bounds, and game rules (design §5.4). Do not treat message delivery as authorization. Wire-level details beyond this table are left to the builder.

## 6. Shared Rules

- Start with a maximum of 16 players total across the lobby and all game rooms. The backend enforces world admission atomically and rejects excess admissions with WORLD_FULL. Room transfers, including return to the lobby, preserve the existing world slot. Per-game room limits still apply. Revisit total capacity after performance testing. A player who disconnects unexpectedly keeps their slot, room, position, and facing for a **20-second reconnect grace** (v0.7, tentative); the slot counts toward the 16 during that time. A deliberate `world.leave` frees the slot immediately.
- Each player has one current location. Failed joins preserve it. Room admission is atomic and enforces the configured maximum; players may join a waiting room before its minimum is reached. The minimum is required to start, not to admit the first player.
- Initial game requires exactly two players. Start once when both are ready; fixed participants cannot be replaced mid-round.
- Playing rooms reject new participants with ROOM_LOCKED. Others can see limited board information; in-room spectators are deferred.
- Proposed lifecycle: waiting -> playing -> finished or cancelled. Replay creates a new session ID and resets readiness. Finished/cancelled rooms return to waiting.
- Backend validates actions, computes outcomes, and persists results. Portal Partners rules: [runtime design](specs/2026-11-17-runtime-transport-design.md) §6.
- **Disconnects (v0.7, tentative):** an unexpected disconnect starts the 20-second grace above; reconnecting within it restores the player exactly where they were (same room, position, facing, and running round). Each game declares (a) whether its round pauses or keeps running during the grace and (b) on expiry, whether the round is cancelled or the remaining player may finish. Only "keep running" and "cancel" are built now; "pause" and "finish alone" are deferred ([future features](future-features.md)). Portal Partners keeps running and cancels on expiry; an explicit leave (`room.leave` or `world.leave`) of a playing room cancels the round immediately, with no win. Explain why and offer return. If the runtime restarts, live state is lost and any round in progress ends with no result.

## 7. Results and Wins

Use one Supabase result table per game type as requested. The first table is for Portal Partners (v0.7, tentative); each row is one session that ended in a win, loss, or cancellation, with the runtime-only function `record_portal_partners_result` and the player-facing `get_my_results`. Details: [runtime design](specs/2026-11-17-runtime-transport-design.md) §7. Maintain consistent Result fields and participant associations for aggregation/access checks.

Proposed persistence rules:

- Unique `sessionId` per game result table; retries cannot duplicate a result. New replay, new session ID.
- One cooperative win per participant per unique winning session; no wins for loss/cancellation. Derive total wins from authoritative records, or maintain totals atomically/idempotently if materialized.
- **Cancelled sessions are saved (v0.7, tentative)** with outcome `cancelled` and a `cancelReason` (`left` or `disconnected`). They count as neither a win nor a loss and never add wins, and they appear in personal history. This is consistent with recording cancellation state. Rounds lost to a runtime restart are not saved.
- If saving fails, report pending/failed status and retry on the backend; never claim unsaved results are persisted. Send `result.saved` after successful recovery. Under v0.7 the runtime writes a pending result to durable storage before announcing `game.finished` with `persistenceStatus: "pending"`, then retries with backoff; the unique session ID makes retries safe. Details: [runtime design](specs/2026-11-17-runtime-transport-design.md) §7.3.
- Enforce participant access to private history; nonparticipants see only approved board summaries.

## 8. Parallel Work and Verification

Ryan develops against shared mocks; Adam implements matching operations/events. The merged code provides `shared/contracts/`, `shared/mocks/`, and `shared/client/` for account/profile operations. Update schemas, client, mocks, and relevant checks together.

Verify the spec's AC-01 through AC-08: distinct accounts/persistence; 20 avatars; consistent movement and capacity; room board privacy; atomic start/locked-room rejection; matching outcomes; exactly-once persistence/wins; invalid actions/disconnects; desktop browsers and environment separation. These checks are planned, not passed runtime tests.

Milestones: accounts/profile, two-user lobby/board/rooms, first game/results, 3+ and full-capacity validation, deployed class access. Schedule the required midpoint component swap using actual course dates. Dates/swap features remain TBD; give class access 1–2 weeks before presentation.

## 9. Changes and Approval

Both partners approve interface changes before building against them. Record versions in change history, newest first, and approval evidence in pull requests. Task branches from dev -> reviewed PR into dev -> separate release PR from dev to main. Humans review and merge. Breaking changes need a coordinated update plan; after 1.0 use major increments for incompatibilities and minor increments for compatible changes.

This draft does not configure deployments, database projects, branch protections, or publish anything. Tentative pending Ryan's approval of the pull request: the runtime and transport choice (Cloudflare Worker plus one World Durable Object), position-based movement, the 20-second grace, and the interface in §4 and §5. Open decisions: frontend framework, final timing and retry values (working values are in the design), concrete schemas beyond Portal Partners, final production artwork review, controls, performance targets, course dates, and swap additions.
