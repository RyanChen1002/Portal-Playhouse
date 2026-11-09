# Development and Merge Rules

Status: Approved by Ryan and Adam in the PR discussion. This document supplements the [team working agreement](working-agreement.md).

## Branch flow

```text
dev -> task branch -> pull request to dev -> pull request from dev to main
```

- `dev` is the default branch and contains integrated development work.
- `main` contains stable, production-ready work.
- Create every task branch from the latest `dev`, including documentation and tooling changes.
- Use names such as `feature/player-movement`, `fix/room-connection`, or `docs/development-rules`.
- Push task branches for review. Do not push changes directly to `dev` or `main`.
- Open task pull requests with `dev` as the base branch. Do not merge task branches directly into `main`.

## Review and merge into dev

1. Keep each pull request focused on one task. Describe the change, relevant checks and results, and any known limitations.
2. Use a draft pull request when work is not ready to merge. Mark it ready after addressing outstanding work.
3. The other teammate reviews the actual changes and leaves an approval comment on the pull request, tagging the author. A comment such as "Approved, @author" records their approval; using GitHub's formal Approve review is optional under our convention.
4. Resolve requested changes and conflicts, and pass applicable checks before merging. Ask for another review if the changes invalidate the earlier approval.
5. After teammate approval and the checks above, the author merges the pull request into `dev`. The author merges their PR; they do not approve their own changes.

A meeting or chat discussion can guide the review, but the teammate should record the approval on the GitHub pull request using their own account.

## Release from dev to main

1. Open a separate release pull request with `main` as the base and `dev` as the source branch.
2. Summarize the included changes and verify that the integrated project is ready for release. For documentation-only releases, verify document accuracy and links.
3. Both Ryan and Adam must agree to the release. The author records their agreement in the pull request description or a comment; the other teammate leaves an approval comment tagging the author.
4. The author, acting as a human, merges the approved release pull request. An AI agent must not merge into `main` or directly change the production database.
5. Keep `dev` after the release. Begin subsequent task branches from the latest `dev`.

Merging into `main` records a stable version; deploying or updating production requires its own explicitly authorized process.

## AI assistance and logs

- Agents work on task branches and may help prepare code, documentation, commits, and pull requests when authorized.
- Human review is required before any merge. Agent review does not replace teammate approval.
- Ryan stores personal AI logs in `agent-logs/ryan/`; Adam uses `agent-logs/adam/`. These folders contain logs and their README files only.
- Keep application code in shared folders organized by function.
- Superpowers setup and future workflow changes follow the same branch and review rules, through separate pull requests.

## Team convention

We agree to use pull requests and teammate approval every time. This is a team convention, not a requirement enforced through GitHub branch protection or rulesets.

This document does not change GitHub permissions or configure branch restrictions. Both teammates follow the agreed process even if GitHub technically allows a direct push or an unreviewed merge. Any future enforcement settings must be discussed and agreed separately.

Do not treat a green check or an agent's statement as proof of teammate approval; read the teammate's approval comment before merging.
