# Superpowers: Local Skill Installation

Source: https://github.com/obra/superpowers

Pinned commit: `22f0b463e7a5e579904dd6211a520321035526f7`

Downloaded: November 8, 2026

License: [upstream MIT license](skills/SUPERPOWERS-LICENSE)

All 15 upstream skills and their supporting files are installed locally under `skills/`: brainstorming, diagnosing-superpowers, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, and writing-skills.

These are actual upstream skill files, not project templates. This session's skill catalog now lists all 15 repository skills, confirming discovery here. The full plugin's hooks were not installed here, so Codex relies on `AGENTS.md` directing it to read these skills. Adam uses Claude Code with the Superpowers plugin (user scope, version 7.0.2, same pinned commit `22f0b463…`), which provides the skills and hooks; the skill files were verified identical to this directory as of 2026-10-11. If the plugin updates beyond the pinned revision, the two setups may drift, so update this record deliberately (see below). No global coding-tool configuration was changed by this repository.

Start at [using-superpowers](skills/using-superpowers/SKILL.md), then read the relevant skill before acting. Higher-priority instructions and the user's project restrictions apply: local work only until authorized; no automatic push/merge/production updates. This setup intentionally retains a single root AGENTS.md.

Project documents: [initial spec](../doc/initial-spec.md), [component contract](../doc/component-contract.md). Future approved feature designs/plans may use `doc/designs/` and `doc/plans/`; do not duplicate initial requirements. Those folders are created only when they have real documents.

Updates must be deliberate: inspect a new upstream revision, reinstall from that exact revision, update this record and license, and review changes before publishing. Do not silently download latest skill instructions during project work.
