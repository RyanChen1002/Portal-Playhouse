# Research: Authoritative Runtime and Real-Time Transport

**Version:** 0.1

**Date:** 11/15/2026

**Author:** Adam, with AI-assisted research (Claude Code, model Claude Fable 5.2)

**Status:** Research complete; **no decision made.** Runtime and transport are open decisions in the [initial spec](../initial-spec.md) (FR-12, §7, §8) and the [component contract](../component-contract.md) (§1, §5). The recommendation in §7 is a proposal for Ryan and Adam to decide. Record the outcome in the spec/contract change history.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/15/2026 | Added the runtime and transport research: three options, four load scenarios, free-tier budgets, and a proposed recommendation. |

## 1. Question

Which runtime holds the authoritative world, room, and game state, and which transport carries real-time messages, given that we must stay on free tiers and grow from 2 simultaneous players to 16?

The spec names two approaches (§7): a dedicated authoritative game service, or Supabase commands/functions plus Realtime delivery. Both are considered here. The first is split in two because where it is hosted changes the answer.

## 2. Constraints and priorities

- **Free comes first**, ahead of design elegance and performance. The project is educational; either approach satisfies the learning goal (Adam, 11/15/2026).
- Supabase Auth and database, Vercel frontend, and separate dev/production environments are confirmed (spec §1).
- First milestone: **2 simultaneous players**. Final goal: **16 across the whole world** (FR-03, AC-02).
- The backend validates actions, enforces admission atomically, and persists results exactly once (spec §5, contract §6–§7).
- The frontend talks only to `PortalClient` (contract §4), so the runtime choice is hidden from the UI. Ryan's work is affected through the mock, not the transport.
- Team agreement is needed before any cost, and a new vendor account is a team decision (working agreement, governance R4).
- The first game is still TBD. This research sizes *kinds* of load, not a specific game.

## 3. Load scenarios

These are sizing assumptions, not game designs. An **action** is one grid step, one throw, or one button press sent by a player. Movement is assumed to be grid-based at 4 tiles per second while a player is walking.

| | Scenario | Players | Actions per second (average / peak) | Server-originated events |
| --- | --- | --- | --- | --- |
| S1 | Lobby: walk around, open simple panels | 16 in one room | 16 / 64 (walking 25% of the time / everyone walking) | Joins, leaves, board updates (rare) |
| S2 | Grid game room: floor tiles switch between safe and unsafe | 4 | 12 / 16 | Floor changes, about 1 per second, on a timer |
| S3 | Two-player co-op: move on a timer, throw balls in a straight line at moving targets | 2 | 8 / 10 | Hits and score, about 1 per second; round timer |
| S4 | Three rooms at once: lobby + S2 + S3 | 10 + 4 + 2 | 30 / 66 | As above, combined |

What each scenario demands, beyond message volume:

- **S1** is the fan-out problem. Every action must reach 15 other players, so one step becomes 16 deliveries. It needs no timer and little validation.
- **S2** needs a **server-side timer**: the floor changes whether or not anyone acts, and a player standing on a tile when it turns unsafe must be caught at that moment.
- **S3** needs timing plus geometry. Targets can follow a path fixed in advance (a function of time), so a throw can be judged from its position, direction, and timestamp without simulating every frame.
- **S4** tests whether rooms are isolated: a busy lobby must not starve a game room.

## 4. Platform facts

Checked against the official pages in §10 on November 15, 2026, unless marked *verify*.

### 4.1 Supabase (Free plan)

1. **Realtime rate limit: 100 messages per second per project.** An event is "a WebSocket message delivered to, or sent from a client", so **deliveries count**. A broadcast to a 16-player room is 16 events. Over the limit, connections are disconnected until the rate drops. Limits are "configurable per project"; whether Supabase raises them on the Free plan is *verify*.
2. **Realtime quota: 2 million messages per month**, counted the same way (one sent plus one per recipient). The quota applies to the **whole organization**, so dev and production share it. Over quota, the Free plan gets a notification and a "grace period" under the fair use policy; what happens after that is *verify*.
3. Other Realtime limits: 200 concurrent connections, 20 presence messages per second, 100 channels per connection, 256 KB payload. None of these bind at 16 players.
4. **Three ways to send a broadcast:** client WebSocket, REST API, and from the database (`realtime.send`, `realtime.broadcast_changes`). Private channels are authorized by row-level-security policies on `realtime.messages`: a `select` policy lets a client receive, an `insert` policy lets it send. Omitting the `insert` policy makes a channel receive-only for clients, which is what an authoritative design needs. Permissions are cached for the life of the connection.
5. **Latency (Supabase's own benchmarks, on paid infrastructure at large scale):** WebSocket broadcast median 6 ms, p95 28 ms. Broadcast from the database median 46 ms, p95 132 ms. Free-tier figures at our scale are not published.
6. **Edge Functions cannot be a game server.** Free plan: 150 s maximum wall-clock time, 2 s CPU per request, 256 MB memory. WebSockets are supported but drop when the worker retires. They can only be stateless command handlers.
7. **Timers:** `pg_cron` runs jobs as often as every 1 second, no finer, and does not prevent overlapping runs. Sub-second server ticks are not available inside Supabase.
8. Free plan compute is shared CPU with 500 MB RAM, unlimited API requests, 5 GB egress per month, 500,000 Edge Function invocations per month, and a pause after 1 week of inactivity (already accepted, governance R5).

### 4.2 Cloudflare Workers and Durable Objects (Workers Free plan)

A Durable Object is a small single-threaded server instance with its own memory and storage that Cloudflare starts on demand. One object per room is the standard multiplayer pattern.

1. **Requests: 100,000 per day. Incoming WebSocket messages are billed at 20:1**, so the allowance is 2 million incoming messages per day. **Outgoing WebSocket messages are free**, so fan-out costs nothing.
2. **Duration: 13,000 GB-seconds per day**, charged at 128 MB per object while it is awake. That is about 28 object-hours per day. An idle object using the Hibernation WebSocket API is not billed.
3. Limits reset daily at 00:00 UTC. Over a limit, operations of that type fail with an error until the reset.
4. **CPU: 30 seconds per request, reset by each incoming WebSocket message.** The Workers 10 ms CPU limit on the Free plan applies to the plain Worker in front, not to the object's own limit as listed (*verify* in a spike).
5. **Timers keep an object awake.** `setInterval` and `setTimeout` prevent hibernation, so a game tick loop is possible and is billed as duration while it runs. Hibernation discards in-memory state after 10 seconds of inactivity; anything that must survive goes in storage or the per-connection attachment (16 KB).
6. Storage on Free is SQLite-backed only: 100,000 rows written and 5 million rows read per day, 5 GB total. Per-move writes would exhaust this; state should stay in memory and be written only at session boundaries.
7. No data-transfer charges are listed for Workers. Whether sign-up needs a payment card is not stated on the pricing page (*verify* at sign-up).

### 4.3 Hosts for a conventional Node.js game server

A single Node process handles 16 players easily. The question is only where it can run for free. Free tiers here have been shrinking: Fly.io has no free tier for new users, and Koyeb reportedly began requiring a card in February 2026 (secondary sources).

| Host | Free terms | Catch |
| --- | --- | --- |
| **Northflank** Sandbox | 2 services, always on, "No card needed", up to $20/month of resources | Dev + production would use both services. Instance size is not stated (*verify*). Smaller vendor; terms may change. |
| **Render** free web service | 750 instance hours per month per workspace | Spins down after 15 minutes without inbound traffic (WebSocket messages count as traffic), about 1 minute to wake, and "might restart a Free web service at any time", losing in-memory state. Outbound bandwidth allowance and card requirement are *verify*. |
| Oracle Cloud Always Free, Google Cloud e2-micro | Free virtual machines | Both require a card. Google's includes only 1 GB of outbound transfer per month. More operations work (OS, TLS, process management). |
| Railway | $1 of credit per month after the first month | Not enough for an always-on service. |
| Vercel | — | Hosts the frontend. It does not run long-lived WebSocket servers (*verify* if the frontend framework decision reopens this). |

Colyseus is an MIT-licensed Node framework for rooms and state sync that is free to self-host; its managed cloud is paid. Plain `ws` is the minimal alternative.

## 5. Options

### Option A — Supabase only: database functions plus Realtime

Each action is a database function call (`rpc`), the same pattern as `update_me`. The function validates and writes state in one transaction, then the database broadcasts the result on a receive-only private channel per room. Timers use `pg_cron` or are evaluated lazily ("what would the state be at this timestamp?") when the next call arrives.

- **For:** no new vendor, account, or deployment. Atomic admission (`WORLD_FULL`, `ROOM_FULL`) is natural in Postgres. The existing pgTAP and integration harness, CI, and environments carry over. Results are written in the same transaction as the outcome, so exactly-once persistence is simple.
- **Against:** the rate limit and monthly quota (§6). Game rules are written in PL/pgSQL, which is awkward for geometry and timing. No sub-second timers. Every action pays an HTTP round trip plus a database broadcast, likely 100–250 ms between one player acting and another seeing it (estimate, not measured).

### Option B — Cloudflare Durable Objects

One object per room (lobby and each game room) holds state in memory and speaks WebSocket directly to clients, using the contract §5 envelope as written. A Worker in front verifies the Supabase access token against the project's public keys (asymmetric signing keys are already enabled) and routes the connection. At the end of a session the object calls a Supabase function, using a server-side secret, to save the result.

- **For:** the roomiest free allowance by a wide margin (§6), with free fan-out. No sleeping or cold start of note. A real authoritative tick loop in TypeScript. Local development and tests run offline with Cloudflare's local runtime. Rooms are isolated from each other by design.
- **Against:** a new vendor and account. The programming model is Cloudflare-specific (hibernation, storage, no ordinary process), so it is less "classic game server" than Node. World-wide admission needs one coordinating object or a Supabase call, since each room is separate. Two systems must agree on session results.

### Option C — Node.js game server (Colyseus or `ws`) on a free host

One long-running process holds every room in memory, ticks on a timer, and speaks WebSocket. Token verification and result saving work as in Option B.

- **For:** the conventional game-server architecture, with the most learning material and the simplest mental model. Runs anywhere, including a laptop. No message quotas.
- **Against:** free hosting is the weak point (§4.3). Northflank's free plan fits exactly two services. Render's free plan sleeps, takes about a minute to wake, and can restart mid-game. Either vendor can change terms during the semester. A restart loses all live rooms unless state is persisted.

### Hybrid note

Options B and C both keep Supabase for Auth, profiles, results, and wins, so Supabase functions are exercised either way. Supabase Realtime could additionally carry the **room board** (low volume, read-only, natural as a database broadcast) while the game server carries movement and game state. That gives hands-on experience with both technologies, at the cost of a second real-time connection in the client and a share of the monthly quota.

## 6. Scenario budgets

### 6.1 Supabase Realtime (Option A)

Events per second = actions per second × players in the room, because every delivery counts.

| Scenario | Events/s (average / peak) | Against the 100/s limit | Hours of play per month on the 2 million quota (at average) |
| --- | --- | --- | --- |
| Two players in the lobby (first milestone) | 4 / 16 | Fits | About 139 |
| S3: two-player co-op | 18 / 22 | Fits | About 31 |
| S2: four-player grid game | 52 / 68 | Fits | About 11 |
| S1: 16-player lobby, one message per step | 256 / 1,024 | **Fails**, by 2.5× to 10× | About 2 |
| S1 with positions batched once per second | 16 / 16 | Fits | About 35 |
| S4: three rooms, lobby per step | 170 / 490 | **Fails** | About 3 |
| S4 with the lobby batched once per second | 80 / 100 | Fits with no margin | About 7 |

Reading this table:

- Option A comfortably supports the **2-player milestone** and any single small game room.
- A **16-player lobby cannot send one message per step.** It works only if the server batches all positions into one broadcast per second (a `pg_cron` job) and clients animate between updates, or if movement is sent as occasional destinations instead of steps. Other players then appear up to a second behind.
- The **monthly quota is shared by dev and production** and is measured in hours of full-world play: roughly 7 hours per month for S4 even after batching. Testing, class access for 1–2 weeks, and the presentation all draw from it. A 10-minute 16-client load test on the hosted project uses a noticeable share.
- S2's floor timer has to be driven by a 1-second `pg_cron` job or evaluated lazily. Both work; neither is precise.

### 6.2 Cloudflare Durable Objects (Option B)

Billed requests = incoming messages ÷ 20; outgoing messages are free. Limits reset **daily**.

| Scenario | Incoming messages/s (average / peak) | Hours per day on the request limit (average / peak) | Hours per day on the duration limit |
| --- | --- | --- | --- |
| S1: 16-player lobby | 16 / 64 | 34 / 8.7 | 28 (one object awake) |
| S2: four-player grid game | 12 / 16 | 46 / 34 | 28 |
| S3: two-player co-op | 8 / 10 | 69 / 55 | 28 |
| S4: three rooms | 30 / 66 | 18 / 8.4 | 9.4 (three objects awake) |

Every scenario fits with hours to spare **each day**, including the worst case of all 16 players walking continuously. The allowance is per account, so dev and production share it unless they use separate accounts.

### 6.3 Node.js server (Option C)

No platform message limits apply. The constraints are the host's:

- Rough outbound traffic for S1 at about 150 bytes per delivery is 140 MB per hour (estimate). That matters only if the host's monthly bandwidth allowance is small (*verify* for Render).
- On Render, a room with players stays awake, but the first visitor after a quiet period waits about a minute, and a platform restart ends any game in progress.

### 6.4 Summary against the scenarios

| | A. Supabase only | B. Durable Objects | C. Node on a free host |
| --- | --- | --- | --- |
| 2-player milestone | Yes | Yes | Yes |
| S1: 16-player lobby | Only with 1-second batching; about 35 h/month | Yes | Yes |
| S2: timed floor, 4 players | Yes, with 1-second timer precision | Yes | Yes |
| S3: co-op with throws, 2 players | Yes | Yes | Yes |
| S4: three rooms, 16 players | At the limit; about 7 h/month | Yes | Yes |
| Free-tier headroom | Thin, shared across environments, monthly | Large, daily reset | Unlimited messages; host terms are the risk |
| Card required | No | *Verify* | No (Northflank, Render); yes (Oracle, Google) |
| New vendor | No | Yes | Yes |
| Risk the free tier fails us mid-semester | Low on terms, **high on quota** | Low | Medium (sleep, restarts, changing terms) |
| Game rules written in | PL/pgSQL | TypeScript | TypeScript |
| Sub-second server timers | No | Yes | Yes |
| Exactly-once results | Simplest (one transaction) | Needs an idempotent save call | Needs an idempotent save call |

## 7. Recommendation (proposal)

**Use a dedicated game runtime for world, room, and game state, hosted on Cloudflare Durable Objects (Option B), and keep Supabase for Auth, profiles, results, and wins.** Keep Option C as the fallback.

Reasons:

- With "free" as the first priority, the deciding fact is that **Supabase Realtime counts every delivery**, against both a 100-per-second limit and a 2-million-per-month quota shared by dev and production. That is fine at 2 players and marginal at 16. The goal is 16.
- Durable Objects do not charge for outgoing messages and reset daily, so the 16-player scenarios fit with a wide margin and a heavy test day cannot use up the month.
- It needs no always-on machine, so there is no sleep, wake-up delay, or surprise restart in front of the class.
- Supabase functions are still exercised: the game runtime saves results through a database function, and the hybrid board (§5) remains available if we want Realtime experience too.

To keep the fallback cheap, **write room and game rules as plain TypeScript with no platform imports**, and wrap them in a thin adapter for the host. The same rule code can then run inside a Durable Object, a Node process, and the `shared/mocks/` client that Ryan develops against. Moving from B to C would mean rewriting the adapter only.

If the team prefers the conventional game-server experience over free-tier headroom, Option C on Northflank is workable. If the team prefers no new vendor, Option A is workable only by accepting a once-per-second lobby and a monthly play budget measured in hours.

A staged path (Option A for the 2-player milestone, then a game server for 16) is not recommended: rules written in PL/pgSQL would be rewritten in TypeScript.

## 8. Decisions needed from Ryan and Adam

1. Runtime: A, B, or C (recommend B, with C as fallback).
2. Whether to open a Cloudflare account, who owns it, and whether dev and production share one account's daily allowance.
3. Whether the room board uses Supabase Realtime (hybrid) or the game runtime's own connection.
4. Movement model for the lobby: one message per grid step, or destinations with client animation. This changes message volume about tenfold and is partly a frontend decision.
5. Whether to adopt a room framework (Colyseus under C; PartyServer under B) or write the small amount of room code directly.

## 9. Items to verify before or during design

A short throwaway spike should confirm the recommended option before the design is written:

- Cloudflare: whether sign-up needs a card; a Durable Object with a 10 Hz `setInterval` loop and 16 simulated clients runs on the Free plan within CPU limits; measured requests and duration match §6.2; verifying a Supabase token inside the Worker.
- Supabase: whether the 100-per-second limit counts database and REST sends as well as deliveries; what follows the Free-plan "grace period"; whether the limit can be raised on Free.
- Northflank: free instance size, and whether the Sandbox terms still read as in §4.3.
- Render: bandwidth allowance and card requirement on the free plan.
- Measured latency from one player's action to another player's screen on the chosen option, from a home connection.

The message rates in §3 are assumptions. Replace them with measurements once movement exists.

## 10. Sources

Official Supabase documentation:

- [Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Realtime rate limits](https://supabase.com/docs/guides/realtime/rate-limits)
- [Manage Realtime Messages usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Manage Realtime Peak Connections usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections)
- [Realtime benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)
- [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Edge Functions limits](https://supabase.com/docs/guides/functions/limits)
- [Edge Functions worker timeouts and WebSocket drops](https://supabase.com/docs/guides/troubleshooting/edge-functions-worker-timeouts-and-websocket-drops)
- [Supabase Cron](https://supabase.com/modules/cron)
- [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Pricing](https://supabase.com/pricing)

Official Cloudflare documentation:

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Durable Objects WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects on the Workers Free plan (changelog)](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier)

Hosts and frameworks:

- [Render: Deploy for Free](https://render.com/docs/free)
- [Northflank pricing](https://northflank.com/pricing)
- [Colyseus pricing](https://colyseus.io/pricing)

Secondary sources (used only for figures marked *verify* or for the state of other free tiers):

- [Render: platforms with a real free tier in 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [State of Free Hosting 2026 (SnapDeploy)](https://snapdeploy.dev/state-of-free-hosting)
- [Free cloud hosting 2026: 14 platforms compared (SnapDeploy)](https://snapdeploy.dev/blog/free-cloud-deployment-platforms-2026-comparison)
- [Northflank Sandbox terms (free-tier-hub issue)](https://github.com/ePlus-DEV/free-tier-hub/issues/996)
