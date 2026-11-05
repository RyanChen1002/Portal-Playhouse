# Team Working Agreement

## Project Choice

We chose **Project Option A** because we want to collaborate closely throughout development. We do not have a strong preference for adopting a new platform, and this option gives us a clear way to build the project together.

Our project is **Portal Playhouse**, a browser-based multiplayer 3D world where players explore connected rooms and play cooperative mini-games.

## Roles and Decisions

- **Ryan Chen:** Frontend and user interface.
- **Adam S. Levonian:** Backend and data management.

Each person leads decisions in their area and keeps the other partner informed. We will make decisions about architecture, project scope, security, and major changes together.

## Tools

- **Ryan:** Codex GPT-6 Luna in VS Code.
- **Adam:** Claude.

## Communication

We will use email for project communication. We aim to respond within **48 hours on weekdays** and **24 hours on weekends**. We will check in weekly and contact each other sooner if we are blocked or need a decision.

## Repository Workflow

We will use `main` as the stable, production-ready branch and `dev` for integration. Each developer will create a task branch from `dev`, make and test changes there, and open a pull request back to `dev`. The other partner will review the pull request before it is merged. When the integrated work is ready, we will review and merge `dev` into `main`.

No one will push directly to `main`. Both partners must approve changes that affect project scope or the production-ready version.

## AI Agent Rules

We will keep agent logs in separate folders in the repository: `agent-logs/ryan/` and `agent-logs/adam/`. These folders contain personal agent logs only. Application code will be organized separately by function.

Agents may help draft or review code, but they may not merge changes into `main` or directly update the production database. A separate agent should review agent-generated code when practical, and a human must review all changes before they are merged.

## Disagreements and Delays

We will discuss disagreements by email and decide together. If we cannot agree quickly, we will defer or simplify the disputed feature and continue with work we both support. If someone falls behind or gets blocked, they will tell the other partner as soon as possible so we can adjust tasks. We will notify the instructor if a delay puts a project deadline at risk.

## Data and Costs

We will use synthetic or sample data and will not commit passwords, API keys, or other secrets to the repository. Each developer will keep local secrets out of version control. We will use free resources by default and agree together before making any paid purchase or incurring project costs.
