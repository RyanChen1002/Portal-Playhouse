# Portal Playhouse: Agent Instructions

## Change History

| Date | Change |
| --- | --- |
| 11/11/2026 | Require change history for project documentation; use MM/DD/YYYY dates and one row per date, newest first. |

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
- Whenever creating or editing team-maintained project documentation, including this file, add or update a **Change History** section near the top. Record the actual date in **MM/DD/YYYY** format (for example, `11/06/2026`) and a short, human-readable description, newest first. Include an initial entry for new documents and preserve older entries. Use one row per date in each document: combine same-day changes in the Change cell, keeping any distinct versions and approval details in that row. For formatting-only edits, record the change without inventing a new content version; record approvals only when explicitly given. This requirement does not authorize editing upstream skill files or writing personal agent-log reflections.

## Ownership and evidence

- Ryan leads frontend and UI; Adam leads backend and data. Shared contracts and major architecture changes require joint decisions.
- Personal AI logs belong only in `agent-logs/ryan/` or `agent-logs/adam/`. Shared specifications and plans are project documentation, not personal logs.
- Verify behavior with checks appropriate to the change. For game logic, include relevant invalid actions, disconnects, and multiplayer state consistency. Report checks actually performed and unresolved limitations.
- Keep secrets out of Git, use sample data, and obtain team agreement before incurring costs.
- Personal agent-log reflections must be written by the developers in their own words, as required by the course; do not generate those reflections for them.
