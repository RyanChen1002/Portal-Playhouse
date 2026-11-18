# Runtime Design: Cloudflare Durable Objects World, Rooms, and Portal Partners

**Version:** 0.1

**Date:** 11/17/2026

**Author:** Adam (backend lead), drafted with Claude Code using Superpowers brainstorming

**Status:** Approved by Adam on 11/17/2026; awaiting Ryan's approval in the pull request. Tentative: this branch (`feature/runtime-transport`) is the attempt to make Cloudflare Durable Objects work. Ryan's approval of the pull request approves this spec and the contract update in §11.

**Plan:** to be written after approval.

**Implements:** [initial spec](../initial-spec.md) FR-03 to FR-10 and the runtime part of FR-12; AC-02 to AC-07, and the runtime part of AC-08. **Interfaces:** [component contract](../component-contract.md) §2, §3, §5 to §7. **Research:** [runtime and transport](../research/runtime-transport.md), especially §3.2, §4.2, §6.2, and §7. **Game source:** [local playhouse plan](../plans/local-playhouse/README.md) and `frontend/games/rules.js` (PR #21).

Labels used below: **Decided** means Adam decided it in brainstorming on 11/17/2026. **Proposal** means a call made while drafting; Ryan's approval of the pull request accepts it, and changes need both partners' agreement.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/17/2026 | Initial runtime design: one World Durable Object, position-based movement, 20-second reconnect grace, Portal Partners as the first networked game, and results (including cancellations) in Supabase. After review: a capped movement allowance, asymmetric local signing keys, and players on a closing bridge sent back to the side they came from. Added token-verification hardening, a cap on connections awaiting sign-in, sign-out handling, and the no-card Cloudflare account note; deferred the load check to integration testing. |

## 1. Intent

Make the multiplayer part of Portal Playhouse real: signed-in players share a 3D courtyard, see each other move, walk into a game room, ready up, and play **Portal Partners** together, with the server deciding the outcome and Supabase saving it.

Why now: accounts and profiles are merged (PR #18), Ryan's frontend has a courtyard and five local demo games (PR #21), and the runtime is the main remaining architectural unknown (initial spec §7, §8). The research recommended Durable Objects for free-tier headroom; this branch tests that recommendation by building on it.

Ryan's five games are a **demo**. This design is the real, server-backed version, starting with one game (**Decided**).

## 2. Goals, non-goals, anti-goals

**Goals**

- A Cloudflare Worker plus one Durable Object that hold the authoritative world: admission, the 16-player limit, current room, positions, the room board, readiness, and Portal Partners rounds.
- Supabase sign-in verified by the runtime; identity always comes from the verified token.
- Position-based movement validated by the server (§5.4).
- A 20-second reconnect grace that returns a player exactly where they were (§5.6).
- Portal Partners played by two real players, each controlling their own character, with server-judged win/loss (§6).
- Exactly-once results in a Supabase table for Portal Partners (wins, losses, and cancellations), real `winsTotal`, and personal history (§7).
- The shared client and mock extended with the real-time interface, so Ryan can build against the mock and switch to the real runtime without code changes (§8).
- Automated tests locally and in CI, with no Cloudflare or Supabase hosted resources involved (§10).
- A component contract update (§11).

**Non-goals (this spec)**

- Wiring the frontend to the real runtime. That is Ryan's work, against the client and mock delivered here (**Proposal**). Browser end-to-end checks follow when that wiring exists.
- The other four demo games on the server, or on the server's board (**Decided**: one real room).
- Pausing rounds on disconnect and finishing a round solo. Both are deferred game settings (§5.6; added to [future features](../future-features.md)).
- Board access for players who are not admitted to the world (for example, after `WORLD_FULL`) (**Proposal**: deferred).
- In-room spectators, more than one Portal Partners room, capacity above 16, and moving to one Durable Object per room (see future features).
- Deploying to production, or creating production Cloudflare resources.

**Anti-goals** (failures even if everything else works)

- A client chooses its identity, its world slot, another player's position, an outcome, or a win.
- A 17th player is admitted, a room is overfilled, or two rounds start for one room, including under concurrent requests.
- A retried save produces a duplicate result or a double win.
- A player is told a result is saved before Supabase confirms it.
- A dropped connection loses the player's slot or position within the grace period.
- Development tests or tools reach the production Worker or production Supabase.
- Secrets (the Supabase secret key) appear in Git, in the browser, or in client-visible messages.

## 3. Constraints

- Supabase Auth and database; Vercel hosts the frontend (initial spec §1). Cloudflare Workers and Durable Objects on the **Workers Free plan** host the runtime (**Decided**, tentative).
- Adam owns the Cloudflare account (**Decided**). Dev and production share that account's daily free allowance (**Decided**).
- Free resources only; no costs without team agreement. If the free allowance proves insufficient, stop and discuss, do not upgrade.
- Hosted steps (Cloudflare account, dev Worker deployment, Worker secrets, applying migrations to hosted dev) are **manual checklist items performed by Adam**, not agent tasks, matching the backend foundation design.
- Agents must not merge into `main`, deploy to production, or change the production database (development rules).
- The 16-player world limit (FR-03) and the two-player first game (FR-06) are confirmed.
- Desktop browsers and keyboard controls (FR-11).

## 4. Approaches considered

### 4.1 One Durable Object or several

1. **One World Durable Object for everything.** All players connect to one object; the lobby and the game room are sections of its memory. The 16-player limit, room admission, and "a rejected join keeps you where you were" are simple in-memory checks because the object handles one message at a time. Changing rooms needs no reconnect, and the board is consistent because one place owns it. Costs: no isolation between rooms (a crash drops everyone) and a ceiling well above 16 players.
2. **One Durable Object per room plus a coordinator.** Rooms are isolated and it scales past 16, which is the common Cloudflare multiplayer pattern. Costs: moving between rooms means a new connection; admission is a two-step "reserve slot, then join" that must undo cleanly; preserving location on a failed join needs the client to hold the old connection; rooms must report to the board; calls between objects count against the request allowance.

**Decided: option 1.** The 16-player limit is what makes one object comfortable, and the requirements that are hardest in option 2 (AC-02, AC-04, AC-07) are nearly free in option 1. Option 2 is recorded in future features as the likely route if capacity grows well beyond 16. Rooms and games are written as separate modules (§9) so that move would mostly change wiring, not rules.

### 4.2 Movement authority

A. **Clients send position and facing; the server validates.** B. **Clients send key presses; the server simulates.** A middle option used positions in the lobby and inputs in the game room. The full comparison is in [research §3.2](../research/runtime-transport.md).

**Decided: A.** Least total work, keeps Ryan's tuned movement, and the server still judges everything that decides an outcome. Accepted trade-offs: a modified client can take shortcuts within the speed cap where the server does not check walls, and message volume is higher than B (still within the free allowance at the expected load; research §3.2).

### 4.3 Disconnects

Strict (cancel on any drop) versus a grace period. **Decided: a 20-second grace**, with each game declaring its own behavior (§5.6).

## 5. Design: connection, world, rooms, movement

### 5.1 Components and environments

```text
Browser (Ryan's UI)
   └─ PortalClient (shared/)  ── WebSocket ──>  Worker  ──>  World Durable Object
                                                   │              │
                                                   └── verifies   └── server-only calls
                                                       tokens         (profile, results)
                                                       via JWKS          │
                                               Supabase Auth  <──────────┴──> Supabase database
```

- **Worker:** accepts WebSocket upgrades at one path, checks the `Origin` header against the environment's allowed frontend origins (a configured list per environment; local includes the preview server's origin, and Node-based tests and scripts send a matching `Origin` header), and forwards the connection to the single World object (a fixed name, e.g. `world`). It does no game logic. (**Proposal**)
- **World Durable Object:** owns all live state in memory and speaks the real-time protocol (§5.2).
- **Supabase:** verifies identities (through its public signing keys), stores profiles, results, and wins. The runtime calls Supabase only with a server-side secret key stored as a Worker secret.

| Environment | Runtime | Supabase | Used by |
| --- | --- | --- | --- |
| **Local** | `wrangler dev` / the Workers test runtime, entirely offline | Local Supabase CLI stack | All development and automated tests, locally and in CI |
| **Dev** (hosted) | Dev Worker, e.g. `portal-runtime-dev`, with its own Durable Objects | Hosted dev project | Manual smoke checks; Ryan's integration |
| **Production** (hosted) | Production Worker, created at first launch only with explicit authorization | Production project (not yet created) | Real users; never a test target |

- Separate Workers built from the same code with wrangler environments (**Decided**). Durable Objects belong to the Worker that defines them, so dev and production state are fully separate.
- Each environment's configuration holds its Supabase URL, allowed origins, and (as a secret) its Supabase secret key. A missing or mismatched value prevents startup rather than falling back to another environment. (**Proposal**)
- The frontend needs only the runtime's WebSocket URL per environment, alongside the existing Supabase URL and publishable key.

### 5.2 Connection and authentication

1. The client opens a WebSocket and sends `auth {token}` with its Supabase access token as the **first message**. Browsers cannot set headers on a WebSocket, and a token in the URL can end up in logs (**Proposal**).
2. The runtime verifies the token's signature against the Supabase project's JWKS (asymmetric signing keys are already enabled on hosted dev, per the backend design), plus expiry, issuer, and audience. The verified user ID (`sub`) is the player ID. Keys are cached and refetched on an unknown key ID. Only asymmetric keys are accepted; the runtime never holds the legacy shared JWT secret. The local Supabase stack must therefore sign with asymmetric keys too: `supabase/config.toml` points `signing_keys_path` at a key file that setup and CI generate (`supabase gen signing-key`) and Git ignores. (**Proposal**: added after review, since the local stack does not currently configure signing keys.)
   **Verification hardening** (**Proposal**, added on Adam's security re-check):
   - Accept only the asymmetric algorithms Supabase uses (an explicit allow-list such as ES256 and RS256), never `none` or a symmetric algorithm. Never take the algorithm from the token alone.
   - Require a non-empty `sub`, `role` equal to `authenticated`, and `aud` equal to `authenticated`. This rejects legacy anon and service-role tokens even if they were signed by an accepted key. Allow at most 30 seconds of clock skew on expiry.
   - Refetch the key set for an unknown key ID at most once per minute. Otherwise anyone could make the runtime call Supabase on every attempt by inventing key IDs.
   - Never log tokens, `auth` or `auth.refresh` payloads, or the Supabase secret key. Log only the player ID and the error code.
   - All failures return the same `UNAUTHORIZED` message, without saying which check failed.
3. If no valid `auth` arrives within **10 seconds**, or verification fails, the server sends `request.error` with `UNAUTHORIZED` and closes. No other message is accepted before authentication. At most **32 connections** may be waiting to authenticate at once; further ones are closed immediately with `SERVICE_UNAVAILABLE`. The 4 KB message limit (§5.4) applies before authentication too. (**Proposal**)
4. The runtime reads the player's display name and avatar from Supabase using a server-only function (§7.2). Profile changes take effect on the next connection. A verified user with no profile is rejected with `SERVICE_UNAVAILABLE` and logged, as in the backend design. If Supabase cannot be reached, the connection is also rejected with `SERVICE_UNAVAILABLE`; the runtime never admits a player with blank or guessed profile data.
5. Admission: if the player is already held in the grace period (§5.6), they are restored. Otherwise, if 16 players already hold slots, the server replies `WORLD_FULL` and closes. Otherwise the player gets a slot and is placed at the lobby spawn point.
6. The server sends `world.snapshot` (§8.2): the player's own state, the current room snapshot, and the full board.
7. **Token refresh:** before the access token expires, the client sends `auth.refresh {token}` with a new token for the **same user**. A token for a different user is rejected and the connection closed. If the current token expires without a refresh, the server closes the connection with `UNAUTHORIZED`; the grace period then applies. (**Proposal**)
8. **One connection per account** (**Proposal**): a new authenticated connection for a player who already has one takes over the existing slot, room, and position. The old connection receives `session.replaced` and is closed. This is also how a reload within the grace period resumes.
9. **Sign-out** (**Proposal**): the client sends `world.leave` before signing out. Supabase access tokens stay valid until they expire (one hour by default) even after sign-out, and the runtime does not ask Supabase whether a session was revoked. A stolen or signed-out token could therefore connect until it expires. This is an accepted limitation, the same as for the existing profile functions.
10. **Idle limit** (**Proposal**): a connection that sends no messages other than `auth.refresh` for **10 minutes** is closed with an explanation, and its slot is freed immediately (no grace). This stops an idle open tab from keeping the object awake all day against the shared daily allowance.

### 5.3 World and rooms

- **Rooms** come from server configuration (**Decided**): the lobby, and one game room `portal` (Portal Partners, minimum 2, maximum 2 players). Adding a second Portal Partners room is a configuration change. The lobby spawn point and the `portal` entrance coordinates are taken from Ryan's courtyard (`frontend/games/rooms.js`, `frontend/world.js`) and kept in server configuration.
- **World limit:** at most 16 players hold slots, counting connected players and players within their grace period. Moving between rooms never changes slot use.
- **One location per player:** the lobby or one game room.
- **Joining a game room** (`room.join {roomId}`) succeeds only if all of these hold, checked in this order:
  1. The room exists (`ROOM_NOT_FOUND`).
  2. The player is in the lobby (`INVALID_ACTION`).
  3. The player's accepted lobby position is within **3.2 units** of that room's entrance (`INVALID_ACTION`). This mirrors `canEnterRoom` in Ryan's courtyard. (**Proposal**)
  4. The room is not playing (`ROOM_LOCKED`).
  5. The room is not full (`ROOM_FULL`).

  On success, the player moves to the room in the waiting state and receives that room's snapshot; other lobby players see `player.left` and the board updates. On failure, nothing changes.
- **Leaving a room** (`room.leave {}`) returns the player to the lobby at that room's entrance, keeping their slot. Leaving a playing room cancels the round (§6.5).
- **Waiting rooms:** players inside are listed on the board but have no position until a round starts. The frontend shows the waiting state; how is Ryan's choice. (**Proposal**)
- **Readiness** (`game.ready {ready}`) is accepted only in a waiting room. Readiness resets for everyone in the room when anyone joins or leaves it. When the room holds its minimum player count and all are ready, exactly one round starts (§6). (**Proposal** for the reset rule)
- **Visibility:** players receive movement and presence events only for their current room. Everyone admitted receives board updates for every room.

### 5.4 Movement

- While moving, the client sends `player.move {sequence, position, rotation}` about 10 times per second, plus a final message when it stops. `sequence` is a per-connection counter that increases with every move. `position` is `{x, y, z}` in the coordinate space of the player's current location (courtyard or Portal Partners arena). `rotation` is yaw in radians.
- The server **accepts** a move when:
  - the sequence is newer than the last accepted or rejected one (older ones are ignored silently);
  - the distance from the last accepted position fits the player's **movement budget**. The budget refills at 1.25 × the location's speed per second and is capped at 1 second's worth of speed plus 0.5 units. Each accepted move spends its distance. Speeds come from Ryan's code: 4.8 units/s in the courtyard and 4 units/s in Portal Partners. The cap means standing still cannot save up for a long jump: the largest single move is about 5.3 units in the courtyard and 4.5 in the arena. The refill tolerates messages that arrive bunched together by network jitter. (**Proposal**: budget values; added after review because an uncapped "speed × elapsed time" check allowed a stationary player to teleport.)
  - the position is inside the location's bounds: within radius 23 of the centre in the courtyard; `|x| ≤ 9.6` and `|z| ≤ 7.7` in the Portal Partners arena;
  - for Portal Partners, the straight path from the last accepted position does not enter the bridge gap (`|z| < 1.25`) unless the bridge is open and the path stays within `|x| ≤ 1.2` (rules in §6.2);
  - the player is not in a waiting room, and not in a finished or cancelled round.
- Accepted moves are forwarded to others in the same location as `player.updated`. The server does not echo accepted moves back to the sender.
- A rejected move gets `player.corrected {sequence, position, rotation, reason: "rejected"}` carrying the last accepted position. The client snaps or smooths to it and continues from there. A rejection is not an error event and does not close the connection.
- **Rate limit** (**Proposal**): moves above 20 per second from one connection are dropped without reply. Any message over 4 KB, or not valid JSON, is answered with `VALIDATION_ERROR` and ignored. Repeated abuse (for example, over 100 invalid messages in 10 seconds) closes the connection.
- `y` is accepted but must be between 0 and 3; the server does not simulate height. (**Proposal**)
- The server does not check courtyard furniture. Shortcuts through lobby furniture are an accepted trade-off (§4.2).

### 5.5 Room board

The board is the contract's `RoomSummary` for each game room (the lobby is not listed):

- `id`, `name`, `gameType` (`portal-partners`), `minPlayers`, `maxPlayers`, `status` (`waiting` or `playing`), `players` (`{id, displayName, avatarId}` only), `sessionId`, `startedAt`, `durationSeconds` (180 for Portal Partners), `score` (crystals collected, 0 to 2, or null when waiting), and `revision`.
- Timing (FR-05 **Proposal** adopted): clients show elapsed time from `startedAt` and remaining time from `durationSeconds`. The server sends `startedAt` and does not stream a ticking clock.
- `room.updated` is sent to all admitted players whenever any of those fields change.

### 5.6 Disconnects and reconnects

- **Unexpected disconnect** (the socket closes without `world.leave`, or a token expires): the player stays in the world for **20 seconds** (**Decided**). Their slot, room, position, and facing are held. Others in the same location see `player.connection {playerId, connected: false}`, and the character stays where it was.
- **Reconnect within 20 seconds:** authentication restores the player exactly where they were: same room, same position and facing, same round if it is still running (**Decided**). Others see `player.connection {connected: true}`. The returning client gets a fresh `world.snapshot`.
- **No return within 20 seconds:** the player is removed. Their slot is freed, others see `player.left {reason: "disconnected"}`, and the game's expiry rule applies (§6.5).
- **Deliberate leave:** `world.leave {}` frees the slot immediately, with no grace. Leaving a playing room (`room.leave`) cancels the round immediately (initial spec's proposed disconnect policy, kept).
- **Per-game settings** (**Decided**): each game declares (a) whether the round pauses or keeps running during the grace period, and (b) on expiry, whether the round is cancelled or the remaining player may finish. **Only "keep running" and "cancel" are built now.** "Pause" and "finish alone" are deferred to future features.
- **Runtime restart** (**Proposal**, accepted limitation): if the Durable Object restarts (for example, a deploy or a platform eviction), all live state is lost. Clients reconnect and start in the lobby; any round in progress ends with no result. Pending result saves survive, because they are kept in durable storage (§7.3).
- **Staying awake:** world state lives in memory, so the object must not hibernate or be evicted while any player holds a slot. The builder may keep it awake with a timer while players are present, or use the Hibernation API with state restored from storage and attachments. Either way, the requirement is that a quiet period with connected players loses nothing. (Research §4.2 item 5.)

## 6. Design: Portal Partners on the server

### 6.1 Source

The rules are those of Portal Partners in Ryan's merged PR #21 (`frontend/games/rules.js` and the local playhouse plan), adapted so **each player controls their own character** (**Decided**). Q-switching between teammates is removed, and anything "the active teammate" did is done by the player who sends it.

### 6.2 Arena and rules

Coordinates are in the arena space used by `rules.js`.

| Element | Position | Rule |
| --- | --- | --- |
| Spawn points | Player 1 at (-3, 6), player 2 at (0, 6), in join order | Set when the round starts |
| Bounds | `|x| ≤ 9.6`, `|z| ≤ 7.7` | Moves outside are rejected |
| Bridge gap | `|z| < 1.25` | Crossable only while the bridge is open, and only within `|x| ≤ 1.2` |
| Pressure plate | (-5, 3) | The bridge is open while any player's accepted position is within 1.3 of the plate, including a disconnected player's character. If the bridge closes while a player is in the gap, that player is sent back to the side they came from (below) |
| Lever | (2, -4) | Interacting latches the bridge open for the rest of the round |
| Crystal A / B | (-6, -5) / (6, -5) | Interacting collects it; score = crystals collected |
| Exit | (0, -7) | Interacting wins only if both crystals are collected and both players are within 2.3 of the exit |

- **Bridge closing under a player** (**Decided**): when the bridge closes (the plate is left before the lever is latched), every player whose accepted position is in the gap (`|z| < 1.25`) is moved to the edge of the side they entered from. The new position keeps their `x` and sets `z` to 1.35 if they entered from the positive side, or -1.35 from the negative side. The side is taken from their last accepted position outside the gap. That player receives `player.corrected {reason: "bridgeClosed"}` with the new position, so the UI can show a "fell back" moment, and others receive `player.updated`. A disconnected character in the gap is moved the same way. This replaces the demo's behavior, where a character on a closed bridge was frozen.
- **Interaction** (`game.interact {sessionId, actionId, target}` with `target` one of `lever`, `crystal-a`, `crystal-b`, `exit`) requires the sender to be within **1.9** of the target, as in `rules.js`. Out-of-range, already-collected, or unmet-condition interactions return `INVALID_ACTION` with a message, and change nothing.
- **Exit and disconnected players** (**Proposal**): the exit win also requires both players to be connected. A disconnected teammate can still hold the plate, but cannot be counted at the exit.
- **Time limit:** 180 seconds from `startedAt`. Reaching it with no win is a loss.
- **Duplicates:** `actionId` is chosen by the client and must be unique within the session. A repeated `actionId` gets the original response again and has no further effect. (**Proposal**)
- `sessionId` must match the room's current round; otherwise `NOT_IN_GAME`.

### 6.3 Round lifecycle

`waiting` -> `playing` -> `finished` (won or lost) or `cancelled`, then back to `waiting`.

1. **Start:** when both players are ready, the server creates a new session ID, sets `startedAt`, places players at the spawn points, locks the room, and sends `game.state` (§8.2) to both players, plus `room.updated` to everyone.
2. **Play:** the server sends `game.state` to both players whenever game state changes (bridge open or closed, lever, crystals) and at least once per second while playing, so clients can correct their clocks. Positions continue to travel as `player.updated`.
3. **End:** win at the exit, loss at time-out, or cancellation (§6.5). The server sends `game.finished {sessionId, outcome, score, persistenceStatus}` to both players and starts saving any result (§7.3).
4. **After:** the room returns to `waiting` with readiness reset and both players still inside. **Replay** is readying again; this creates a new session. **Return** is `room.leave`.

### 6.4 Server timing

- One round timer per playing room, checked at least 10 times per second. Ending on time-out must happen within 100 ms of the 180-second mark. (**Proposal**)
- No other tick loop. Movement and interactions are handled as messages arrive.

### 6.5 Cancellation

- **Leaving:** either player leaving a playing room (`room.leave` or `world.leave`) cancels the round immediately.
- **Disconnect** (Portal Partners settings): the round **keeps running** during the 20-second grace. The absent character stays in place and still counts for the plate. If the player has not returned when the grace expires, the round is **cancelled**.
- A cancelled round is **saved** with outcome `cancelled` and its reason (`left` or `disconnected`), but counts as neither a win nor a loss (**Decided**). `game.finished {outcome: "cancelled", reason, persistenceStatus: "pending"}` goes to the remaining player, and the save follows §7.3 like any other result.
- Whether quitting shortly after a round starts should count as a cancel or a loss is left to future games. Saving the `cancelled` outcome keeps that possible. For Portal Partners, any leave cancels.
- If a disconnected player returns after their round ended, the snapshot shows the room's current state, and they receive the last `game.finished` for that session so they can see what happened. (**Proposal**)

## 7. Design: results and wins in Supabase

### 7.1 Data

**Portal Partners results** (one table per game type, contract §7): one row per session that ends in a win, a loss, or a cancellation.

| Field | Rule |
| --- | --- |
| Result ID | Server-generated |
| Session ID | Unique; a retried save cannot create a second row |
| Player IDs | The two participants; references profiles |
| Outcome | `win`, `loss`, or `cancelled` |
| Cancel reason | `left` or `disconnected` when cancelled; otherwise empty |
| Score | Crystals collected at the end, 0 to 2 |
| Started at / completed at | From the runtime; UTC. For a cancellation, "completed" is when it was cancelled |
| Duration | Seconds from start to completion or cancellation |

- Same schema placement as profiles: not exposed through the Data API; `anon` and `authenticated` have no table privileges; RLS enabled as defense in depth.
- Cancelled sessions are saved (**Decided**), matching contract §7 ("record cancellation state"). Players can see whom they played with even when a round did not finish. Cancellations never add wins. Rounds lost to a runtime restart (§5.6) are not saved, because their state is gone.
- Participant membership must be queryable per player efficiently (for wins and history). The builder chooses the exact shape (for example, a participants table or an array with an index).

### 7.2 Functions

| Function | Callable by | Purpose |
| --- | --- | --- |
| `get_runtime_profile(player_id)` | Runtime only (secret key) | Display name and avatar for an admitted player |
| `record_portal_partners_result(...)` | Runtime only (secret key) | Insert one result idempotently by session ID; return the result ID, including when it already existed |
| `get_my_results(limit, cursor)` | Signed-in players | The caller's own results across game types, newest first, including cancellations, with each teammate's current display name and avatar; `limit` 1–50, default 20 (contract §4 proposal) |
| `get_me` (existing) | Signed-in players | `winsTotal` now counts the caller's winning results, one per unique winning session |

- Wins (initial spec FR-09 **Proposal** adopted): each participant in a winning session gets one win; losses and cancellations add none. `winsTotal` is derived from results, not stored, so it cannot drift.
- Runtime-only functions are executable only by the role the secret key authenticates as; `anon` and `authenticated` cannot call them. The security rules from the backend design (§5.4 there) apply: explicit grants, empty `search_path` for `SECURITY DEFINER`, and clean advisors.
- `record_portal_partners_result` validates its inputs (two distinct existing players, valid outcome, a cancel reason exactly when cancelled, score 0–2, completion after start) and rejects anything else.

### 7.3 Saving exactly once

1. When a round ends (win, loss, or cancellation), the World object writes a **pending result** to its durable storage before announcing `game.finished {persistenceStatus: "pending"}`.
2. It calls `record_portal_partners_result`. On success, it deletes the pending record and sends `result.saved {sessionId, resultId}` to any participant still connected.
3. On failure, it retries with backoff (for example 5 s, 30 s, 2 min, then every 10 min) using a Durable Object alarm, so retries survive restarts. Participants see `persistenceStatus: "pending"`, and `failed` after the first hour of failures; retries continue regardless. (**Proposal**: timings)
4. The unique session ID makes every retry safe.

The client must never show a result as saved before `result.saved` (or `persistenceStatus: "saved"`) arrives.

## 8. Design: the shared client and protocol

### 8.1 Client interface

Ryan builds against `PortalClient` only (contract §4). It gains a real-time connection (**Proposal** for exact names; the builder may adjust in the plan, with both partners' agreement):

- `connectWorld(): Promise<Result<WorldConnection>>` opens the WebSocket, authenticates with the current session, and resolves after the first `world.snapshot`.
- `WorldConnection` provides commands that return `Promise<Result<...>>` (`joinRoom`, `leaveRoom`, `setReady`, `interact`, `leaveWorld`), a non-awaited `sendMove(position, rotation)`, and an `on(event, callback)` subscription for every server event in §8.2. Each subscription returns an unsubscribe function.
- The client handles token refresh, sequence numbers, `requestId` matching, and **automatic reconnection** (several attempts within the 20-second grace), and reports connection state (`connecting`, `connected`, `reconnecting`, `closed`) through a subscription.
- `getMyResults({limit, cursor})` is added for history.
- The mock (`shared/mocks/`) implements the same interface **by running the same world and game engine in-process** (§9), with simulated other players for local demos. One contract test suite runs against both the mock and the real client, as for profiles.

### 8.2 Messages

All messages are JSON with the contract envelope `{type, requestId, payload}` from the client, `request.accepted` / `request.error` replies, and server events without `requestId`.

| Direction | Message | Notes |
| --- | --- | --- |
| C -> S | `auth {token}` | First message only |
| C -> S | `auth.refresh {token}` | Same user only |
| C -> S | `player.move {sequence, position, rotation}` | No reply when accepted |
| C -> S | `room.join {roomId}` | Replies with the room snapshot or an error |
| C -> S | `room.leave {}` | Returns to the lobby entrance |
| C -> S | `game.ready {ready}` | Waiting rooms only |
| C -> S | `game.interact {sessionId, actionId, target}` | Portal Partners targets in §6.2 |
| C -> S | `world.leave {}` | Frees the slot immediately |
| S -> C | `world.snapshot {self, room, players, board, revision}` | After auth and after every reconnect |
| S -> C | `room.snapshot {room, players, session, revision}` | After a join or leave |
| S -> location | `player.joined`, `player.left {playerId, reason}`, `player.updated {playerId, position, rotation, sequence, revision}`, `player.connection {playerId, connected}` | Same location only |
| S -> location | `player.ready {playerId, ready, revision}` | Readiness changes in a waiting room (added while planning) |
| S -> C | `player.corrected {sequence, position, rotation, reason}` | `reason`: `rejected` (a move was refused) or `bridgeClosed` (sent back off a closing bridge, §6.2) |
| S -> all | `room.updated {room}` | Board |
| S -> participants | `game.state {sessionId, revision, state}` | Portal Partners state: `bridgeOpen`, `latched`, `crystals`, `startedAt`, `durationSeconds`, `serverTime` |
| S -> participants | `game.finished {sessionId, outcome, score, persistenceStatus, reason?}` | `outcome`: `win`, `loss`, or `cancelled` |
| S -> participants | `result.saved {sessionId, resultId}` | After confirmation |
| S -> C | `session.replaced {}` | Before closing an older connection |

- **Revisions** (**Proposal**): one revision counter per room, increasing on every change to that room's membership, positions, or game state. Clients ignore events older than their latest snapshot and request nothing; after reconnecting they get a fresh snapshot.
- **Error codes:** existing `UNAUTHORIZED`, `VALIDATION_ERROR`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_LOCKED`, `WORLD_FULL`, plus the contract's proposed `NOT_IN_GAME`, `INVALID_ACTION`, and `GAME_NOT_READY` (readying outside a waiting room). These are added to `shared/contracts/`.

## 9. Code layout

**Proposal** (the builder may refine in the plan):

- `shared/world/`: the **world and game engine**, plain TypeScript with no Cloudflare, Supabase, or DOM imports. It holds rooms, admission, movement validation, readiness, Portal Partners rules, and grace timing, driven by an injected clock. Used by the Durable Object and by the mock.
- `runtime/`: a new npm workspace with the Worker, the World Durable Object adapter (sockets, token verification, storage, alarms, Supabase calls), and `wrangler` configuration with `dev` and `production` environments. `wrangler` and the Workers types are pinned dev dependencies.
- `shared/contracts/`: real-time message types, `RoomSummary`, `Result`, and new error codes.
- `shared/client/` and `shared/mocks/`: the client and mock additions in §8.1.
- `supabase/migrations/`: the results table and functions in §7.
- The Portal Partners rules are ported to TypeScript in `shared/world/`. Ryan's `frontend/games/rules.js` stays as the demo and is not changed by this work.

## 10. Testing and verification

All automated tests run locally and in CI against the local runtime and local Supabase. None touch hosted resources.

| Layer | Tool | Covers |
| --- | --- | --- |
| Engine | Vitest with a fake clock | Admission up to 16 and `WORLD_FULL` for the 17th; slot kept across room moves; each `room.join` failure and that it changes nothing; readiness reset; exactly one round per start; movement acceptance and each rejection (speed, bounds, gap with bridge closed, gap with bridge open, waiting room); plate held by a disconnected character; lever, crystals, exit conditions; a player in the gap sent back to the side they entered from when the bridge closes, including a disconnected character; time-out at 180 s; cancellation by leave and by grace expiry; reconnect restoring exact position and round; duplicate `actionId` |
| Runtime | Vitest in the Workers test runtime (`@cloudflare/vitest-pool-workers`) | Token required first; invalid, expired, wrong-issuer, wrong-audience, wrong-role, `alg: none`, and symmetric-algorithm tokens rejected; key refetch rate-limited; pending-connection cap; no token appears in logs; refresh for a different user rejected; one connection per account; `Origin` check; message size and rate limits; pending results survive a restart and are retried by alarm |
| Database | pgTAP | Result table privileges; runtime-only functions not callable by `anon` or `authenticated`; idempotent insert by session ID; input validation, including the cancel reason; `winsTotal` counts one per winning session and ignores losses and cancellations; `get_my_results` returns only the caller's results, including cancellations |
| Integration | Vitest, real client, local runtime and local Supabase | Two real accounts: connect, see each other move, join, ready, play to a win, a loss, and a cancellation, see `result.saved`, and see `winsTotal` and history update; a dropped connection reconnecting within 20 s to the same place; a third player rejected with `ROOM_LOCKED` but seeing the board score (AC-04) |
| Contract | Vitest | The mock and real client give the same results and events for the same scenarios |
| Concurrency | Integration | Concurrent joins at the limit admit exactly 16 (AC-02); two players readying at the same instant start one round; a retried result save produces one row |
| Load (manual, later) | A script with 16 simulated clients against local, then hosted dev | Measures incoming messages per second at 10 Hz and the object's CPU and duration against research §6.2. Deferred to integration testing (**Decided**): the 10-per-second rate in §5.4 is a working value until then. Results are recorded when run, not assumed |

- **CI:** extend the existing workflow to run the engine and runtime tests and the new database tests. It must stay within GitHub's free allowance.
- **Manual smoke check on hosted dev** before merging, performed by Adam: two browsers or scripted clients sign in, see each other, play one round to a win, and confirm the saved result.
- **Hosted setup checklist** (a plan deliverable, performed by Adam): Adam has created the Cloudflare account (no card was required, 11/17/2026); log in with wrangler; deploy the dev Worker; set its secrets and allowed origins; apply migrations to hosted dev; record usage after the load check.

## 11. Contract update (v0.7)

Contract §9 requires both partners to approve interface changes before anyone builds against them. This branch proposes a **component contract v0.7** recording:

- Runtime and transport: a Cloudflare Worker and one World Durable Object over WebSocket (tentative).
- Real-time authentication by first message, refresh, one connection per account, idle limit.
- `player.move` carries `{sequence, position, rotation}` instead of `{sequence, input}`; new `player.corrected`, `player.connection`, `world.snapshot`, `world.leave`, `session.replaced`, `auth`, `auth.refresh`, `game.interact` (replacing the generic `game.action`).
- The 20-second grace with per-game disconnect settings, replacing "timeout/reconnect grace remain open".
- The board delivered over the world connection, replacing `GET /api/rooms`. `GET /api/me/results` becomes `get_my_results`.
- Portal Partners as the first game; its result table and the win rule.
- `Result.outcome` gains `cancelled`, with a cancel reason; cancellations are saved but never count as wins (consistent with contract §7's "record cancellation state").
- `game.finished` for a cancellation reports `persistenceStatus: "pending"` and then `result.saved`, instead of `notApplicable`.
- The new `PortalClient` methods.

The contract text itself is updated on this branch before implementation, so Ryan reviews the spec and contract together. The initial spec's open decisions (§8 there) are updated to point here.

## 12. Open items for Ryan

1. The whole runtime choice (Durable Objects, one World object) and position-based movement.
2. The `PortalClient` additions (§8.1) and message list (§8.2), which he builds against.
3. Joining a room requires standing within 3.2 of its entrance, as in his courtyard.
4. Waiting rooms have no positions; the waiting view is his choice.
5. Portal Partners adapted to one character per player, including the rule that the exit needs both players connected, and players on a closing bridge being sent back to the side they came from (a "fell back" moment in the UI).
9. Cancelled rounds appear in personal history.
6. Readiness resets when anyone joins or leaves the room.
7. The idle limit of 10 minutes.
8. Frontend wiring to the real runtime is his follow-up work against the mock and client.

## 13. Left to the builder

- Wire-level details beyond §8.2: exact payload field types, and how errors on unrequested events are reported.
- How the object stays awake or restores state (§5.6), within the "nothing lost while players are present" requirement.
- JWKS caching details; the exact token claims checked beyond signature, expiry, issuer, and audience.
- The results table's participant shape and indexes; SQL function bodies and grants, within §7.
- The retry schedule's exact timings, within §7.3.
- Engine module structure and test organization; the load-check script.
- CI workflow details.
