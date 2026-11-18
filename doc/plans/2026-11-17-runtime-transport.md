# Runtime (Durable Objects World, Rooms, Portal Partners) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.1

**Date:** 11/17/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/17/2026 | Added the initial implementation plan for the runtime design. |

**Goal:** A Cloudflare Worker and one World Durable Object run the authoritative world: Supabase sign-in, the 16-player limit, lobby and room presence, validated movement, the room board, and two-player Portal Partners rounds. Results are saved exactly once to Supabase, and a shared client and mock let the frontend use it all.

**Architecture:** The rules live in a platform-free engine (`shared/world/`). It is driven by commands and an injected clock, and it emits messages into an outbox. The Durable Object (`runtime/`) is a thin adapter: sockets, token verification, Supabase calls, timers and durable result retries. The mock client runs the same engine in-process, so the mock and the real runtime cannot drift. Supabase gains a results table and three functions.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (wrangler, SQLite-backed storage, alarms), the Cloudflare Vitest integration, `jose` (JWT/JWKS), Supabase (Postgres, PL/pgSQL, pgTAP), Vitest, npm workspaces, GitHub Actions, Node 22.

**Spec:** [doc/specs/2026-11-17-runtime-transport-design.md](../specs/2026-11-17-runtime-transport-design.md). Read it first; section numbers below (§) refer to it. Also read the [contract](../component-contract.md) after Task 1 updates it.

**Start condition:** Adam approved the spec on 11/17/2026. Ryan reviews the spec, the contract update (Task 1), and the implementation together in this branch's pull request. Work happens on `feature/runtime-transport`.

## Global Constraints

- **Hosted resources:** all automated tests and scripts use the **local** Supabase stack and the local Workers runtime only. Hosted steps (Cloudflare login, deploying the dev Worker, setting secrets, applying migrations to hosted dev) are Adam's manual checklist (Task 12). Agents never deploy, never run `wrangler deploy`, and never run Supabase commands with `--remote`.
- **Dependencies:** pin every new dependency exactly (`npm install -E`) and commit `package-lock.json`. Use the current versions of `wrangler`, `@cloudflare/vitest-pool-workers` (or its current successor in the Cloudflare docs), `@cloudflare/workers-types` and `jose`. Before configuring tests, read [Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) and [Testing Durable Objects](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/). If the Cloudflare integration does not support the repo's Vitest 5.1.0, give `runtime/` its own pinned compatible Vitest and its own `vitest.config.ts`; do not change the root Vitest version.
- **Platform-free engine:** files in `shared/world/` import nothing from Cloudflare, Supabase, the DOM, or Node built-ins. Time comes only from the injected `now()`.
- **Constants** (copy exactly; all live in `shared/world/config.ts`):
  - World limit `16`. Grace `20_000` ms. Auth deadline `10_000` ms. Idle limit `600_000` ms. Pending-auth cap `32`.
  - Max message `4096` bytes. Moves above `20` per second per connection are dropped. More than `100` invalid messages in `10_000` ms closes the connection.
  - Courtyard: speed `4.8`, bounds radius `23`, spawn `(0, 0, 4)`, rotation `0`.
  - Room `portal`: name `Portal Partners`, gameType `portal-partners`, min `2`, max `2`, entrance `(-10.5, 0, 0)`, join radius `3.2`. On leaving, the player is placed at the entrance.
  - Arena: speed `4`, `|x| ≤ 9.6`, `|z| ≤ 7.7`, spawns `(-3, 0, 6)` then `(0, 0, 6)`, gap `|z| < 1.25`, bridge `|x| ≤ 1.2`, set-back `z = ±1.35`.
  - Plate `(-5, 3)`, radius `1.3`. Lever `(2, -4)`. Crystal A `(-6, -5)`, crystal B `(6, -5)`. Exit `(0, -7)`, exit radius `2.3`. Interact radius `1.9`. Round `180` s.
  - Movement budget: refills at `1.25 × speed` per second, capped at `speed × 1 + 0.5`; each accepted move spends its horizontal distance. `y` must be in `[0, 3]`.
  - Results retry delays: `5 s, 30 s, 2 min`, then every `10 min`. `persistenceStatus: "failed"` after `1 h` of failures; retries never stop.
- **Error codes** (exact strings): existing `VALIDATION_ERROR`, `UNAUTHORIZED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, plus new `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_LOCKED`, `WORLD_FULL`, `NOT_IN_GAME`, `INVALID_ACTION`, `GAME_NOT_READY`.
- **Token checks:** algorithms allow-list `['ES256', 'RS256']`; `aud === 'authenticated'`; `role === 'authenticated'`; non-empty `sub`; issuer `${SUPABASE_URL}/auth/v1`; clock tolerance `30` s; JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, refetched for an unknown `kid` at most once per `60` s. Every failure gives the same `UNAUTHORIZED` message. Never log tokens, `auth`/`auth.refresh` payloads, or the secret key.
- **Supabase rules:** tables go in the unexposed `private` schema. `anon` and `authenticated` get no table privileges. Functions are `SECURITY DEFINER` with `set search_path = ''`. Revoke `EXECUTE` from `public, anon, authenticated`, then grant explicitly. Error transport is the existing pinned scheme: errcode `PT400`/`PT401`/`PT409`/`PT503`, message = bare code.
- **Secrets:** `runtime/.dev.vars` and `supabase/signing_keys.json` are Git-ignored. Commit only `runtime/.dev.vars.example`.
- **Docs:** every edited project document gets a Change History row dated `11/17/2026` (or the actual date of the edit), per AGENTS.md.
- **Frontend:** do not modify `frontend/`. Ryan wires the UI later (spec §2 non-goals).

## Review Focus

1. **Malformed numbers in messages.** A position with `NaN`, `Infinity`, strings, or missing `z`, or a non-finite rotation, must be rejected with `VALIDATION_ERROR` and change nothing. Owned by Task 2 (parser test).
2. **Taking over from a second tab during a round.** A new connection for a player mid-round must keep the round running with the same position, not cancel it or count as a disconnect. Owned by Task 6.
3. **Both players disconnect during a round.** Whichever comes first ends it: the round times out as a saved loss if the 180 s run out first; otherwise it is cancelled (`disconnected`) when the first grace period expires. Exactly one result either way. Owned by Task 6.
4. **An action arriving just after time-out, before the timer runs.** Every `handle` call processes due timers first, so an exit interaction at 180.05 s is a loss, not a win. Owned by Task 6.
5. **A bad `auth.refresh` on a live connection.** An invalid or garbage refresh token gets `request.error UNAUTHORIZED`, and the connection stays open until the current token expires. A valid token for a different user closes the connection. Owned by Task 9.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `shared/contracts/realtime.ts` | Wire types for every message in §8.2, `RoomSummary`, `GameResult`, and `parseClientMessage` |
| `shared/contracts/types.ts` | New error codes; `PortalClient` gains `connectWorld` and `getMyResults` |
| `shared/world/config.ts` | All constants and the room configuration |
| `shared/world/movement.ts` | Movement budget and per-location validation (pure functions) |
| `shared/world/portal-partners.ts` | Portal Partners round state and rules (pure) |
| `shared/world/world.ts` | The `World` engine: admission, rooms, board, readiness, routing, grace, rounds, outbox |
| `shared/world/index.ts` | Re-exports |
| `runtime/package.json`, `runtime/wrangler.jsonc`, `runtime/tsconfig.json`, `runtime/vitest.config.ts`, `runtime/.dev.vars.example` | Workspace and configuration (local, `dev`, `production` environments) |
| `runtime/src/index.ts` | Worker `fetch`: route, origin and upgrade checks, forward to the World object |
| `runtime/src/auth.ts` | `createTokenVerifier`: JWKS cache plus claim checks |
| `runtime/src/supabase.ts` | `getRuntimeProfile`, `recordResult` over PostgREST with the secret key |
| `runtime/src/world-object.ts` | `WorldObject` Durable Object: sockets, pre-auth, limits, engine bridge, timer |
| `runtime/src/results.ts` | Pending-result storage (SQLite), retry schedule, alarm handling |
| `supabase/migrations/<timestamp>_portal_partners_results.sql` | Results table, participants, three functions, `winsTotal` |
| `supabase/tests/database/05_results.test.sql` | pgTAP for the above |
| `shared/client/world.ts` | Real `WorldConnection` over WebSocket |
| `shared/mocks/world.ts` | Mock `WorldConnection` over an in-process `World` |
| `shared/test/world-contract-suite.ts` | One world contract suite for both |
| `shared/test/runtime-env.ts` | Starts the local runtime for integration tests |

---

### Task 1: Contract and spec documents

**Files:**
- Modify: `doc/component-contract.md` (to v0.7)
- Modify: `doc/initial-spec.md` (to v0.5)
- Already modified on the branch, include in commit: `doc/specs/2026-11-17-runtime-transport-design.md`, `doc/research/runtime-transport.md`, `doc/future-features.md`, this plan

- [ ] **Step 1:** Update the contract to v0.7 exactly as listed in spec §11. Specifically:
  - §1 records the runtime as a Cloudflare Worker plus one World Durable Object (tentative).
  - §2 describes real-time authentication per spec §5.2.
  - §3 adds `cancelled` and `cancelReason` to Result.
  - §4 replaces `GET /api/rooms` with the board on the world connection, and `GET /api/me/results` with `get_my_results`. It also adds the `PortalClient` additions.
  - §5's table is replaced by the message table in spec §8.2, and the new error codes are added.
  - §6 states the grace period and per-game disconnect settings.
  - §7 adopts the saved-cancellation rule.
  - §9's open-decisions list is trimmed accordingly.
  - Add a change-history row.
- [ ] **Step 2:** Update the initial spec to v0.5. In FR-12 and §7/§8, point to the runtime design for the tentative runtime choice, and remove "reconnect slot retention" and "disconnect timing" from the blockers. Keep "First mini-game" wording consistent with Portal Partners being the first networked game (spec §1). Add a change-history row. Do not change requirements beyond those pointers.
- [ ] **Step 3:** Check every relative link in the changed docs resolves:

Run: `grep -o '](\([^)]*\.md[^)]*\))' doc/component-contract.md doc/initial-spec.md doc/specs/2026-11-17-runtime-transport-design.md doc/future-features.md | sed 's/.*](\(.*\))/\1/' | sed 's/#.*//' | sort -u`
Expected: every listed path exists relative to its file. Check by hand with `ls`.

- [ ] **Step 4: Commit**

```bash
git add doc/
git commit -m "docs: runtime design, contract v0.7, and implementation plan"
```

---

### Task 2: Real-time wire types and parser

**Files:**
- Create: `shared/contracts/realtime.ts`, `shared/contracts/realtime.test.ts`
- Modify: `shared/contracts/types.ts` (error codes), `shared/contracts/index.ts` (export)

**Interfaces — Produces** (later tasks use these names exactly):

```ts
export type Vec3 = { x: number; y: number; z: number };
export type RoomId = string;                       // 'lobby' | 'portal' in this release
export type PortalPartnersTarget = 'lever' | 'crystal-a' | 'crystal-b' | 'exit';
export type Outcome = 'win' | 'loss' | 'cancelled';
export type CancelReason = 'left' | 'disconnected';
export type PersistenceStatus = 'pending' | 'saved' | 'failed';
export type CorrectionReason = 'rejected' | 'bridgeClosed';

export interface PlayerCard { id: string; displayName: string; avatarId: AvatarId }
export interface Presence extends PlayerCard {
  position: Vec3 | null; rotation: number; connected: boolean; ready: boolean;
}
export interface RoomSummary {
  id: RoomId; name: string; gameType: 'portal-partners'; minPlayers: number; maxPlayers: number;
  status: 'waiting' | 'playing'; players: PlayerCard[]; sessionId: string | null;
  startedAt: string | null; durationSeconds: number; score: number | null; revision: number;
}
export interface PortalPartnersState {
  bridgeOpen: boolean; latched: boolean; crystals: [boolean, boolean];
  startedAt: string; durationSeconds: number; serverTime: string;
}
export interface GameFinished {
  sessionId: string; outcome: Outcome; score: number;
  persistenceStatus: PersistenceStatus; reason?: CancelReason;
}
export interface RoomSnapshot {
  roomId: RoomId; summary: RoomSummary | null;     // null for the lobby
  players: Presence[]; session: PortalPartnersState & { sessionId: string } | null; revision: number;
}
export interface WorldSnapshot {
  self: { playerId: string; roomId: RoomId; position: Vec3 | null; rotation: number };
  room: RoomSnapshot; board: RoomSummary[]; lastFinished: GameFinished | null;
}

export type ClientMessage =
  | { type: 'auth'; requestId: string; payload: { token: string } }
  | { type: 'auth.refresh'; requestId: string; payload: { token: string } }
  | { type: 'player.move'; requestId?: undefined; payload: { sequence: number; position: Vec3; rotation: number } }
  | { type: 'room.join'; requestId: string; payload: { roomId: RoomId } }
  | { type: 'room.leave'; requestId: string; payload: Record<string, never> }
  | { type: 'game.ready'; requestId: string; payload: { ready: boolean } }
  | { type: 'game.interact'; requestId: string; payload: { sessionId: string; actionId: string; target: PortalPartnersTarget } }
  | { type: 'world.leave'; requestId: string; payload: Record<string, never> };

export type ServerMessage =
  | { type: 'request.accepted'; requestId: string; payload: unknown }
  | { type: 'request.error'; requestId: string | null; error: { code: ErrorCode; message: string } }
  | { type: 'world.snapshot'; payload: WorldSnapshot }
  | { type: 'room.snapshot'; payload: RoomSnapshot }
  | { type: 'player.joined'; payload: { player: Presence; revision: number } }
  | { type: 'player.left'; payload: { playerId: string; reason: 'moved' | 'left' | 'disconnected' | 'idle'; revision: number } }
  | { type: 'player.updated'; payload: { playerId: string; position: Vec3; rotation: number; sequence: number; revision: number } }
  | { type: 'player.connection'; payload: { playerId: string; connected: boolean; revision: number } }
  | { type: 'player.ready'; payload: { playerId: string; ready: boolean; revision: number } }
  | { type: 'player.corrected'; payload: { sequence: number; position: Vec3; rotation: number; reason: CorrectionReason } }
  | { type: 'room.updated'; payload: { room: RoomSummary } }
  | { type: 'game.state'; payload: { sessionId: string; revision: number; state: PortalPartnersState } }
  | { type: 'game.finished'; payload: GameFinished }
  | { type: 'result.saved'; payload: { sessionId: string; resultId: string } }
  | { type: 'session.replaced'; payload: Record<string, never> };

export interface GameResult {
  id: string; sessionId: string; gameType: 'portal-partners'; outcome: Outcome;
  cancelReason: CancelReason | null; score: number; startedAt: string; completedAt: string;
  durationSeconds: number; players: PlayerCard[];
}

export function parseClientMessage(raw: string): Result<ClientMessage>;
```

(`player.ready` is added because readiness needs a room event; record it in the contract's message table in Task 1 if missing.)

- [ ] **Step 1: Write failing tests** in `realtime.test.ts`:
  - `parses each valid client message type`: one valid sample per type round-trips to the same object.
  - `rejects non-finite numbers`: `NaN`, `Infinity` and `"1"` in each of `position.x/y/z`, `rotation` and `sequence` give `{error: {code: 'VALIDATION_ERROR'}}`. JSON cannot carry NaN, so test with `'{"type":"player.move","payload":{"sequence":1,"position":{"x":"NaN",...}}}'` and with `1e400` (which parses to Infinity).
  - `rejects unknown type, missing requestId on commands, extra-long strings`: a `requestId` over 64 characters, a token over 4096 characters, an unknown `target`, and a non-integer or negative `sequence` all give `VALIDATION_ERROR`.
  - `rejects non-JSON and non-object input`: `'nope'`, `'[]'` and `'null'` give `VALIDATION_ERROR`.
  - `ERROR_CODES contains the new codes`: the seven new codes are present.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/contracts/realtime.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `realtime.ts`. `parseClientMessage` checks the structure by hand (no new dependency) and never throws. Add the codes to `ERROR_CODES` in `types.ts`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS, including the existing suites.
- [ ] **Step 5: Commit** `feat(shared): real-time message types and parser`.

---

### Task 3: Engine configuration and movement validation

**Files:**
- Create: `shared/world/config.ts`, `shared/world/movement.ts`, `shared/world/movement.test.ts`, `shared/world/index.ts`

**Interfaces — Produces:**

```ts
// config.ts: every constant from Global Constraints, plus:
export type Location = 'courtyard' | 'arena';
export interface GameRoomConfig { id: RoomId; name: string; gameType: 'portal-partners'; minPlayers: 2; maxPlayers: 2; entrance: Vec3; joinRadius: number }
export interface WorldConfig { worldLimit: number; graceMs: number; idleMs: number; roundMs: number; rooms: GameRoomConfig[] }
// roundMs defaults to 180_000. Only integration tests override it (Task 12), and the runtime
// accepts an override only when SUPABASE_URL is local.
export const DEFAULT_WORLD_CONFIG: WorldConfig;

// movement.ts
export interface MoveTracker { position: Vec3; rotation: number; budget: number; lastAt: number; lastSequence: number }
export function newTracker(position: Vec3, rotation: number, now: number): MoveTracker;
export type Barrier = (from: Vec3, to: Vec3) => boolean;   // true = path blocked
export type MoveCheck =
  | { kind: 'accepted'; tracker: MoveTracker }
  | { kind: 'stale' }                                       // sequence not newer: ignore silently
  | { kind: 'rejected'; tracker: MoveTracker };             // tracker with lastSequence updated
export function checkMove(t: MoveTracker, loc: Location, seq: number, to: Vec3, rotation: number, now: number, barrier?: Barrier): MoveCheck;
export function inBounds(loc: Location, p: Vec3): boolean;
```

- [ ] **Step 1: Write failing tests** in `movement.test.ts`:
  - `accepts a normal walk`: in the courtyard at 10 Hz, 0.48 units per 100 ms for 3 s, every move is accepted.
  - `rejects a teleport after standing still`: after standing 10 s, a move of 6 units is rejected and a move of 5.2 is accepted (cap = 4.8 + 0.5 = 5.3).
  - `tolerates bunched messages`: five moves of 0.48 at the same `now`, after 1 s idle, are all accepted (budget 5.3).
  - `budget refills at 1.25 × speed`: from an empty budget, after 1 s, a move of 6.0 in the courtyard is accepted only if the budget is ≥ 6.0. The budget is capped at 5.3, so this one is rejected. Then after 0.5 s from empty, 3.0 is accepted and 3.1 is rejected.
  - `bounds`: the courtyard rejects radius 23.01. The arena rejects `x = 9.61` and `z = -7.71`. `y = 3.01` and `y = -0.01` are rejected everywhere.
  - `stale sequences`: a sequence ≤ `lastSequence` returns `{kind: 'stale'}`. A rejected move still advances `lastSequence`.
  - `barrier`: when the `barrier` returns true, the move is rejected and the budget is not spent.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/world/movement.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The budget refills by `(now - lastAt) / 1000 × 1.25 × speed`, capped. Distance is measured in `x, z` only.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): config and movement validation`.

---

### Task 4: Portal Partners rules

**Files:**
- Create: `shared/world/portal-partners.ts`, `shared/world/portal-partners.test.ts`

**Interfaces — Consumes:** `Vec3`, `PortalPartnersTarget` (Task 2); constants and `Barrier` (Task 3).
**Produces:**

```ts
export interface PPRound {
  sessionId: string; playerIds: [string, string]; startedAt: number;
  latched: boolean; crystals: [boolean, boolean]; ended: boolean;
  actionResults: Map<string, InteractResult>;     // by actionId, for duplicates
}
export type InteractResult = { ok: true } | { ok: false; code: 'INVALID_ACTION' | 'NOT_IN_GAME'; message: string };
export function startRound(sessionId: string, playerIds: [string, string], now: number): PPRound;
export function spawnPositions(): [Vec3, Vec3];
export function bridgeOpen(r: PPRound, positions: Vec3[]): boolean;       // all characters incl. disconnected
export function arenaBarrier(r: PPRound, positions: Vec3[]): Barrier;     // gap rule from spec §6.2
export function interact(r: PPRound, playerId: string, actionId: string, target: PortalPartnersTarget,
  positions: Map<string, Vec3>, connected: Map<string, boolean>): InteractResult & { won?: boolean };
export function setBack(position: Vec3, lastOutside: Vec3): Vec3;          // z = ±1.35, keeps x
export function score(r: PPRound): number;                                  // crystals collected
export function timeUp(r: PPRound, now: number, roundMs: number): boolean;  // now - startedAt >= roundMs
```

- [ ] **Step 1: Write failing tests** (ported from `frontend/games/rules.test.mjs` and adapted to one character per player):
  - `bridge closed blocks the gap`: a path from `(0,0,2)` to `(0,0,0)` is blocked with nobody on the plate.
  - `plate opens the bridge, only within |x| ≤ 1.2`: with one player at `(-5,0,3)`, `(0,0,2) → (0,0,0)` is allowed and `(3,0,2) → (3,0,0)` is blocked.
  - `lever latches`: an interaction within 1.9 of `(2,-4)` sets `latched`. The bridge then stays open with the plate empty. An interaction from 2.0 away gives `INVALID_ACTION`.
  - `crystals and score`: collecting A then B gives score 2. Collecting A again gives `INVALID_ACTION`.
  - `exit needs crystals, both players within 2.3, and both connected`: each missing condition gives `INVALID_ACTION`. When all are met, it returns `won: true` and sets `ended`.
  - `duplicate actionId returns the first result and has no effect`.
  - `setBack`: from the positive side, `(0.5, 0, 0.3)` with `lastOutside.z = 2` becomes `(0.5, 0, 1.35)`. From the negative side it becomes `z = -1.35`.
  - `timeUp at exactly 180 s`.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/world/portal-partners.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `arenaBarrier` blocks a path if any point on the straight segment (sample at most every `0.1` units) has `|z| < 1.25` while the bridge is closed or `|x| > 1.2`. Paths that start inside the gap are judged the same way.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): Portal Partners rules`.

---

### Task 5: World engine — admission, rooms, board, movement

**Files:**
- Create: `shared/world/world.ts`, `shared/world/world.test.ts`, `shared/world/test-helpers.ts`

**Interfaces — Consumes:** Tasks 2–4. **Produces:**

```ts
export type ConnId = string;
export interface Outgoing { to: ConnId; message: ServerMessage }
export interface Closing { conn: ConnId; reason: 'WORLD_FULL' | 'session.replaced' | 'idle' | 'left' }
export interface FinishedRound {
  sessionId: string; playerIds: [string, string]; outcome: Outcome; cancelReason: CancelReason | null;
  score: number; startedAt: string; completedAt: string;
}
export interface WorldOptions { now: () => number; newId: () => string; config?: WorldConfig }
export class World {
  constructor(opts: WorldOptions);
  admit(conn: ConnId, player: PlayerCard): Result<null>;        // WORLD_FULL; restore from grace; take over an existing connection
  handle(conn: ConnId, msg: Exclude<ClientMessage, { type: 'auth' | 'auth.refresh' }>): void;
  connectionLost(conn: ConnId): void;                             // unexpected: starts grace
  advance(): void;                                                // runs due timers (grace, round time-out, idle)
  takeOutbox(): Outgoing[];
  takeClosings(): Closing[];
  takeFinishedRounds(): FinishedRound[];
  needsTimer(): boolean;                                          // true while any player holds a slot
  slotsUsed(): number;
}
```

Rules: `handle` and `admit` call `advance()` first. Replies to commands go to the outbox as `request.accepted` (payload: the `RoomSnapshot` for `room.join`/`room.leave`, otherwise `null`) or `request.error`. Revisions increase per room (the lobby is its own room). `test-helpers.ts` exports `makeWorld()`, which returns a `World` with a controllable clock (`advanceBy(ms)`) and sequential ids, plus `messagesFor(conn)`.

- [ ] **Step 1: Write failing tests** in `world.test.ts`:
  - `admits 16 and rejects the 17th with WORLD_FULL`: the 17th `admit` returns an error, and nothing is sent to the other 16.
  - `admission sends world.snapshot`: the player is at spawn `(0,0,4)` in the lobby with all boards. The other lobby players get `player.joined`.
  - `join checks in order`: `ROOM_NOT_FOUND`, then `INVALID_ACTION` (already in a room, then too far at 3.3 from `(-10.5,0,0)`), then `ROOM_LOCKED`, then `ROOM_FULL`. After each failure the player's room and position are unchanged, and nobody else receives anything.
  - `join and leave keep the slot`: `slotsUsed()` is unchanged. Leaving places the player at `(-10.5,0,0)`. Lobby players see `player.left {reason:'moved'}` then `player.joined`.
  - `board`: every admitted player gets `room.updated` on join, leave, and ready-state changes that affect status. Waiting rooms report `score: null`. Players carry only `id, displayName, avatarId`.
  - `movement routing`: an accepted move goes as `player.updated` to the others in the same room only, not echoed back. A rejected move gets `player.corrected {reason:'rejected'}` with the last accepted position. A move in a waiting room is rejected.
  - `readiness`: `game.ready` in the lobby gives `GAME_NOT_READY`. Ready resets for everyone when anyone joins or leaves.
  - `world.leave frees the slot at once`: there is no grace, the closing reason is `'left'`, and a 17th player can then be admitted.
  - `takeover`: a second `admit` for the same player id on a new conn closes the old conn with `'session.replaced'` (preceded by `session.replaced` to it). The slot count stays the same, and the location and position are kept.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/world/world.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the parts of `World` these tests need. Leave rounds, grace and idle to Task 6, but keep the `advance()` hook.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): admission, rooms, board, movement routing`.

---

### Task 6: World engine — rounds, grace, cancellation, idle

**Files:**
- Modify: `shared/world/world.ts`, `shared/world/world.test.ts` (or a new `world-rounds.test.ts`)

**Interfaces:** as in Task 5. `game.finished` from the engine always carries `persistenceStatus: 'pending'`. Every win, loss and cancellation also appears once in `takeFinishedRounds()`.

- [ ] **Step 1: Write failing tests:**
  - `two ready players start exactly one round`: readying in either order, and readying again while playing, give one `sessionId`. Players are placed at `(-3,0,6)` and `(0,0,6)` in join order. Both get `game.state`. The board shows `playing` with `startedAt` and `durationSeconds: 180`.
  - `a third player gets ROOM_LOCKED but sees the score on the board` (AC-04).
  - `game.state at least once per second`: after `advanceBy(1000)` and `advance()`, each participant has received a new `game.state`.
  - `win`: a scripted run of plate, cross, lever, both crystals and both at the exit gives `game.finished {outcome:'win', score:2}` to both and one `FinishedRound`. The room returns to `waiting` with ready reset and both still inside.
  - `loss by time-out`: after 180 s, the outcome is `loss`, finished within one `advance()` call of crossing 180 000 ms.
  - `late interaction is a loss` (Review Focus 4): at 180 050 ms, an exit interaction meeting all conditions, with no `advance()` in between, gives a loss.
  - `bridge closes under a player`: player 1 on the plate, player 2 at `(0,0,0.5)` having entered from `z > 0`. Player 1 steps off, and player 2 gets `player.corrected {reason:'bridgeClosed', position:{x:0,y:0,z:1.35}}`. Player 1 sees `player.updated`. The same happens to a disconnected character in the gap.
  - `leave cancels`: `room.leave` or `world.leave` during a round gives `cancelled` with reason `left` to the remaining player, and a `FinishedRound` with `cancelReason:'left'`.
  - `grace keeps the round running`: on disconnect, others get `player.connection {connected:false}`. The disconnected character still holds the plate. Reconnecting at 19 999 ms restores the exact position, rotation and round, sends `world.snapshot`, and tells the others `connected:true`.
  - `grace expiry cancels`: at 20 000 ms, the outcome is `cancelled` with reason `disconnected`, the slot is freed, and others see `player.left {reason:'disconnected'}`.
  - `exit needs both connected`: the exit gives `INVALID_ACTION` while the partner is in grace.
  - `takeover mid-round is not a disconnect` (Review Focus 2): a new `admit` for a playing player keeps the round, sends no `player.connection` events, and produces no `FinishedRound`.
  - `both disconnect` (Review Focus 3): case (a) both drop at 170 s, and the round times out at 180 s as a single `loss`. Case (b) both drop at 10 s, and the round is cancelled at 30 s, with a single `FinishedRound`.
  - `reconnect after the round ended`: the snapshot's `lastFinished` holds the outcome.
  - `idle limit`: a player with no handled message for 600 000 ms gets a closing with reason `'idle'`, the slot is freed immediately, and there is no grace.
  - `lobby grace`: a lobby player who drops keeps their slot for 20 s, and a 17th player is rejected during that time.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/world`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement. Choose the `sessionId` with `newId()`. Timestamps in messages and `FinishedRound` are ISO strings from `now()`.
- [ ] **Step 4:** Run `npx vitest run --project unit shared/world && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): rounds, reconnect grace, cancellation, idle limit`.

---

### Task 7: Supabase — signing keys, results, functions

**Files:**
- Modify: `supabase/config.toml` (`[auth] signing_keys_path = "./signing_keys.json"`), `.gitignore` (`supabase/signing_keys.json`), `package.json` (script `db:keys`), `.github/workflows/ci.yml` (generate keys before `supabase start`), `doc/checklists/supabase-hosted-setup.md` (note: local only; hosted dev already uses asymmetric keys)
- Create: `supabase/migrations/<timestamp>_portal_partners_results.sql` (create with `npx supabase migration new portal_partners_results`), `supabase/tests/database/05_results.test.sql`

**Interfaces — Produces** (called by Task 9/10 and the client):

```sql
private.portal_partners_results(
  id uuid pk default gen_random_uuid(), session_id uuid unique not null,
  outcome text check (outcome in ('win','loss','cancelled')),
  cancel_reason text check ((outcome = 'cancelled') = (cancel_reason in ('left','disconnected'))),
  score smallint check (score between 0 and 2), started_at timestamptz, completed_at timestamptz,
  check (completed_at >= started_at))
private.portal_partners_participants(result_id uuid fk, player_id uuid fk -> private.profiles(id),
  primary key (result_id, player_id)), index on (player_id)

public.get_runtime_profile(player_id uuid) returns jsonb       -- {id, displayName, avatarId}; PT503 if none
public.record_portal_partners_result(session_id uuid, player_ids uuid[], outcome text,
  cancel_reason text, score int, started_at timestamptz, completed_at timestamptz) returns jsonb  -- {resultId}
public.get_my_results(result_limit int default 20, page_cursor text default null) returns jsonb
  -- {results: GameResult[], nextCursor: string|null}; newest first by (completed_at, id)
```

The first two are executable by `service_role` only; `get_my_results` by `authenticated` only. `private.profile_json` is replaced (`create or replace`, now `stable`) so `winsTotal` counts the player's `win` rows. The `db:keys` script runs `supabase gen signing-key --algorithm ES256 > supabase/signing_keys.json`, only if the file is absent.

- [ ] **Step 1:** Generate keys and restart the stack: `npm run db:keys && npx supabase stop && npx supabase start`. Then run `npm run test:integration`. Expected: the existing suites still PASS with asymmetric signing. Confirm with `curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json` that it lists one `ES256` key.
- [ ] **Step 2: Write failing pgTAP** `05_results.test.sql`:
  - Privileges: `anon` and `authenticated` cannot select the two tables or execute the two runtime functions. `authenticated` can execute `get_my_results`.
  - `record_portal_partners_result` inserts once. A second call with the same `session_id` returns the same `resultId` and leaves one row.
  - Validation (each raises `PT400`): one player, the same player twice, an unknown player, an outcome `'draw'`, a cancelled outcome without a reason, a win with a reason, score 3, and completion before start.
  - `get_runtime_profile` returns the three keys, and raises `PT503` for an unknown id.
  - `winsTotal`: two wins, one loss and one cancellation give `get_me()->>'winsTotal' = '2'` for each participant. A third player with no results gets 0.
  - `get_my_results`: it returns only the caller's rows (including the cancellation), newest first, with `players` holding both cards. `limit` 1 gives a `nextCursor`, and following it returns the next row. `result_limit` of 0 or 51 raises `PT400`. A signed-out caller raises `PT401`.
- [ ] **Step 3:** Run `npm run test:db`. Expected: `05_results` FAILS.
- [ ] **Step 4:** Write the migration. The cursor is an opaque string encoding `completed_at` and `id`; a malformed cursor raises `PT400`.
- [ ] **Step 5:** Run `npx supabase db reset && npm run test:db && npx supabase db advisors --type security --fail-on warn`. Expected: PASS, with no warnings.
- [ ] **Step 6: Commit** `feat(db): Portal Partners results, runtime functions, wins, local signing keys`.

---

### Task 8: Runtime workspace and token verification

**Files:**
- Create: `runtime/package.json` (`@portal-playhouse/runtime`), `runtime/tsconfig.json`, `runtime/wrangler.jsonc`, `runtime/vitest.config.ts`, `runtime/.dev.vars.example`, `runtime/src/auth.ts`, `runtime/test/auth.test.ts`, `runtime/src/index.ts` (stub returning 404)
- Modify: root `package.json` (add `runtime` to `workspaces`; scripts `test:runtime`, `runtime:dev`), root `tsconfig.json` if `runtime/` needs separate typechecking, `.gitignore` (`runtime/.dev.vars`, `.wrangler/`)

**Configuration:**
- `wrangler.jsonc`: `name: "portal-runtime-local"`, `main: "src/index.ts"`, a current `compatibility_date`, a Durable Object binding `WORLD` → class `WorldObject`, migration `{tag: "v1", new_sqlite_classes: ["WorldObject"]}`.
- Vars: `SUPABASE_URL = "http://127.0.0.1:54321"` and `ALLOWED_ORIGINS = "http://127.0.0.1:4173,http://localhost:4173"`.
- `env.dev`: name `portal-runtime-dev`, plus its own vars, which Adam fills in Task 12 with placeholders.
- `env.production`: name `portal-runtime-production`, placeholders only.
- The secret `SUPABASE_SECRET_KEY` comes from `.dev.vars` locally, and from `wrangler secret put` per hosted environment.

**Interfaces — Produces:**

```ts
export interface VerifiedIdentity { playerId: string; expiresAt: number }  // ms
export interface TokenVerifier { verify(token: string): Promise<Result<VerifiedIdentity>> }  // error always UNAUTHORIZED, same message
export function createTokenVerifier(opts: { supabaseUrl: string; fetch?: typeof fetch; now?: () => number }): TokenVerifier;
```

Use `jose`: `createRemoteJWKSet(jwksUrl, { cooldownDuration: 60_000, [customFetch]: opts.fetch })` and `jwtVerify(token, jwks, { algorithms: ['ES256','RS256'], issuer, audience: 'authenticated', clockTolerance: 30 })`, then check `role === 'authenticated'` and a non-empty `sub`.

- [ ] **Step 1:** Install `wrangler`, `@cloudflare/vitest-pool-workers` (or its current successor) and `@cloudflare/workers-types` as pinned dev dependencies of `runtime`, and `jose` as a pinned dependency. Follow the Cloudflare "Write your first test" page for `vitest.config.ts`. Run `npm run test:runtime` with one trivial test. Expected: PASS inside the Workers runtime.
- [ ] **Step 2: Write failing tests** in `auth.test.ts`. Generate an ES256 key pair with `jose` in the test, serve its JWKS through an injected `fetch` that counts calls, and sign tokens.
  - A valid token gives `playerId === sub` and `expiresAt`.
  - Each of these gives `UNAUTHORIZED` with an identical message: wrong issuer, `aud: 'anon'`, `role: 'anon'`, `role: 'service_role'`, missing `sub`, expired by 31 s, an `alg: 'none'` token, an HS256 token, a bad signature, and garbage.
  - A token expired by 29 s passes (tolerance).
  - Unknown-`kid` tokens sent 10 times within 60 s cause at most 1 refetch after the initial fetch.
- [ ] **Step 3:** Run `npm run test:runtime`. Expected: FAIL.
- [ ] **Step 4:** Implement `auth.ts`.
- [ ] **Step 5:** Run `npm run test:runtime && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(runtime): workspace and Supabase token verification`.

---

### Task 9: World Durable Object and Worker routing

**Files:**
- Create: `runtime/src/world-object.ts`, `runtime/src/supabase.ts`, `runtime/test/world-object.test.ts`, `runtime/test/helpers.ts`
- Modify: `runtime/src/index.ts`

**Interfaces — Consumes:** `World` (Task 5/6), `createTokenVerifier` (Task 8), `parseClientMessage` (Task 2), Supabase functions (Task 7). **Produces:**

```ts
// supabase.ts
export interface SupabaseServer {
  getRuntimeProfile(playerId: string): Promise<Result<PlayerCard>>;               // SERVICE_UNAVAILABLE on any failure
  recordResult(r: FinishedRound): Promise<Result<{ resultId: string }>>;
}
export function createSupabaseServer(opts: { url: string; secretKey: string; fetch?: typeof fetch }): SupabaseServer;
// POST {url}/rest/v1/rpc/<fn> with headers apikey: secretKey, Content-Type: application/json.

// index.ts: GET /connect with Upgrade: websocket and Origin in ALLOWED_ORIGINS
//   -> env.WORLD.getByName('world').fetch(request); otherwise 403 (origin) / 426 (no upgrade) / 404.
export class WorldObject extends DurableObject<Env> { fetch(request: Request): Promise<Response> }
```

Decisions:
- Use the standard WebSocket API (`server.accept()`), not hibernation. Open sockets keep the object in memory, which satisfies the "nothing lost while players are present" requirement in spec §5.6.
- While `world.needsTimer()` is true, a `setInterval` of 100 ms calls `world.advance()` and flushes. Clear the interval when it becomes false.
- After every engine call, flush `takeOutbox()` (send JSON), then `takeClosings()` (close with code 1000 and the reason), then hand `takeFinishedRounds()` to Task 10's store.
- Per connection: an auth-deadline timer, the token's `expiresAt` timer (close with `UNAUTHORIZED`, then `world.connectionLost`), a move token bucket (20/s, silent drop), and an invalid-message counter (100 per 10 s closes the connection).
- Messages over 4096 bytes and parse failures get `request.error VALIDATION_ERROR` (with `requestId: null` when unknown).
- Log only the player ID and error codes.
- `auth.refresh`: a valid token for the same user updates the expiry and replies `request.accepted`. An invalid token replies `UNAUTHORIZED` and keeps the connection. A valid token for another user replies `UNAUTHORIZED` and closes.

- [ ] **Step 1: Write failing tests** in `world-object.test.ts`, using `SELF.fetch` WebSockets, a test JWKS served by a stub (inject through an env var such as `TEST_JWKS` or a fetch mock, per the Cloudflare test docs), and a stubbed `SupabaseServer` returning fixed profiles:
  - The Worker returns 403 for a disallowed Origin, 426 without Upgrade, and 404 for other paths.
  - No `auth` within 10 s closes with `UNAUTHORIZED`. Use fake timers or a test-only shorter deadline injected through the environment.
  - A non-`auth` first message gives `UNAUTHORIZED` and closes.
  - The 33rd pending connection is closed with `SERVICE_UNAVAILABLE`.
  - Valid auth gives `world.snapshot`.
  - A missing profile and a Supabase outage each give `SERVICE_UNAVAILABLE` and close.
  - A 5000-byte message gives `VALIDATION_ERROR`.
  - 30 moves in one second relay at most 20.
  - 101 invalid messages close the connection.
  - Refresh behaviour (Review Focus 5): all three refresh cases above.
  - Token expiry: closes the connection and starts grace (the slot is still held).
  - Two sockets: player A's accepted move reaches B as `player.updated`.
  - Logs: with `console` captured, no log line contains the token string.
- [ ] **Step 2:** Run `npm run test:runtime`. Expected: FAIL.
- [ ] **Step 3:** Implement `supabase.ts`, `world-object.ts` and `index.ts`.
- [ ] **Step 4:** Run `npm run test:runtime && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runtime): World Durable Object, connection lifecycle, limits`.

---

### Task 10: Exactly-once result saving

**Files:**
- Create: `runtime/src/results.ts`, `runtime/test/results.test.ts`
- Modify: `runtime/src/world-object.ts` (constructor creates the table; `alarm()` delegates; finished rounds go to the store)

**Interfaces — Produces:**

```ts
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];   // then 600_000 forever
export const FAILED_AFTER_MS = 3_600_000;
export class PendingResults {
  constructor(sql: SqlStorage, setAlarm: (at: number) => Promise<void>, now: () => number);
  add(r: FinishedRound): void;                       // durable insert BEFORE game.finished is flushed
  due(): FinishedRound[];
  markSaved(sessionId: string): void;                // delete row
  markFailed(sessionId: string): { failedStatusReached: boolean };  // schedule next attempt
  nextAlarmAt(): number | null;
}
```

Flow:
1. On finish, call `add`, then flush `game.finished` (pending), then attempt the save immediately (not awaited inside the engine call).
2. On success, `markSaved` and send `result.saved` to participants who are connected.
3. On failure, `markFailed`. When `failedStatusReached` is first true, send `game.finished` again with `persistenceStatus: 'failed'` to connected participants.
4. `alarm()` retries everything that is `due()`, then re-arms.
5. The constructor (`blockConcurrencyWhile`) creates the table and re-arms the alarm if rows exist.

- [ ] **Step 1: Write failing tests** in `results.test.ts`:
  - The pending row exists before `game.finished` is sent. Assert through the SQLite table, using the Durable Object test helpers for direct instance access.
  - A first-try success deletes the row and participants get `result.saved`.
  - Failure, failure, then success follows the schedule 5 s then 30 s. Trigger alarms with the documented test helper and an injected clock.
  - After 1 h of failures, connected participants get `persistenceStatus: 'failed'` exactly once, and retries continue every 10 min.
  - Restart survival: rows written, the instance recreated (per the test API), and the alarm fires and saves.
  - A duplicate save of the same session (simulate a lost response) results in one `recordResult` success and no duplicate messages.
- [ ] **Step 2:** Run `npm run test:runtime`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:runtime && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runtime): durable exactly-once result saving with retries`.

---

### Task 11: Client and mock world connections, contract suite

**Files:**
- Create: `shared/client/world.ts`, `shared/mocks/world.ts`, `shared/test/world-contract-suite.ts`, `shared/test/mock.world.contract.test.ts`
- Modify: `shared/contracts/types.ts` (interface), `shared/client/index.ts` (config `runtimeUrl?: string`; methods), `shared/mocks/index.ts` (`MockStore` gains `world: World`; methods; `createMockPlayers`)

**Interfaces — Produces** (in `shared/contracts/types.ts`):

```ts
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type ServerEventType = Exclude<ServerMessage['type'], 'request.accepted' | 'request.error'>;
export type ServerEventPayload<K extends ServerEventType> = Extract<ServerMessage, { type: K }>['payload'];
export interface WorldConnection {
  readonly playerId: string;
  readonly state: ConnectionState;
  snapshot(): WorldSnapshot;                                  // latest, kept current by the client
  joinRoom(roomId: RoomId): Promise<Result<RoomSnapshot>>;
  leaveRoom(): Promise<Result<RoomSnapshot>>;
  setReady(ready: boolean): Promise<Result<null>>;
  interact(target: PortalPartnersTarget): Promise<Result<null>>;  // fills sessionId and a fresh actionId
  leaveWorld(): Promise<Result<null>>;                         // also called by signOut() when connected
  sendMove(position: Vec3, rotation: number): void;            // sequence managed internally
  on<K extends ServerEventType>(type: K, cb: (p: ServerEventPayload<K>) => void): () => void;
  onConnectionState(cb: (s: ConnectionState) => void): () => void;
}
// PortalClient gains:
connectWorld(): Promise<Result<WorldConnection>>;              // resolves after the first world.snapshot
getMyResults(input?: { limit?: number; cursor?: string }): Promise<Result<{ results: GameResult[]; nextCursor: string | null }>>;
// mocks: export function createMockPlayers(store: MockStore, count: number): Promise<WorldConnection[]>;
```

Real client behavior:
- Uses `runtimeUrl` (missing → `SERVICE_UNAVAILABLE`).
- Sends `auth` with the current access token.
- Refreshes via `supabase.auth.refreshSession()` 60 s before `exp`, then sends `auth.refresh`.
- Request timeout 10 s → `SERVICE_UNAVAILABLE`.
- On an unexpected close, reconnects at 0.5 s, 1 s, 2 s, 4 s and 8 s, inside the 20 s grace, with state `reconnecting`. After that the state is `closed`.
- No reconnect after `session.replaced`, `world.leave`, idle or `WORLD_FULL`.

The mock runs `store.world`, with a real clock and a 100 ms `setInterval` while `needsTimer()`. It honours the same commands and events, and adds a test hook, `store.world` access.

- [ ] **Step 1: Write the failing world contract suite** `world-contract-suite.ts`. Its factory is `{ newSignedInClient(): Promise<PortalClient> }`. Run it against the mock in `mock.world.contract.test.ts`. Cases:
  - Connect and get a snapshot.
  - Two clients see each other move.
  - `ROOM_NOT_FOUND` and too-far join errors.
  - Join, ready and start for both; the board updates on a third client.
  - The third client gets `ROOM_LOCKED`.
  - Leaving cancels, and the remaining player gets `cancelled` / `left`.
  - `leaveWorld` frees the slot.
  - `interact` with no round gives `NOT_IN_GAME`.
  - A full scripted win (moves within budget along a path through the plate/lever/crystals/exit, using the arena constants) gives `game.finished` win, then `result.saved` (mock: immediate), then `getMyResults` shows it and `getMe().winsTotal` is 1.
  Also, mock-only in `mock.world.contract.test.ts`: `createMockPlayers(store, 3)` gives three connected lobby players that a fourth client sees in its snapshot.
- [ ] **Step 2:** Run `npx vitest run --project unit shared/test/mock.world.contract.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the mock world (`shared/mocks/world.ts`). The mock records results in memory and makes `winsTotal` and `getMyResults` real.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS, and the existing profile contract suite still passes.
- [ ] **Step 5:** Implement the real client's `shared/client/world.ts` and `getMyResults` (rpc `get_my_results`). Add a unit test with an injected fake `WebSocket` for the reconnect schedule and "no reconnect after `session.replaced`".
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(shared): world connection for real client and mock, contract suite`.

---

### Task 12: Integration, CI, hosted checklist

**Files:**
- Create: `shared/test/runtime-env.ts`, `shared/test/real.world.contract.integration.test.ts`, `shared/test/real.world.integration.test.ts`, `doc/checklists/cloudflare-hosted-setup.md`
- Modify: `.github/workflows/ci.yml`, `runtime/.dev.vars.example`, `README.md` (local runtime instructions), `doc/future-features.md` only if new deferrals appear

`runtime-env.ts` starts the Worker once per integration file with wrangler's programmatic API. Check the current name (`unstable_startWorker` or its successor) in the wrangler docs. Vars point at the local Supabase from `getLocalSupabaseEnv()`, with the secret key from it, and the Origin set to `http://127.0.0.1:4173`. It returns `runtimeUrl` and refuses non-local Supabase URLs (`assertLocalUrl`).

- [ ] **Step 1: Write the failing integration tests:**
  - The world contract suite against the real client, with accounts from `scripts/create-test-accounts.ts`.
  - `real.world.integration.test.ts`:
    - A win and a loss (the loss uses a runtime var `ROUND_MS` of 3000, honoured only when `SUPABASE_URL` is local) each produce one row via `get_my_results`. The winner's `winsTotal` increases by exactly 1 for both players.
    - A cancellation appears in history with reason `left`.
    - Dropping a socket and reconnecting within 20 s restores the exact position.
    - 17 concurrent connects admit exactly 16.
    - Two players readying in the same tick start one round.
    - Stopping Supabase's REST (or pointing the secret at a bad key) and then restoring it causes a pending save to complete once.
- [ ] **Step 2:** Run `npm run test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement `runtime-env.ts` and fix any integration gaps it exposes. Gaps in earlier tasks get a unit test in their own task's file too.
- [ ] **Step 4:** Run `npm run test:integration`. Expected: PASS.
- [ ] **Step 5:** Update CI:
  - `npm run db:keys` before `supabase start`.
  - Add `npm run test:runtime` after the unit tests.
  - Integration tests start the runtime themselves.
  - Keep `realtime` excluded; the runtime does not use Supabase Realtime.
- [ ] **Step 6:** Write `doc/checklists/cloudflare-hosted-setup.md` (with a Change History) for Adam:
  1. `npx wrangler login`.
  2. Fill in `env.dev` vars: `SUPABASE_URL` (hosted dev) and `ALLOWED_ORIGINS` (the Vercel dev URL, plus `http://127.0.0.1:4173` for local frontend testing against the dev runtime).
  3. `npx wrangler secret put SUPABASE_SECRET_KEY --env dev` with the hosted dev secret key.
  4. Apply the new migration to hosted dev (per `doc/checklists/supabase-hosted-setup.md`).
  5. `npx wrangler deploy --env dev`.
  6. Smoke check (spec §10).
  7. Record the dev runtime URL for Ryan.
  8. Production: not until launch, with explicit authorization.
- [ ] **Step 7:** Run the full local suite: `npm run typecheck && npm test && npm run test:runtime && npm run test:db && npm run test:integration && npx supabase db advisors --type security --fail-on warn`. Expected: all PASS. Record the actual counts in the PR description.
- [ ] **Step 8: Commit** `test: runtime integration, CI, hosted setup checklist`.

---

## Verification (whole branch)

- Every command in Task 12, Step 7 passes locally, and CI is green on the pull request.
- Adam completes the Cloudflare hosted checklist and the manual smoke check on hosted dev, and records the result in the PR.
- The load check (spec §10) is deferred to integration testing with Ryan's frontend. Do not claim capacity results until it is run.
- The PR description lists: checks run and their counts, the deferred load check, the accepted limitations (shortcuts through lobby furniture, live state lost on restart, tokens valid until expiry after sign-out), and items for Ryan (spec §12).
