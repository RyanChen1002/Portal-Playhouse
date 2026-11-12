# Portal Playhouse — Governance

**Last updated:** 11/11/2026

## Change History

| Date | Change |
| --- | --- |
| 11/11/2026 | Created the initial risk register and added the project MIT license. Added change history, a shorter risk table, and mitigation details while preserving ratings, owners, and statuses. Standardized dates to MM/DD/YYYY and combined same-day changes. |

## Purpose

Track the project's main risks, who owns them, and how we plan to manage them. Read this alongside the [working agreement](working-agreement.md) and [development rules](development-rules.md).

## Risk Summary

Likelihood and impact use **Low**, **Medium**, and **High**. Statuses below are carried forward from the initial team document; they do not by themselves verify a deployed control.

| ID | Risk | Likelihood | Impact | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Personal data exposed to unauthorized users | Low | High | Adam (lead), Ryan | In progress |
| R2 | Unlicensed code included in the project | High | Low | Adam and Ryan | In progress |
| R3 | Account-creation spam disrupts access | Medium | Medium | Adam and Ryan | Not yet addressed |
| R4 | Agents incur costs without permission | Low | High | Adam and Ryan | Implemented |
| R5 | Supabase inactivity pause makes the database unavailable | High | Low | Adam (lead), Ryan | Implemented |

## Mitigation Details

### R1 — Protect personal data

Use database access controls, including row-level security, to protect emails and other personal data. Adam leads permission setup. Supabase Auth manages password hashing; application code does not store passwords. Never put a service-role key in frontend code or Git.

### R2 — Track code licensing

The project uses the [MIT license](../LICENSE). Retain required licenses and notices for third-party code; the project license does not replace those obligations.

### R3 — Limit account-creation abuse

The response is still undecided. Ideas for discussion include detecting repeated account-creation attempts and patterns from the same IP address. These are proposals, not implemented protections.

### R4 — Prevent unauthorized spending

The [agent instructions](../AGENTS.md) require team agreement before incurring costs. Use free resources by default and keep production credentials out of agent sessions.

### R5 — Prepare for database pauses

The initial risk assessment assumes the free Supabase project may pause after about a week of inactivity. Adam monitors availability and any provider alerts; the team manually resumes a paused project when needed. Check availability before class access and presentations.
