# Cloudflare Hosted Setup Checklist

**Version:** 0.3

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.3 | 11/21/2026 | Replaced the deferred load-check note with the Load check section: local and hosted-dev runs of `scripts/load-check.ts`, reading the dashboard, and recording results; recorded a 5-second local quick check. After review: hosted mode accepts only the dev hosts from `runtime/wrangler.jsonc`, a first run uses 17 auth calls, and other players in the lobby produce a warning (`RATE_LIMITED` added to "If it fails"). Then, at Adam's request: connections that close during a run are reported with their reasons (and named as the cause of missing moves), and the event-loop line notes the 10 ms sampling interval. Earlier the same day (0.2): Claude marked step 4 done (the hosted dev advisors showed only the five accepted findings, including the new `get_my_results` one, now recorded in the Supabase checklist); Adam ticked the completed tasks. |
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

- [ ] 1. **Local run.** With the local stack running (`npm run db:start`): `npx tsx scripts/load-check.ts`. It starts its own local runtime and creates its own local test accounts; it takes about 4 minutes. Add `--duration 5` for a quick check that it works.
- [ ] 2. **Hosted dev run** (Adam, manually; agents never run it). At the repository root with `.env.development.local` (it holds `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for hosted dev):

```sh
RUNTIME_URL=wss://portal-runtime-dev.<subdomain>.workers.dev/connect \
RUNTIME_ORIGIN=http://127.0.0.1:4173 \
LOAD_EMAIL=you@your-domain \
LOAD_PASSWORD='<choose a password; keep it out of Git>' \
npx tsx --env-file=.env.development.local scripts/load-check.ts --hosted
```

  - The script runs only against hosted dev: `SUPABASE_URL` must have the same host as `env.dev.vars.SUPABASE_URL` in `runtime/wrangler.jsonc`, and the `RUNTIME_URL` host must start with `portal-runtime-dev.`. Anything else is refused before any sign-in. The first line shows both hosts.
  - On the first run it signs up `you+load01@your-domain` to `you+load16@your-domain` (display names `Load01` to `Load16`) and prints each one created; that is 17 auth calls. Later runs sign in as the same users with the same `LOAD_PASSWORD` (16 calls). Keep these users: deleting them just means the next run creates them again.
  - Run it when nobody else is in the hosted lobby. If others are there, each affected scenario prints a `WARNING:` naming how many, because their messages distort the rates.
  - The default run (three scenarios, 60 s each) sends about 13,200 messages, about 700 of the 100,000 daily free requests. Don't loop it.
  - **Dashboard:** for each scenario's printed UTC window, open **Workers & Pages → portal-runtime-dev → Metrics** (Durable Objects) and note CPU time and wall-clock duration.
  - **If it fails:** `RATE_LIMITED` means hosted Supabase's sign-in limit (about 30 per 5 minutes per IP) was reached; wait 5 minutes and rerun, and users already created will just sign in. `WORLD_FULL` means others (for example Ryan testing) are using slots; rerun later or with `--scenario baseline`. `could not sign in or sign up (EMAIL_TAKEN)` on a later run means `LOAD_PASSWORD` differs from the first run's. `DISPLAY_NAME_TAKEN` means another account already uses a `LoadNN` name.
- [ ] 3. **Record results** here and in the pull request: date, initials, mode (local or hosted), rate, and for each scenario: incoming/s, outgoing/s, delay p95, hours/day, warnings (if any), and for hosted runs the dashboard CPU and duration.
  - 11/21/2026, Claude (agent, local, 5 s per scenario, 10 Hz, quick check only): baseline 19.6/s in, 19.6/s out, p95 2 ms, 28.3 h/day; full 156.8/s in, 2,352/s out, p95 26 ms, 3.5 h/day; quarter 39.2/s in, 588/s out, p95 9 ms, 14.2 h/day. No warnings.

## Production runtime (at first launch)

Not until launch, and only with explicit authorization from both partners.

- [ ] 1. Fill in `env.production` vars (`SUPABASE_URL` of the production project, `ALLOWED_ORIGINS` of the production frontend only; no local origins).
- [ ] 2. `npx wrangler --cwd runtime secret put SUPABASE_SECRET_KEY --env production` with the production secret key.
- [ ] 3. Apply migrations to production only through the authorized launch process.
- [ ] 4. `npx wrangler --cwd runtime deploy --env production`, then give Ryan the production runtime URL through the launch process.
