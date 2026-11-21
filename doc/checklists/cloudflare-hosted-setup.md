# Cloudflare Hosted Setup Checklist

**Version:** 0.3

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.3 | 11/21/2026 | Replaced the deferred load-check note with the Load check section: local and hosted-dev runs of `scripts/load-check.ts`, reading the dashboard, and recording results; recorded a 5-second local quick check. After review: hosted mode accepts only the dev hosts from `runtime/wrangler.jsonc`, a first run uses 17 auth calls, and other players in the lobby produce a warning (`RATE_LIMITED` added to "If it fails"). Then, at Adam's request: connections that close during a run are reported with their reasons (and named as the cause of missing moves), and the event-loop line notes the 10 ms sampling interval. `LOAD_EMAIL` and `LOAD_PASSWORD` now go in `.env.development.local` instead of the command line, to keep the password out of shell history. Recorded Adam's 60-second local and hosted dev runs with commentary on the hosted results and ticked steps 1 to 3, with the Worker's and the World Durable Object's dashboard CPU (and the Worker's wall time) read from Adam's screenshots and commentary on the Free-plan limits. Earlier the same day (0.2): Claude marked step 4 done (the hosted dev advisors showed only the five accepted findings, including the new `get_my_results` one, now recorded in the Supabase checklist); Adam ticked the completed tasks. |
| 0.1 | 11/18/2026 | Created the manual checklist for the hosted dev runtime (`portal-runtime-dev`): wrangler login, `env.dev` vars, the Worker secret, the hosted dev migration, the first deploy, a scripted smoke check, and handing the runtime URL to Ryan. Production stays deferred until launch. The load check is deferred. |

These are manual steps for Adam. Agents never run `wrangler login`, `wrangler secret put`, or `wrangler deploy`, and never run Supabase commands with `--remote`. The design is in [section 5.1 of the runtime spec](../specs/2026-11-17-runtime-transport-design.md) (environments) and [section 10](../specs/2026-11-17-runtime-transport-design.md) (smoke check and hosted setup). Hosted Supabase steps are in the [hosted Supabase setup checklist](supabase-hosted-setup.md).

## Keys and values

| Value | Where it goes |
| --- | --- |
| Hosted dev Supabase URL (`https://<project-ref>.supabase.co`) | `env.dev.vars.SUPABASE_URL` in `runtime/wrangler.jsonc`. Safe to commit. |
| Frontend origins allowed to connect | `env.dev.vars.ALLOWED_ORIGINS` (comma-separated, exact origins, no trailing slash). Safe to commit. |
| Hosted dev Supabase **secret** key (`sb_secret_<placeholder>`) | Only as the Worker secret `SUPABASE_SECRET_KEY`, through `wrangler secret put`. **Never commit it, never put it in `wrangler.jsonc`, never give it to Ryan.** |
| Dev runtime URL (`wss://portal-runtime-dev.<subdomain>.workers.dev/connect`) | Safe to share. Give to Ryan. |

Use placeholders only in Git, pull requests, chat, and agent logs.

## Before you start

- Run every command at the **repository root**, on the pull request's branch after its CI run is green (or on an up-to-date `dev` after merging), with Node 22 (`nvm use`).
- Use the project's pinned wrangler through `npx wrangler --cwd runtime ...` (or `cd runtime` first and then `npx wrangler ...`). Don't use a globally installed wrangler.
- The Cloudflare account already exists (created 11/17/2026, free plan, no card). Everything below stays within the Workers free plan; stop and ask Ryan before anything asks for payment.

## Dev runtime (this milestone)

- [x] 1. Log in: `npx wrangler login`. This opens the browser and stores an OAuth token for your user. Check with `npx wrangler whoami` that the account is the project's account.
- [x] 2. Fill in the `env.dev` vars in `runtime/wrangler.jsonc` and commit the change on the branch:
  - `SUPABASE_URL`: the hosted dev project URL, `https://<project-ref>.supabase.co`.
  - `ALLOWED_ORIGINS`: the Vercel dev frontend URL (for example `https://<dev-frontend>.vercel.app`), plus `http://127.0.0.1:4173` so Ryan can test the local frontend against the dev runtime. Any origin not listed gets HTTP 403 from `/connect`.
  - Leave the placeholders in `env.production` as they are.
  - Check the file with `npx wrangler --cwd runtime deploy --env dev --dry-run`. It builds and packages without deploying.
- [x] 3. Set the secret: `npx wrangler --cwd runtime secret put SUPABASE_SECRET_KEY --env dev`, and paste the hosted dev **secret** key at the prompt (not as an argument, so it stays out of shell history).
  - The first `secret put` creates the `portal-runtime-dev` Worker if it does not exist yet. Each later `secret put` deploys a new version at once.
  - The Worker refuses to start the World object without this secret.
- [x] 4. Apply the new migration (Portal Partners results, the runtime functions, and `winsTotal`) to the hosted dev project. Follow step 5 of the [hosted Supabase setup checklist](supabase-hosted-setup.md) (`migration list`, dry run, push, `migration list` again).
  - Then run the hosted advisors (step 6 of the same checklist). The new runtime functions are granted only to `service_role`, so they should add **no** new `anon` or `authenticated` findings. `get_my_results` is called by signed-in players, so expect one more accepted `authenticated_security_definer_function_executable` (0029) finding for `public.get_my_results`. Record it in that checklist. Anything else is a problem to fix before merging.
- [x] 5. Deploy: `npx wrangler --cwd runtime deploy --env dev`.
  - The output ends with the Worker URL, `https://portal-runtime-dev.<subdomain>.workers.dev`. The runtime URL is that host with `wss://` and the `/connect` path.
  - Quick check: `curl -i https://portal-runtime-dev.<subdomain>.workers.dev/connect -H 'Origin: https://evil.example'` returns `403`. With an allowed origin and no upgrade header, it returns `426`.
- [x] 6. Smoke check (spec §10): two scripted clients sign in, see each other, play one round to a win, and confirm the saved result. Run it after steps 3 to 5.
  - **Use the real client.** The tests and `scripts/` refuse non-local URLs, so this is the only hosted check. Ryan's frontend is not wired to the runtime yet, so two browsers are not possible until it is.
  - **Where to run:** at the repository root, with `.env.development.local` from the Supabase checklist (it holds `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for hosted dev). Docker is not needed.
  - Replace `you@your-domain` with an address you own (the script creates two plus-address users, as in the Supabase smoke check), `<subdomain>` with your workers.dev subdomain, and the origin with one listed in `ALLOWED_ORIGINS`. Paste the whole block. Nothing is written to disk. A full run takes about 30 seconds.

```sh
SMOKE_EMAIL=you@your-domain \
RUNTIME_URL=wss://portal-runtime-dev.<subdomain>.workers.dev/connect \
RUNTIME_ORIGIN=http://127.0.0.1:4173 \
npx tsx --env-file=.env.development.local <<'EOF'
const { createPortalClient } = await import('./shared/client/index.ts');
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_PUBLISHABLE_KEY!;
const runtimeUrl = process.env.RUNTIME_URL!, origin = process.env.RUNTIME_ORIGIN!;
const [user, domain] = process.env.SMOKE_EMAIL!.split('@');
const run = Date.now().toString().slice(-6);
const password = `smoke-${run}-pass`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`, ok ? '' : JSON.stringify(info));
};
const until = async (what: string, f: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(20); }
};
const openSocket = (u: string) => new (WebSocket as any)(u, { headers: { Origin: origin } });
console.log(`Supabase: ${new URL(url).host}   runtime: ${new URL(runtimeUrl).host}   run: ${run}`);
const players: any[] = [];
for (const tag of ['a', 'b']) {
  const client = createPortalClient({ url, publishableKey: key, runtimeUrl, openSocket });
  const r: any = await client.signUp({ email: `${user}+${tag}${run}@${domain}`, password, displayName: `Smoke${tag.toUpperCase()}-${run}` });
  check(`sign up player ${tag.toUpperCase()}`, r.error === null, r);
  const c: any = await client.connectWorld();
  check(`player ${tag.toUpperCase()} connects to the world`, c.error === null, c);
  players.push({ client, conn: c.data });
}
const [A, B] = players.map((p) => p.conn);
await until('A and B to see each other', () => A.snapshot().room.players.some((p: any) => p.id === B.playerId) && B.snapshot().room.players.some((p: any) => p.id === A.playerId));
check('A and B see each other in the lobby', true);
const walk = async (c: any, x: number, z: number) => {
  const from = c.snapshot().self.position;
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 0.4));
  for (let i = 1; i <= steps; i++) { await sleep(100); c.sendMove({ x: from.x + (x - from.x) * i / steps, y: 0, z: from.z + (z - from.z) * i / steps }, 0); }
};
const path = async (c: any, pts: [number, number][]) => { for (const [x, z] of pts) await walk(c, x, z); };
await Promise.all([walk(A, -10.5, 0), walk(B, -10.5, 0)]);
check('A joins Portal Partners', (await A.joinRoom('portal')).error === null);
check('B joins Portal Partners', (await B.joinRoom('portal')).error === null);
await A.setReady(true); await B.setReady(true);
await until('the round to start', () => !!A.snapshot().room.session && !!B.snapshot().room.session);
const sid = A.snapshot().room.session.sessionId;
check('the round starts for both', B.snapshot().room.session.sessionId === sid);
let saved = 0; A.on('result.saved', () => saved++);
await walk(A, -5, 3);
await until('the bridge to open', () => B.snapshot().room.session?.bridgeOpen === true);
await path(B, [[0, -4], [1.5, -4]]);
check('B pulls the lever', (await B.interact('lever')).error === null);
await until('the lever to latch', () => A.snapshot().room.session?.latched === true);
await Promise.all([
  path(A, [[0, 2], [0, -2], [-5.5, -5]]).then(async () => check('A collects crystal A', (await A.interact('crystal-a')).error === null)),
  walk(B, 5.5, -5).then(async () => check('B collects crystal B', (await B.interact('crystal-b')).error === null)),
]);
await Promise.all([walk(A, -0.5, -6.5), walk(B, 0.5, -6.5)]);
await sleep(500);
check('B opens the exit', (await B.interact('exit')).error === null);
await until('result.saved', () => saved > 0, 30000);
check('game.finished is a win and result.saved arrives', A.snapshot().lastFinished?.outcome === 'win' && A.snapshot().lastFinished?.persistenceStatus === 'saved', A.snapshot().lastFinished);
for (const [tag, p] of [['A', players[0]], ['B', players[1]]] as const) {
  const r: any = await p.client.getMyResults();
  check(`${tag}'s history has the win`, r.data?.results.length === 1 && r.data.results[0].sessionId === sid && r.data.results[0].outcome === 'win', r);
  const me: any = await p.client.getMe();
  check(`${tag}'s winsTotal is 1`, me.data?.winsTotal === 1, me);
  await p.conn.leaveWorld();
  await p.client.signOut();
}
console.log(failed === 0 ? 'RUNTIME SMOKE CHECK PASSED' : `RUNTIME SMOKE CHECK FAILED (${failed})`);
console.log(`Test users to delete afterwards: ${user}+a${run}@${domain}, ${user}+b${run}@${domain}`);
process.exit(failed === 0 ? 0 : 1);
EOF
```

  - **Expected:** the first line shows your dev Supabase host and the dev runtime host. Then `PASS` lines for sign-up, connecting, seeing each other, joining, the round, the lever, both crystals, the exit, `result.saved`, each player's history, and each player's `winsTotal`, then `RUNTIME SMOKE CHECK PASSED`.
  - **If it fails:**
    - Connecting fails with `SERVICE_UNAVAILABLE`: the secret (step 3) or `SUPABASE_URL` (step 2) is wrong, or the migration is missing (step 4). Check the Worker's logs with `npx wrangler --cwd runtime tail --env dev` while rerunning. The logs show only event names, player IDs, and error codes, never tokens or keys.
    - The socket is refused (HTTP 403): `RUNTIME_ORIGIN` is not in `ALLOWED_ORIGINS`.
    - `UNAUTHORIZED`: the runtime cannot verify the token. Hosted dev must sign with asymmetric keys (step 3 of the Supabase checklist).
    - A timeout waiting for `result.saved`: the save is still retrying. Check the logs for `result.save_failed`.
  - **Clean up:** delete the two test users under **Authentication → Users**. Their results stay as rows with those players removed from the participants (`on delete cascade`); that is fine for a dev project.
  - Record the result here and in the pull request: date, initials, PASS or FAIL.
    - 11/21/2026, AL, PASS
- [x] 7. Give Ryan the dev runtime URL (`wss://portal-runtime-dev.<subdomain>.workers.dev/connect`), to pass as `runtimeUrl` to `createPortalClient` alongside the dev Supabase URL and publishable key. **Never** the secret key.

## Load check

Spec §10's load row; design in the [load-check design](../specs/2026-11-21-load-check-design.md). `scripts/load-check.ts` connects real clients, walks them around the lobby, and prints one block per scenario: incoming and outgoing messages per second, the free-tier hours per day at that load (research §6.2), move delivery delay (p50, p95, max), delivery percentage, problems (rejected moves, request errors, reconnects, connections that closed during the run with their reasons, other players in the lobby), the load generator's own event-loop delay (it includes the 10 ms sampling interval, so about 10 ms means no lag), and the run's UTC window. It is a measurement, not a pass/fail test. Any `WARNING:` line means those numbers should not be trusted as they stand. Do not claim capacity results until a hosted run is recorded here.

Scenarios (all players in the lobby): `baseline` 2 players, both moving; `full` 16 players, all moving; `quarter` 16 players, 4 moving. Options: `--scenario <name>` (repeatable; default all three), `--duration <seconds>` (default 60 per scenario), `--rate <hz>` (1 to 20, default 10).

- [x] 1. **Local run.** With the local stack running (`npm run db:start`): `npx tsx scripts/load-check.ts`. It starts its own local runtime and creates its own local test accounts; it takes about 4 minutes. Add `--duration 5` for a quick check that it works.
- [x] 2. **Hosted dev run** (Adam, manually; agents never run it). At the repository root, with `.env.development.local`. It already holds `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for hosted dev. Once, add the load-check user's email and password there, not on the command line, so the password stays out of shell history. The file is Git-ignored (`.env.*`).

```sh
LOAD_EMAIL=you@your-domain
LOAD_PASSWORD=<choose a password used only for these test users>
```

Then run:

```sh
RUNTIME_URL=wss://portal-runtime-dev.<subdomain>.workers.dev/connect \
RUNTIME_ORIGIN=http://127.0.0.1:4173 \
npx tsx --env-file=.env.development.local scripts/load-check.ts --hosted
```

  - The script runs only against hosted dev: `SUPABASE_URL` must have the same host as `env.dev.vars.SUPABASE_URL` in `runtime/wrangler.jsonc`, and the `RUNTIME_URL` host must start with `portal-runtime-dev.`. Anything else is refused before any sign-in. The first line shows both hosts.
  - On the first run it signs up `you+load01@your-domain` to `you+load16@your-domain` (display names `Load01` to `Load16`) and prints each one created; that is 17 auth calls. Later runs sign in as the same users with the same `LOAD_PASSWORD` (16 calls). Keep these users: deleting them just means the next run creates them again.
  - Run it when nobody else is in the hosted lobby. If others are there, each affected scenario prints a `WARNING:` naming how many, because their messages distort the rates.
  - The default run (three scenarios, 60 s each) sends about 13,200 messages, about 700 of the 100,000 daily free requests. Don't loop it.
  - **Dashboard:** open **Workers & Pages → portal-runtime-dev → Metrics**. The CPU Time and Wall Time charts show per-request percentiles (P50 to P999) in one-minute buckets, in your local time zone. Hover each bucket in the run's window and note the tooltip values. Each WebSocket connection counts as one request, lasting the whole scenario.
  - **If it fails:** `RATE_LIMITED` means hosted Supabase's sign-in limit (about 30 per 5 minutes per IP) was reached; wait 5 minutes and rerun, and users already created will just sign in. `WORLD_FULL` means others (for example Ryan testing) are using slots; rerun later or with `--scenario baseline`. `could not sign in or sign up (EMAIL_TAKEN)` on a later run means `LOAD_PASSWORD` differs from the first run's. `DISPLAY_NAME_TAKEN` means another account already uses a `LoadNN` name.
- [x] 3. **Record results** here and in the pull request: date, initials, mode (local or hosted), rate, and for each scenario: incoming/s, outgoing/s, delay p95, hours/day, warnings (if any), and for hosted runs the dashboard CPU and duration.
  - 11/21/2026, Claude (agent, local, 5 s per scenario, 10 Hz, quick check only): baseline 19.6/s in, 19.6/s out, p95 2 ms, 28.3 h/day; full 156.8/s in, 2,352/s out, p95 26 ms, 3.5 h/day; quarter 39.2/s in, 588/s out, p95 9 ms, 14.2 h/day. No warnings.
  - 11/21/2026, AL, **local**, 60 s per scenario, 10 Hz. No warnings; 100% delivery; no corrections, request errors, reconnects, closes, or other players.

    | Scenario | Incoming/s | Outgoing/s | Delay p50 / p95 / max | Hours/day |
    | --- | --- | --- | --- | --- |
    | baseline (2, 2 moving) | 19.9 | 19.9 | 2 / 3 / 5 ms | 27.9 |
    | full (16, 16 moving) | 159.2 | 2,388 | 12 / 23 / 91 ms | 3.5 |
    | quarter (16, 4 moving) | 39.8 | 597 | 5 / 10 / 60 ms | 14.0 |

  - 11/21/2026, AL, **hosted dev** (`portal-runtime-dev` and the dev Supabase project), 60 s per scenario, 10 Hz, windows 17:59:13 to 18:02:17 UTC. No warnings; 100% delivery; no corrections, request errors, reconnects, closes, or other players. Dashboard values are below the commentary.

    | Scenario | Incoming/s | Outgoing/s | Delay p50 / p95 / max | Hours/day | Generator event-loop p99 / max |
    | --- | --- | --- | --- | --- | --- |
    | baseline (2, 2 moving) | 19.9 | 19.9 | 29 / 34 / 53 ms | 27.9 | 11.5 / 18.0 ms |
    | full (16, 16 moving) | 158.9 | 2,384 | 33 / 44 / 206 ms | 3.5 | 11.6 / 98.6 ms |
    | quarter (16, 4 moving) | 39.7 | 596 | 28 / 36 / 157 ms | 14.0 | 11.7 / 122.0 ms |

    **Commentary (hosted run).** The results matched expectations.
    - **Message rates match the research.** Research §6.2 estimated 160 incoming messages/s and about 3.5 hours/day for all 16 moving at 10 Hz, and 40/s and about 13.9 hours/day for 25% moving. The measured 158.9/s (3.5 h) and 39.7/s (14.0 h) confirm those estimates. Outgoing traffic is exactly the expected fan-out: each move reaches the other 15 players (158.9 × 15 ≈ 2,384/s), and outgoing messages are not billed.
    - **The single World Durable Object kept up with a full world.** All 143,040 moves in the 16-player scenario reached every other player. The server rejected none, and no connection dropped or reconnected.
    - **Delay is mostly network, not server load.** Hosted p50 is about 29 ms with only 2 players (local: 2 ms), so that is the round trip through Cloudflare. Going from 2 to 16 moving players added about 4 ms at p50 and 10 ms at p95. For comparison, a 10 Hz move interval is 100 ms.
    - **The max delays (206 and 157 ms) are probably the load generator, not the server.** Those same scenarios show generator event-loop maximums of 98.6 and 122 ms, while the p99 stayed near the 10 ms sampling interval. That pattern fits brief pauses on this machine, for example garbage collection while it tracks 143,000 deliveries, rather than the server. Not confirmed.
    - **The free-tier hours are the worst case.** 3.5 hours/day assumes all 16 players moving all the time. Real play is likely nearer the quarter scenario (about 14 hours/day). The daily allowance is per Cloudflare account, so dev and production would share it unless they use separate accounts (research §6.2).
    - **Still open:** whether to call 16 players "supported" for FR-03 and AC-02 is a team decision. These runs measured a moving lobby only, not games in progress.

    **Dashboard (Workers & Pages → portal-runtime-dev → Metrics)**, read from chart tooltips by Claude from Adam's screenshots. One-minute buckets are in Central time (UTC−6). Mapping each bucket to the scenario that started in that minute is an assumption.

    | Bucket (CST) | Likely scenario | CPU time P50 / P90 / P99 / P999 | Wall time P50 / P90 / P99 / P999 |
    | --- | --- | --- | --- |
    | 11:59 | baseline | 0.56 / 1.33 / 1.33 / 1.33 ms | about 61 / 61 / 61 / 61 s |
    | 12:00 | full | 0.56 / 1.05 / 1.43 / 1.43 ms | about 61 / 61 / 61 / 61 s |
    | 12:01 | quarter | 0.64 / 0.88 / 0.94 / 0.94 ms | 61 / 62 / 62 / 62 s |

    Over the 30-minute view: CPU P50 0.59, P90 1.09, P99 1.23, P999 1.23 ms.

    **Commentary (dashboard).**
    - **Wall time** of about 61 s per request is each WebSocket connection held open for the whole scenario (60 s plus the 0.5 s settle and leaving). That is expected. Workers have no wall-time limit for HTTP requests, which these connections are.
    - **CPU time** is at most 1.43 ms per connection, against the Workers Free plan's 10 ms CPU per request, so at least 7 times headroom.
    - **Caveat:** these charts are the Worker's (`portal-runtime-dev`), and about 1 ms of CPU for a 60-second, 16-player connection suggests they cover only the front-door Worker that forwards each socket. They probably do not include the World Durable Object's processing of the moves. Cloudflare's docs do not say either way. The Durable Objects limits page gives 30 s of CPU per request or WebSocket message (each message resets it), far above anything a move handler needs. The docs are inconsistent on whether the Free plan's 10 ms also applies to Durable Objects.
    - **The World Durable Object's own CPU** (**Compute → Durable Objects → WorldObject → Metrics**, filtered to the World object, from Adam's screenshot and notes). At 12:00 the tooltip lists P90 below P999. The 12:01 values were transcribed in that order and are recorded here reordered.

      | Bucket (CST) | Likely scenario | CPU time P50 / P90 / P99 / P999 |
      | --- | --- | --- |
      | 11:59 | baseline | 0 / 353 / 353 / 353 ms |
      | 12:00 | full | 0.55 / 5.53 / about 4,000 / about 4,000 ms |
      | 12:01 | quarter | 0.52 / 5.2 / about 1,000 / about 1,000 ms |

      Over the 30-minute view: P50 0.54, P90 121, P99 about 2,000, P999 about 2,000 ms.

      Most of the World object's invocations are small (P50 about 0.5 ms, P90 about 5 ms). A few run long, and their CPU grows with the traffic in the minute: 353 ms with 2 players moving, about 1,000 ms with 4 of 16, and about 4,000 ms with all 16. That fits a long-lived WebSocket connection, or the 100 ms tick timer, being counted as one invocation that accumulates CPU over the whole minute. This is an interpretation: Cloudflare's docs do not say how CPU is attributed for non-hibernating WebSockets. It is not a limit concern. The Durable Objects CPU limit is 30 s per request and resets with each incoming WebSocket message, and the run showed no sign of CPU errors (no closes, 100% delivery, and delay up only about 4 ms from 2 to 16 players).
    - **Duration (GB-s):** the World object uses standard WebSockets, not hibernation, plus a 100 ms tick. So it is billed as awake whenever anyone is connected, regardless of how many players there are. The Free plan's 13,000 GB-s per day at 128 MB is about 28 object-hours per day (research §6.2). The binding daily limit is therefore requests (3.5 hours with all 16 moving), not duration.

## Production runtime (at first launch)

Not until launch, and only with explicit authorization from both partners.

- [ ] 1. Fill in `env.production` vars (`SUPABASE_URL` of the production project, `ALLOWED_ORIGINS` of the production frontend only; no local origins).
- [ ] 2. `npx wrangler --cwd runtime secret put SUPABASE_SECRET_KEY --env production` with the production secret key.
- [ ] 3. Apply migrations to production only through the authorized launch process.
- [ ] 4. `npx wrangler --cwd runtime deploy --env production`, then give Ryan the production runtime URL through the launch process.
