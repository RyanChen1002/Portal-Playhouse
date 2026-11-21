# Load Check Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.1

**Date:** 11/21/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/21/2026 | Added the initial implementation plan for the load-check design. |

**Goal:** A `tsx` script that connects 2 or 16 real clients to the runtime, has some of them walk around the lobby at 10 or 20 Hz, and reports message rates, move delivery delay, problems, generator health, and the free-tier projection.

**Architecture:** Pure pieces (random walk, statistics, report text, argument parsing) are separate modules with unit tests. A `Meter` sits inside each client's socket through a wrapping `SocketLike`, so it counts exactly what goes over the wire and matches each sent `player.move` to the `player.updated` other clients receive (by player and `sequence`). A runner connects the clients, drives the walkers for the scenario's duration, and turns the meter's counts into a report. The CLI picks local mode (starts the local runtime and test accounts) or hosted-dev mode (env vars, plus-address users).

**Tech Stack:** TypeScript, Node 22 (`node:perf_hooks`, global `WebSocket`), `tsx`, Vitest, the existing `createPortalClient`, `startLocalRuntime`, `createTestAccounts`, and the engine's `checkMove`. No new dependencies.

**Spec:** [doc/specs/2026-11-21-load-check-design.md](../specs/2026-11-21-load-check-design.md), approved by Adam on 11/21/2026. Read it first. Background: [runtime design](../specs/2026-11-17-runtime-transport-design.md) §5.4 (movement) and §10 (load row), [research](../research/runtime-transport.md) §6.2 (estimates).

**Start condition:** work on `feature/load-check` (already created from `dev`).

## Global Constraints

- No new dependencies. Node `>=22 <23`.
- Scenarios exactly: `baseline` = 2 players, 2 moving; `full` = 16 players, 16 moving; `quarter` = 16 players, 4 moving. All players stay in the lobby (courtyard).
- Rate default 10 Hz; allowed 1 to 20 (the client throttles at 20 sends per second). Duration default 60 s per scenario.
- Free-tier projection: `100_000` requests per day, `20` incoming WebSocket messages per request (research §6.2). Hours per day = `100_000 × 20 / (incomingPerSec × 3600)`.
- Walk speed about 4 units/s (courtyard limit 4.8, radius 23). Walk stays within radius 20.
- Local mode refuses a non-local Supabase URL (`assertLocalUrl`). Hosted mode requires `--hosted`, prints both hosts before connecting, and refuses any Supabase or runtime host containing `production`.
- Agents never run hosted mode, `wrangler`, or anything with `--remote`. Hosted runs are Adam's.
- No passwords, keys, or tokens in the repository or in output. The hosted password comes from `LOAD_PASSWORD`.
- Documentation edits get a Change History row (MM/DD/YYYY, one row per date, newest first).

## Review Focus

- **Pointing hosted mode at the wrong place.** A `production` host in `SUPABASE_URL` or `RUNTIME_URL` must stop the run before anything connects (Task 5 `parseArgs` tests).
- **Walker moves the server rejects** because timers bunch up. Every walk step must pass `checkMove`, including with uneven 50/150 ms gaps (Task 1 test).
- **A slow load generator mistaken for a slow server.** Event-loop p99 above 50 ms must produce a warning (Task 2 `warningsFor` test).
- **Moves that silently never arrive.** Delivery ratio below 0.99 must produce a warning (Task 2 `warningsFor` test).
- **A client that cannot connect** (for example a wrong password or `WORLD_FULL`). The scenario must stop with a message naming the error code, not report numbers for fewer players (Task 4 integration test).

---

### Task 1: Random walk

**Files:**
- Create: `scripts/load-check/walker.ts`
- Test: `scripts/load-check/walker.test.ts`

**Interfaces:**
- Produces: `createWalker(start: Vec3, stepLength: number, random?: () => number): Walker` and `interface Walker { next(): { position: Vec3; rotation: number } }`. `WALK_SPEED = 4`, `WALK_RADIUS = 20`. Step length for a rate is `WALK_SPEED / rateHz`.

- [ ] **Step 1: Write the failing tests**

```ts
// 'every step is accepted by the engine at 10 Hz'
//   tracker = newTracker(COURTYARD_SPAWN, 0, 0, 'courtyard'); walker = createWalker(COURTYARD_SPAWN, WALK_SPEED / 10, seeded(1))
//   for 5_000 steps, now += 100, seq++: checkMove(...).kind === 'accepted'
// 'every step is accepted with uneven 50/150 ms gaps at 20 Hz' (alternate now += 50 / 150, step WALK_SPEED / 20)
// 'stays within WALK_RADIUS' (Math.hypot(x, z) <= 20 for every step, 5_000 steps)
// 'moves each step by stepLength' (distance between consecutive positions ≈ stepLength, 1e-9), y === 0
// 'rotation is the heading' (rotation === Math.atan2(dx, dz) of the step)
// seeded(n): a small deterministic PRNG defined in the test file (e.g. mulberry32).
```

- [ ] **Step 2: Run** `npx vitest run --project unit scripts/load-check/walker.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `walker.ts`. Heading wanders by a small random turn each step (up to ±0.4 rad). If the next point would leave `WALK_RADIUS`, turn the heading toward the centre before stepping. `random` defaults to `Math.random`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(load-check): random walk accepted by the movement rules`.

### Task 2: Statistics, warnings, and report text

**Files:**
- Create: `scripts/load-check/report.ts`
- Test: `scripts/load-check/report.test.ts`

**Interfaces:**
- Produces:
  - `percentile(values: number[], p: number): number | null`, nearest-rank, on an unsorted copy; `null` for an empty list.
  - `freeTierHoursPerDay(incomingPerSec: number): number | null`, using the Global Constraints formula; `null` when the rate is 0.
  - `interface ScenarioReport { name: string; players: number; movers: number; rateHz: number; startedAt: string; endedAt: string; seconds: number; sent: number; received: number; incomingPerSec: number; outgoingPerSec: number; delayMs: { p50: number | null; p95: number | null; max: number | null; count: number }; expectedDeliveries: number; deliveryRatio: number | null; corrections: number; requestErrors: number; reconnects: number; eventLoopMs: { p99: number; max: number }; freeTierHoursPerDay: number | null; warnings: string[] }`
  - `warningsFor(r: Omit<ScenarioReport, 'warnings'>): string[]`
  - `formatReport(r: ScenarioReport): string`

- [ ] **Step 1: Write the failing tests**

```ts
// percentile([5, 1, 3, 2, 4], 50) === 3; percentile([1..100], 95) === 95; percentile([], 50) === null
// freeTierHoursPerDay(160) ≈ 3.47 (2 decimals); freeTierHoursPerDay(0) === null
// warningsFor(clean report) → []
// corrections: 3 → a warning containing '3 moves were rejected'
// requestErrors: 1 → contains 'request error'
// reconnects: 1 → contains 'reconnect'
// deliveryRatio: 0.95 → contains 'delivery' ; 0.99 → no warning
// eventLoopMs.p99: 51 → contains 'load generator' ; 50 → no warning
// formatReport(clean) contains the name, `incoming 160.0/s`, `outgoing`, `p95`, `hours/day`, both UTC times, and 'No problems seen.'
// formatReport(with warnings) lists each warning on its own line starting with 'WARNING: '
```

- [ ] **Step 2: Run** `npx vitest run --project unit scripts/load-check/report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`. Thresholds: any correction, request error, or reconnect; `deliveryRatio < 0.99`; `eventLoopMs.p99 > 50`. Report text is plain lines, one block per scenario, numbers to one decimal place.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(load-check): statistics, warnings and report text`.

### Task 3: Meter and instrumented socket

**Files:**
- Create: `scripts/load-check/meter.ts`
- Test: `scripts/load-check/meter.test.ts`

**Interfaces:**
- Consumes: `SocketLike` from `shared/client/index`.
- Produces:
  - `class Meter { constructor(now?: () => number); registerPlayer(tag: string, playerId: string): void; start(): void; stop(): void; onSend(tag: string, data: string): void; onReceive(tag: string, data: unknown): void; counts(): MeterCounts }`
  - `interface MeterCounts { sent: number; received: number; moves: number; delaysMs: number[]; corrections: number; requestErrors: number; startedAt: number | null; endedAt: number | null }`
  - `instrumentSocket(inner: SocketLike, tag: string, meter: () => Meter | null): SocketLike`
- Counting rules: only messages between `start()` and `stop()` count. `sent` counts every outgoing message; `moves` counts outgoing `player.move`. An outgoing `player.move` records `now()` under `(tag, payload.sequence)`. An incoming `player.updated` from another player (looked up by `payload.playerId` → tag) with a recorded send adds one delay. `received` counts every incoming message. `player.corrected` adds a correction and `request.error` adds a request error. Unparseable data is counted but otherwise ignored.

- [ ] **Step 1: Write the failing tests** (fake `SocketLike` and a fake clock)

```ts
// 'counts nothing before start or after stop'
// 'counts sent and received messages while started'
// 'matches a move to another player's player.updated by player and sequence': A sends seq 7 at t=1000; B receives player.updated {playerId: idA, sequence: 7} at t=1040 → delaysMs [40]
// 'ignores player.updated with no recorded send, or from an unregistered player'
// 'counts player.corrected and request.error'
// 'instrumentSocket forwards send, close and every handler the client sets after wrapping' (set onmessage after wrapping, fire inner.onmessage → client handler called with the same event, meter.received 1)
// 'instrumentSocket works with no meter' (meter() returns null: still forwards)
```

- [ ] **Step 2: Run** `npx vitest run --project unit scripts/load-check/meter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `meter.ts`. The wrapper uses accessors for `onopen`, `onmessage`, `onclose`, `onerror` that install a forwarding handler on `inner`, so the client can set handlers after `openSocket` returns.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(load-check): socket meter for message counts and move delay`.

### Task 4: Scenario runner

**Files:**
- Create: `scripts/load-check/run.ts`
- Test: `scripts/load-check/run.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `createPortalClient`, `createMemoryStorage` (`shared/client/index`); `startLocalRuntime`, `TEST_ORIGIN` (`shared/test/runtime-env`); `createTestAccounts` (`scripts/create-test-accounts`).
- Produces:
  - `type ScenarioName = 'baseline' | 'full' | 'quarter'`
  - `const SCENARIOS: Record<ScenarioName, { players: number; movers: number }>` with the Global Constraints values.
  - `interface Probe { meter: Meter | null }`
  - `interface LoadClient { tag: string; client: PortalClient }`
  - `createLoadClient(o: { tag: string; supabaseUrl: string; publishableKey: string; runtimeUrl: string; origin: string; probe: Probe }): LoadClient` (sockets: Node `WebSocket` with an `Origin` header, wrapped by `instrumentSocket(…, () => o.probe.meter)`).
  - `runScenario(clients: LoadClient[], s: { name: string; movers: number; rateHz: number; durationMs: number }, probe: Probe): Promise<ScenarioReport>`
- Runner steps: new `Meter` into `probe.meter`; `connectWorld()` for every client in parallel; if any fails, `leaveWorld()` the connected ones and throw `Error` naming the tag and error code; register each `playerId`; wait until every client's snapshot lists all players (15 s timeout); start `monitorEventLoopDelay`, `meter.start()`; the first `movers` clients each run a walker from their own snapshot position on a `setInterval(1000 / rateHz)` calling `sendMove`; count `reconnecting` state changes; after `durationMs` stop the intervals, wait 500 ms so in-flight deliveries arrive, then `meter.stop()`; rates divide by the walking time (`durationMs`), not including the 500 ms; `expectedDeliveries = moves × (players − 1)`; `leaveWorld()` all; build the report with `warningsFor`.

- [ ] **Step 1: Write the failing integration tests** (local stack required; one `startLocalRuntime()` in `beforeAll`, `stop()` in `afterAll`; 60 s test timeout)

```ts
// '3 players, all moving, 2 s at 10 Hz': incomingPerSec in [20, 40]; outgoingPerSec in [40, 80];
//   delayMs.count > 0; deliveryRatio > 0.9; corrections 0; requestErrors 0; reconnects 0
// '3 players, 1 moving': incomingPerSec in [5, 15]; outgoingPerSec in [10, 30]
// 'a client that cannot connect stops the scenario': one client never signed in →
//   runScenario rejects with a message containing its tag and 'UNAUTHORIZED'
```

- [ ] **Step 2: Run** `npm run db:start` (if not running), then `npx vitest run --project integration scripts/load-check/run.integration.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `run.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(load-check): scenario runner with local integration run`.

### Task 5: Command line, modes, and documentation

**Files:**
- Create: `scripts/load-check.ts`, `scripts/load-check/args.ts`
- Test: `scripts/load-check/args.test.ts`
- Modify: `doc/checklists/cloudflare-hosted-setup.md` (the deferred **Load check** section), `README.md` (one line under local development)

**Interfaces:**
- Consumes: Task 4.
- Produces: `parseArgs(argv: string[], env: Record<string, string | undefined>): { ok: true; options: LoadOptions } | { ok: false; message: string }` with `interface LoadOptions { scenarios: ScenarioName[]; durationMs: number; rateHz: number; hosted: null | { supabaseUrl: string; publishableKey: string; runtimeUrl: string; origin: string; email: string; password: string } }`. Flags: `--scenario <name>` (repeatable; default all three, in the order baseline, full, quarter), `--duration <seconds>`, `--rate <hz>`, `--hosted`. Hosted env: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RUNTIME_URL`, `RUNTIME_ORIGIN`, `LOAD_EMAIL`, `LOAD_PASSWORD`.

- [ ] **Step 1: Write the failing tests**

```ts
// defaults: scenarios ['baseline', 'full', 'quarter'], durationMs 60_000, rateHz 10, hosted null
// '--scenario full --scenario baseline' → ['full', 'baseline']; '--scenario nope' → not ok, message names the allowed values
// '--rate 0', '--rate 21', '--rate 2.5', '--duration 0' → not ok
// '--hosted' with any hosted env var missing → not ok, message names the missing variable(s), never their values
// '--hosted' with 'production' in SUPABASE_URL or RUNTIME_URL → not ok, message contains 'production'
// '--hosted' with LOAD_EMAIL lacking '@' → not ok
// unknown flag → not ok
```

- [ ] **Step 2: Run** `npx vitest run --project unit scripts/load-check/args.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `args.ts` and `scripts/load-check.ts`:
  - Local mode: `startLocalRuntime()`, `createTestAccounts(16, runtime.supabase, { prefix: 'load' })`, sign each in, origin `TEST_ORIGIN`.
  - Hosted mode: print `Supabase: <host>   runtime: <host>` first. For `i` in 1 to 16, tag `load01` to `load16`, email `<user>+load01@<domain>`: `signIn`; on `INVALID_CREDENTIALS`, `signUp` with display name `Load01` etc.; any other error stops the run, naming the tag and code.
  - Create only as many clients as the largest selected scenario needs. Each scenario uses the first `players` clients. Print each report as it finishes, then sign out all clients (and `stop()` the local runtime) in a `finally`. On `SIGINT`, run the same cleanup, then exit 130.
  - Exit code 1 on a usage error or a failed scenario; 0 otherwise (warnings do not fail the run; it is a measurement).
- [ ] **Step 4: Run** the unit test command. Expected: PASS. Then a short local run: `npx tsx scripts/load-check.ts --duration 5`. Expected: three report blocks, each with `No problems seen.` (or explained warnings), and exit code 0.
- [ ] **Step 5: Document.** In the checklist's **Load check** section, replace "deferred" with how to run: local (`npm run db:start`, then the command above), and hosted (the command with `npx tsx --env-file=.env.development.local scripts/load-check.ts --hosted`, the env vars, the plus-address users created on the first run and kept for later runs, and reading **Workers & Pages → portal-runtime-dev → Metrics** for the printed UTC window). Add a results line format: date, initials, rate, and per scenario: incoming/s, outgoing/s, delay p95, hours/day, dashboard CPU and duration. Add a Change History row. Add one README line pointing to the checklist section.
- [ ] **Step 6: Verify** `npm test && npm run typecheck && npx vitest run --project integration scripts/load-check`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(load-check): command line, local and hosted modes, checklist`.
