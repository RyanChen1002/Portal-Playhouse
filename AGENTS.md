# Portal Playhouse: Agent Instructions

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/11/2026 | Require Version, Date, and Change history columns; use MM/DD/YYYY dates and one row per date, newest first. Require current project documents to be read before development and reread after updates or branch changes. |

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

- **Required reading before development:** Before writing or changing code for each task, read the current [governance document](doc/governance.md), [relevant specification](doc/initial-spec.md), [component contract](doc/component-contract.md), and [development rules](doc/development-rules.md) from the working branch. Do not rely only on previous chat context or pinned references. Reread affected documents after they change or after switching branches. Follow their requirements throughout implementation and verification. If a required document is missing or the instructions conflict, explain the issue and resolve it before proceeding with affected work.
- Agree on the design before writing a product implementation plan; obtain approval before implementing it.
- Link each implementation plan to its approved specification and include checkable tasks and verification.
- Read and follow the [approved development rules](doc/development-rules.md) for branching, review, merging, and AI assistance.
- Whenever creating or editing team-maintained project documentation, including this file, add or update a **Change History** section near the top. Record the actual date in **MM/DD/YYYY** format (for example, `11/06/2026`) and a short, human-readable description, newest first. Include an initial entry for new documents and preserve older entries. Use one row per date in each document: combine same-day changes in the Change cell, using the latest document version in the Version cell and preserving earlier same-day version details in the Change cell when needed. Use exactly **Version | Date | Change** columns; do not include an Approval column or an approval-status header. Keep approval evidence in pull requests. Keep the document version header, when present, aligned with the latest history entry. Label formatting-only revisions clearly so they do not imply changed requirements. This requirement does not authorize editing upstream skill files or writing personal agent-log reflections.

## Ownership and evidence

- Ryan leads frontend and UI; Adam leads backend and data. Shared contracts and major architecture changes require joint decisions.
- Personal AI logs belong only in `agent-logs/ryan/` or `agent-logs/adam/`. Shared specifications and plans are project documentation, not personal logs.
- Verify behavior with checks appropriate to the change. For game logic, include relevant invalid actions, disconnects, and multiplayer state consistency. Report checks actually performed and unresolved limitations.
- Keep secrets out of Git, use sample data, and obtain team agreement before incurring costs.
- Personal agent-log reflections must be written by the developers in their own words, as required by the course; do not generate those reflections for them.
