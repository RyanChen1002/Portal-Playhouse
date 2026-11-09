# Portal Playhouse: Agent Instructions

Read [the project README](README.md), [the working agreement](doc/working-agreement.md), [the initial spec](doc/initial-spec.md), and [the draft component contract](doc/component-contract.md) before starting work.

This is the single shared agent instruction file for Ryan and Adam. If your coding tool does not load it automatically, explicitly ask the agent to read it at the start of the session.

## Project context

- Distinguish confirmed requirements, course requirements, proposals, and unanswered questions in the spec and contract.
- Interview the user when a missing decision changes the scope or architecture. Do not invent approved requirements, technology choices, deadlines, or test results.
- Ryan selected Superpowers. Read the [installation record](.agents/SUPERPOWERS.md) and [using-superpowers skill](.agents/skills/using-superpowers/SKILL.md), then relevant skills before acting. All 15 repository skills are discovered in this session; plugin hooks and discovery in other coding tools are not verified.
- Use the initial spec and component contract as the current review drafts. Keep a single requirements source rather than duplicating it under a toolkit folder.
- Confirmed clarifications: first game remains TBD; Vercel hosts the frontend; Supabase provides Auth/database; use separate dev/production environments.

## Workflow

- Agree on the design before writing a product implementation plan; obtain approval before implementing it.
- Link each implementation plan to its approved specification and include checkable tasks and verification.
- Follow task branch -> PR to `dev` -> separate release PR from `dev` to `main`.
- Branch from the latest `dev`. Do not push directly to `dev` or `main`. Never merge into `main` or directly update a production database.
- Human review is required before any merge. Agent review is supplementary; do not submit a human approval on someone's behalf.
- Current work is local only. Do not stage, commit, push, create pull requests, or perform other Git actions until Ryan authorizes them.
- The proposed detailed development rules are being reviewed separately in [PR #1](https://github.com/RyanChen1002/Portal-Playhouse/pull/1); do not assume they have merged. If `doc/development-rules.md` exists on the current branch, read it too.

## Ownership and evidence

- Ryan leads frontend and UI; Adam leads backend and data. Shared contracts and major architecture changes require joint decisions.
- Personal AI logs belong only in `agent-logs/ryan/` or `agent-logs/adam/`. Shared specifications and plans are project documentation, not personal logs.
- Verify behavior with checks appropriate to the change. For game logic, include relevant invalid actions, disconnects, and multiplayer state consistency. Report checks actually performed and unresolved limitations.
- Keep secrets out of Git, use sample data, and obtain team agreement before incurring costs.
- Personal agent-log reflections must be written by the developers in their own words, as required by the course; do not generate those reflections for them.
