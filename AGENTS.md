# Portal Playhouse: Agent Instructions

Read [the project README](README.md), [the working agreement](doc/working-agreement.md), [the initial spec](doc/initial-spec.md), and [the draft component contract](doc/component-contract.md) before starting work.

This is the single shared agent instruction file for Ryan and Adam. If your coding tool does not load it automatically, explicitly ask the agent to read it at the start of the session.

## Project context

- Distinguish confirmed requirements, course requirements, proposals, and unanswered questions in the spec and contract.
- Interview the user when a missing decision changes the scope or architecture. Do not invent approved requirements, technology choices, deadlines, or test results.
- Ryan selected Superpowers. Read the [installation record](.agents/SUPERPOWERS.md), then use the relevant skills before acting.
  - Codex (Ryan): read the [using-superpowers skill](.agents/skills/using-superpowers/SKILL.md) in `.agents/skills/`, then the relevant skills. All 15 repository skills are discovered in this session; plugin hooks are not installed.
  - Claude Code (Adam): the Superpowers plugin (user scope, same pinned commit) provides the skills and session-start hook. Use the plugin's `superpowers:*` skills; the repo copy under `.agents/skills/` is identical and does not need to be read separately.
  - Discovery in other coding tools is not verified.
- Use the initial spec and component contract as the current review drafts. Keep a single requirements source rather than duplicating it under a toolkit folder.
- Confirmed clarifications: first game remains TBD; Vercel hosts the frontend; Supabase provides Auth/database; use separate dev/production environments.

## Workflow

- Agree on the design before writing a product implementation plan; obtain approval before implementing it.
- Link each implementation plan to its approved specification and include checkable tasks and verification.
- Read and follow the [approved development rules](doc/development-rules.md) for branching, review, merging, and AI assistance.

## Ownership and evidence

- Ryan leads frontend and UI; Adam leads backend and data. Shared contracts and major architecture changes require joint decisions.
- Personal AI logs belong only in `agent-logs/ryan/` or `agent-logs/adam/`. Shared specifications and plans are project documentation, not personal logs.
- Verify behavior with checks appropriate to the change. For game logic, include relevant invalid actions, disconnects, and multiplayer state consistency. Report checks actually performed and unresolved limitations.
- Keep secrets out of Git, use sample data, and obtain team agreement before incurring costs.
- Personal agent-log reflections must be written by the developers in their own words, as required by the course; do not generate those reflections for them.
