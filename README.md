# Portal Playhouse

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.5 | 11/21/2026 | Added the load-check command (`scripts/load-check.ts`) and noted its manual hosted mode. |
| 0.4 | 11/18/2026 | Added local runtime commands (`npm run test:runtime`, `npm run runtime:dev` with `runtime/.dev.vars`) and the link to the Cloudflare hosted setup checklist; integration tests now start the local runtime themselves. |
| 0.3 | 11/17/2026 | Local setup now starts the stack with `npm run db:start`, which first generates the Git-ignored local signing keys. |
| 0.2 | 11/15/2026 | Added frontend preview instructions and folder overview; clarified sample UI status and separate backend setup; consolidated history into one table. |
| 0.1 | 11/14/2026 | Added the Local development section and hosted checklist link, and updated Project status to describe the added backend foundation and point to the hosted setup checklist. |

A browser-based multiplayer 3D world where players explore connected rooms and play cooperative mini-games.

## Team

- **Ryan Chen:** Frontend and user interface.
- **Adam S. Levonian:** Backend and data management.

## Project status

The backend foundation includes the local Supabase stack, profile schema and functions, shared client and mock, tests, and CI. This branch adds a local frontend preview with original characters and a walkable 3D world. The preview uses sample data and is not connected to Supabase or live multiplayer. The first game remains undecided. Hosted dev project setup follows the [hosted Supabase setup checklist](doc/checklists/supabase-hosted-setup.md).

## Backend development

These steps are for backend development and tests. They are not required to run the frontend preview below.

Prerequisites:

- Docker Desktop, running.
- Node 22 via [nvm](https://github.com/nvm-sh/nvm): run `nvm use` in the repository (it reads `.nvmrc`).
- At least about 10 GB of free disk space for the Supabase images. A full disk can corrupt an image pull.

Commands:

```sh
npm ci                     # install pinned dependencies
npm run db:start           # generate local signing keys if absent, then start the local stack (first run pulls images)
npm run typecheck          # type check
npm test                   # unit and contract tests
npm run test:runtime       # runtime tests in the Workers test runtime (no Supabase needed)
npm run test:db            # database tests (pgTAP)
npx supabase db reset      # optional: a clean local database before the integration tests
npm run test:integration   # integration tests: real client, local runtime and local stack
```

The integration tests start the local runtime (the Worker and its World Durable Object, from `runtime/wrangler.jsonc`) themselves, against the local stack, so nothing else needs to be running.

To run the runtime by hand for local frontend work, copy `runtime/.dev.vars.example` to `runtime/.dev.vars`, fill in the local secret key from `npx supabase status`, and run `npm run runtime:dev`. The client's `runtimeUrl` is then `ws://127.0.0.1:8787/connect`, and connections are accepted only from `http://127.0.0.1:4173` and `http://localhost:4173`.

To measure load (message rates, move delay, and the free-tier projection for 2 and 16 players), run `npx tsx scripts/load-check.ts` with the local stack running. It takes about 4 minutes; add `--duration 5` for a quick run. See the [load check](doc/checklists/cloudflare-hosted-setup.md#load-check) for options, hosted dev, and recording results.

Stop the stack with `npx supabase stop`. All tests and scripts target the local stack only, except the load check's manual `--hosted` mode. The manual steps for the hosted projects are in the [hosted Supabase setup checklist](doc/checklists/supabase-hosted-setup.md) and the [Cloudflare hosted setup checklist](doc/checklists/cloudflare-hosted-setup.md) (the dev runtime).

## Try the frontend preview

Run `node tools/preview-server.cjs` from the repository root, then open http://127.0.0.1:4173 and choose **Explore demo**. No installation or credentials are needed for the visual preview. Use Node 22 to match the backend toolchain.

See the [frontend guide](frontend/README.md) for controls.

- `frontend/`: screens, 3D world, styles, and bundled Three.js with its license.
- `tools/`: local preview server.
- `shared/` and `supabase/`: Adam's merged backend client, database, and tests.
- `doc/`: requirements, frontend roadmap, and game ideas.

## Planned first release

- Accounts and persistent player profiles with 20 avatar choices.
- A shared 3D lobby and game rooms with an initial limit of 16 players across the whole world.
- A room board showing availability, participants, timing, and scores.
- One two-player cooperative mini-game, with participation locked during play.
- Saved game results and personal win totals.

The first mini-game is **TBD**. Game rules, controls, and multiplayer architecture still need agreement. Revisit capacity after performance testing. See the spec for requirements, proposals, and acceptance criteria.

## Selected services

- **Vercel:** Frontend hosting.
- **Supabase:** Authentication and persistent data.
- **Environments:** Separate development and production configurations and Supabase environments.

These are selected services, not a claim that deployment is configured. The frontend framework, authoritative game runtime, and real-time transport remain undecided.

## Repository

- [Working agreement](doc/working-agreement.md)
- [Initial spec](doc/initial-spec.md)
- [Component contract](doc/component-contract.md)
- [Future features](doc/future-features.md)
- [Hosted Supabase setup checklist](doc/checklists/supabase-hosted-setup.md)
- [Shared agent instructions](AGENTS.md)
- [Superpowers source and setup](.agents/SUPERPOWERS.md)
- [Ryan's AI agent logs](agent-logs/ryan/README.md)
- [Adam's AI agent log](agent-logs/adam/agentlog.md)

The personal agent-log folders contain logs only. Frontend and backend code live in their shared folders above.

## AI-assisted development

We use [Superpowers](https://github.com/obra/superpowers) skills for requirements discussions, design, planning, testing, and review. The upstream skills and supporting files are included under `.agents/skills/`, with the pinned source revision and license recorded in the setup document linked above.

Ask your coding agent to read `AGENTS.md` first and follow the relevant skills. Automatic discovery depends on the coding tool; including skill files does not install plugin hooks in every tool. Humans review changes before merging. Each developer writes their own agent-log reflections.

## Workflow

Use `dev` as the default integration branch and `main` for stable releases. Create task branches from the latest `dev`, then open pull requests into `dev` for partner review. Promote integrated work through a separate `dev` → `main` pull request with both partners' agreement. Do not push directly to either shared branch. Merging into `main` does not itself authorize deployment or production database updates.
