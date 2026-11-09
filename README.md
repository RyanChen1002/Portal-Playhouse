# Portal Playhouse

A browser-based multiplayer 3D world where players explore connected rooms and play cooperative mini-games.

## Team

- **Ryan Chen:** Frontend and user interface.
- **Adam S. Levonian:** Backend and data management.

## Project status

Planning and documentation stage. The initial spec and component contract are drafts awaiting team review. Application code, local run instructions, and deployed URLs will be added as development begins.

## Planned first release

- Accounts and persistent player profiles with 20 avatar choices.
- A shared 3D lobby with a target capacity of 16 users.
- A room board showing availability, participants, timing, and scores.
- One two-player cooperative mini-game, with participation locked during play.
- Saved game results and personal win totals.

The first mini-game is **TBD**. The capacity counting rule, game rules, controls, and multiplayer architecture still need agreement. See the spec for requirements, proposals, and acceptance criteria.

## Selected services

- **Vercel:** Frontend hosting.
- **Supabase:** Authentication and persistent data.
- **Environments:** Separate development and production configurations and Supabase environments.

These are selected services, not a claim that deployment is configured. The frontend framework, authoritative game runtime, and real-time transport remain undecided.

## Repository

- [Working agreement](doc/working-agreement.md)
- [Initial spec — draft](doc/initial-spec.md)
- [Component contract — draft](doc/component-contract.md)
- [Shared agent instructions](AGENTS.md)
- [Superpowers source and setup](.agents/SUPERPOWERS.md)
- [Ryan's AI agent logs](agent-logs/ryan/README.md)
- [Adam's AI agent logs](agent-logs/adam/README.md)

The personal agent-log folders contain logs only. Application code will be organized in shared folders by function as development begins.

## AI-assisted development

We use [Superpowers](https://github.com/obra/superpowers) skills for requirements discussions, design, planning, testing, and review. The upstream skills and supporting files are included under `.agents/skills/`, with the pinned source revision and license recorded in the setup document linked above.

Ask your coding agent to read `AGENTS.md` first and follow the relevant skills. Automatic discovery depends on the coding tool; including skill files does not install plugin hooks in every tool. Humans review changes before merging. Each developer writes their own agent-log reflections.

## Workflow

Use `dev` as the default integration branch and `main` for stable releases. Create task branches from the latest `dev`, then open pull requests into `dev` for partner review. Promote integrated work through a separate `dev` → `main` pull request with both partners' agreement. Do not push directly to either shared branch. Merging into `main` does not itself authorize deployment or production database updates.
