# Portal Playhouse

## Change History

| Version | Date | Change |
| --- | --- | --- |
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
npx supabase start         # start the local stack (first run pulls images)
npm run typecheck          # type check
npm test                   # unit and contract tests
npm run test:db            # database tests (pgTAP)
npm run test:integration   # integration tests against the local stack
```

Stop the stack with `npx supabase stop`. All tests and scripts target the local stack only. The manual steps for the hosted projects are in the [hosted Supabase setup checklist](doc/checklists/supabase-hosted-setup.md).

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
