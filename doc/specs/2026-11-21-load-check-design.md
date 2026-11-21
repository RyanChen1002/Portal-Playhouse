# Load Check Script — Design

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/21/2026 | Initial short design for the load-check script: one Node script driving real clients, three scenarios (2-player baseline, 16 all moving, 16 with 25% moving), local and hosted-dev modes. |

**Implements:** the deferred "Load (manual, later)" row of the [runtime design](2026-11-17-runtime-transport-design.md) §10 and the load check in the [hosted runtime checklist](../checklists/cloudflare-hosted-setup.md). **Supports:** FR-03 and AC-02 in the [initial spec](../initial-spec.md) ("performance targets... need measurement before declaring capacity supported"). **Estimates being checked:** [runtime research](../research/runtime-transport.md) §6.2.

## Intent

Measure what the runtime actually does with a full world, so that capacity and free-tier claims rest on numbers instead of the research estimates. It is a measuring tool, not a pass/fail test: no thresholds are agreed yet, and the script reports what it saw.

## Goals

- Run three scenarios, each with every player in the lobby (the courtyard), where fan-out is largest:
  1. **Baseline:** 2 players, both moving.
  2. **Full:** 16 players, all moving.
  3. **Quarter:** 16 players connected, 4 moving (25%).
- Move rate of 10 Hz by default (runtime design §5.4); 20 Hz on request.
- Report for each scenario:
  - **Incoming messages per second** to the World object (all client sends), and the projected **hours of play per day** on the Cloudflare free tier, using research §6.2's assumptions (100,000 requests per day; 20 incoming WebSocket messages count as one request).
  - **Outgoing messages per second** received by all clients.
  - **Move delivery delay**: time from one client sending a move to another client receiving the matching `player.updated` (p50, p95, max).
  - **Problems**: `player.corrected` (rejected moves), request errors, unexpected closes or reconnects. Expected to be zero.
  - **Load-generator health**: the Node process's event-loop delay, so that a slow generator is not mistaken for a slow server.
  - The run's **start and end times (UTC)**, for reading the Durable Object's CPU time and duration in the Cloudflare dashboard.
- Two modes:
  - **Local:** starts the local runtime against the local Supabase stack and creates local test accounts itself (as the integration tests do). Refuses a non-local Supabase URL.
  - **Hosted dev:** run manually by Adam, like the hosted smoke check. Requires an explicit flag, prints the Supabase and runtime hosts before connecting, and uses plus-address users (`<user>+load01` to `+load16`) that are signed up on the first run and signed in on later runs. The password comes from an environment variable and is never written to the repository.

## Non-goals

- Pass/fail limits, CI integration, or a disconnect or 17th-player suite (the 17th-player and reconnect checks already exist as local integration tests).
- Load inside the Portal Partners room or during rounds.
- Reading server CPU automatically (that would need a Cloudflare API token; agents do not hold one).
- Production. The script never targets it.

## Anti-goals

- Numbers that look valid but are not: if moves are rejected, or the generator itself lags, the report must say so plainly.
- Using a large share of the shared daily free allowance: runs default to 60 seconds per scenario.

## Approaches

1. **A Node script driving real clients in one process** (**chosen by Adam**). It reuses `createPortalClient`, follows the hosted smoke check's pattern, and measures delay directly because all clients share one clock. 16 clients are light for one process; event-loop delay is reported in case that is wrong.
2. A Vitest test with pass/fail limits. Rejected: no agreed thresholds, and Adam asked for the measurement only.
3. An external load tool (such as k6). Rejected: a new dependency that would re-implement the authentication handshake and message protocol the client already handles.

## Decided by Adam

- Approach 1.
- Load check only; no wider test suite for now.
- Scenarios: 16 at 100% moving, 16 at 25% moving, plus a 2-player baseline.

## Builder's calls (proposals, open to correction)

- Script at `scripts/load-check.ts`, run with `tsx`. Options for scenario selection, duration, and rate.
- Moving players do a random walk inside the courtyard at about 4 units per second (below the 4.8 limit), so the server accepts every move. A unit test checks the walk against the engine's own `checkMove`.
- Non-moving players in the quarter scenario stay connected and still receive everyone's moves.
- Scenarios run one after another, with fresh connections for each.
- Unit tests for the walk and the statistics (percentiles, rates, free-tier projection). One short local integration run (a few players for a few seconds) checks that the script works end to end.
- Results are recorded by hand in the hosted runtime checklist's load-check section (date, initials, scenario numbers, dashboard CPU and duration), as is done for the smoke check.

## Left to the builder

How delay is matched between send and receipt, the exact output format, the option names, and the module split between pure functions and the runner.
