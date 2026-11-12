# Backend Design: Supabase Foundation, Auth, and Profiles

**Version:** 0.1

**Date:** 11/12/2026

**Author:** Adam (backend lead), drafted with Claude Code using Superpowers brainstorming

**Status:** Approved by Adam on 2026-11-11. Pending Ryan's review in the pull request.

**Plan:** [implementation plan](../plans/2026-11-11-backend-foundation-auth-profiles.md)

**Implements:** [initial spec](../initial-spec.md) FR-01, FR-02, FR-12 (backend part), AC-01, and the auth/profile parts of AC-07 and AC-08. **Interfaces:** [component contract](../component-contract.md) §2–§4. **Research:** [auth provider](../research/auth-provider.md).

Labels used below: **Decided** means Adam decided it in brainstorming, pending Ryan's review in the PR. **Proposal** means a call made while drafting, for Ryan and Adam to accept or change.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/12/2026 | Added the initial backend design for the Supabase foundation, auth, and profiles; contract update renumbered to v0.4. |

## 1. Intent

Deliver the backend half of milestone 1 (accounts/profile):

- Players can create an account, sign in, and get back the same saved profile (display name and avatar) on every later login.
- Ryan gets a **fixed, typed boundary** to build the account/profile screens against: a shared TypeScript client with a matching mock. He can build before the backend is finished and switch to the real one without code changes.
- It sets up the foundation every later backend piece needs: a hosted dev environment, a local development stack, migrations, a test suite, and CI.

Why this boundary matters: Ryan and Adam work in parallel and swap components at midpoint (contract §1). Interfaces that don't depend on internal table layouts let either side change internals without breaking the other.

## 2. Goals, non-goals, anti-goals

**Goals**

- A hosted Supabase **dev** project configured for email + password sign-in.
- A profile created automatically, and complete, for every new account.
- **Unique display names** that players can change later.
- Get and update own profile through database functions that return the contract's Profile shape and error format.
- A shared client (types, real implementation, mock) in `shared/`.
- Automated database, integration, and contract tests, run locally and on every pull request.
- A contract update (v0.4) recording the interface changes this design makes (§10).

**Non-goals (this spec)**

- Creating or configuring the **production** project. It's created at the first launch (**Decided**), from the checklist in §5.1.
- Rooms, presence, the world capacity limit, the room board, game sessions, results tables, and actual win counting. `winsTotal` is returned as `0` until the results component exists.
- Email confirmation, password reset, magic links, OAuth, and custom SMTP (all **Decided** out; see research §7).
- Account deletion and display-name moderation.
- Frontend screens (Ryan's), and deploying anything to production.

**Anti-goals** (failures even if everything else works)

- A client can change its identity, someone else's profile, or its win total.
- Two players end up with the same display name.
- Ryan's code comes to depend on table or column names.
- Any test, script, or agent writes to the production project.
- Secrets (service-role/secret keys, database passwords) are committed to Git or shipped to the browser.

## 3. Constraints

- Supabase Auth and database; Vercel hosts the frontend (initial spec §1).
- Separate dev and production Supabase projects, both owned by Adam (**Decided**). The dev project is created first; production is created at the first launch (**Decided**). Free plan: at most 2 active projects, and projects pause after 1 week of inactivity. Pauses are accepted and resumed manually (**Decided**).
- All hosted-project steps are **manual checklist items performed by Adam**, not agent tasks (**Decided**).
- Free resources by default; no costs without team agreement.
- Agents must not merge into `main` or change the production database (development rules).
- The real-time runtime is still open. This design must not presume it, but should not block a Supabase-centered runtime either.

## 4. Approaches considered

All three share the same core: a profiles table created by a sign-up trigger, with constraints and row-level security (RLS). They differ in what the frontend calls.

1. **Frontend reads/writes the table directly** with `supabase-js`. Least backend code, but the table layout becomes the interface. Responses use database naming, and errors are raw PostgREST errors that someone must translate into the contract format.
2. **Database functions as the API** (`get_me`, `update_me`), called through `supabase.rpc`, with direct table access blocked. The backend owns the contract shapes and errors, and there's no extra hosting. The same transaction-based pattern is likely needed later for atomic room admission and result saving. Logic is written in SQL/PL/pgSQL.
3. **An HTTP API** (Vercel serverless or Supabase Edge Functions) implementing `/api/me` literally. Matches the contract's wording and keeps logic in TypeScript, but adds a deployed layer, Deno or a dependency on Ryan's undecided framework, and duplicates checks the database already makes.

**Decided: option 2, plus a shared TypeScript client.** It gives the most fixed frontend/backend boundary for no extra hosting. If the runtime research later selects a dedicated game service, profiles can stay as database functions, and the service reads the database with its own server credentials.

Consequence: Supabase verifies access tokens for these calls, so this milestone has no custom token-verification code. Tests cover it as permission/RLS behavior. A reusable verifier is deferred until a custom service exists.

## 5. Design

### 5.1 Environments and configuration

| Environment | What it is | Who/what uses it |
| --- | --- | --- |
| **Local** | Supabase CLI stack in Docker | All development and all automated tests, locally and in CI |
| **Dev** (hosted) | Adam's dev Supabase project, created in this milestone | Manual smoke checks; Ryan's integration against a hosted backend |
| **Production** (hosted) | Adam's production Supabase project, created at first launch | Real users. Changes only through an explicitly authorized human process; never a test target |

- Auth settings (**Decided**): email + password provider enabled, sign-ups open, email confirmation **off**, every other provider off, anonymous sign-ins off.
- Minimum password length: **8** (**Proposal**; Supabase's default is 6).
- Asymmetric JWT signing keys on each hosted project (**Proposal**, from research §5). It future-proofs local token verification for a later game service.
- Auth settings live in `supabase/config.toml` for the local stack. Hosted projects are configured to match by hand.
- **Hosted setup checklist** (a deliverable of the plan; performed by Adam, **Decided**):
  - **Dev, this milestone:**
    1. Create the project.
    2. Apply the auth settings above.
    3. Enable asymmetric signing keys.
    4. Apply migrations after each merge into `dev`.
    5. Run the hosted advisors.
    6. Do the manual smoke check (§6).
    7. Record that settings match `config.toml`.
  - **Production, at first launch (not this milestone):** create the project, apply the same auth settings, and enable signing keys, with explicit authorization. Applying migrations to production is part of a separate, authorized launch process.
- Frontend configuration needs only each environment's project URL and **publishable** key, which are safe to expose. Secret/service-role keys are used only by local scripts and tests, kept in Git-ignored env files, with a committed `.env.example` listing names but no values. No agent needs hosted credentials for this milestone.

### 5.2 Data

**Avatar catalog** (**Proposal**): a reference table seeded by migration with exactly 20 stable IDs, `avatar-01` … `avatar-20` (contract §3). Profiles reference it with a foreign key, so unknown IDs are rejected by the database itself. Assets and display names for avatars stay with Ryan and are out of scope.

**Profile** (one row per auth user):

| Field | Rule |
| --- | --- |
| User ID | Primary key; equals the Supabase Auth user ID; deleted along with the auth user |
| Display name | Required; normalized and validated per the display-name rule below; **unique** (**Decided**) |
| Avatar ID | Required; must exist in the avatar catalog; default `avatar-01` |
| Created / updated timestamps | Server-set, UTC |

There's no stored wins column. `winsTotal` is derived from trusted results once they exist (contract §3, §7). Until then the functions return `0`.

**Display-name rule** (applied identically in SQL, the shared client, and the mock):

- **Normalize:** trim leading/trailing whitespace and collapse internal runs of whitespace to a single space. The normalized form is what's stored and returned.
- **Length:** **1–24** after normalization (**Proposal**), counted in Unicode code points (Postgres `char_length`; JavaScript `Array.from(s).length`, not `s.length`).
- **Characters:** reject control characters and invisible/formatting characters (e.g. zero-width spaces, bidirectional overrides, byte-order mark). Otherwise any visible character is allowed. (**Proposal**; whether Ryan's 3D nameplate font can render emoji may tighten this.)
- **Uniqueness** (**Decided**): no two profiles share a display name. Comparison is **case-insensitive** (**Proposal**: "Alex" and "alex" count as the same name, so players can't impersonate each other by changing case). Enforced by a unique index on the case-folded name, so concurrent claims can't both succeed. A player may change the case of their own name. Names freed by a change are immediately available to others.

**Data placement** (**Proposal**): tables live in a schema not exposed through Supabase's Data API, so clients can't read or write them directly at all. The `anon` and `authenticated` roles get no direct table privileges. RLS is still enabled on every table as defense in depth. The exact schema/privilege arrangement is left to the builder, within §5.4's security rules.

### 5.3 Profile creation at sign-up

- **Decided:** the backend creates the profile automatically and complete when the account is created (option (a)), with avatar `avatar-01`.
- This backend choice doesn't rule out forcing the player to choose an avatar before entering the lobby; this is to be decided and implement at the frontend level by the frontend lead.
- The sign-up form sends the chosen display name as sign-up metadata. A trigger on new auth users reads it, normalizes and validates it, and creates the profile.
- That metadata is user-supplied, so it's used **only** as an initial value, validated like any other input, and never for authorization.
- **Taken names at sign-up** (**Proposal**): the shared client's `signUp` first calls `check_display_name` and returns `DISPLAY_NAME_TAKEN` without creating the account if the name is taken.
- **Sign-up must not fail because of the profile.** If the metadata name is missing, invalid, or claimed by someone else between the check and account creation, the trigger falls back to a generated unique name (e.g. `Player-` plus a short random suffix, retried on collision) instead of raising an error that would block account creation. Because `signUp` returns the created Profile, the UI can detect the fallback and prompt for a new name. (**Proposal**)

### 5.4 Functions (the backend API)

All functions act only on the caller's own profile, using the identity from the verified session, never an ID passed by the client. All are called through `supabase.rpc`.

| Function | Callable by | Input | Returns | Contract equivalent |
| --- | --- | --- | --- | --- |
| `get_me` | signed-in users | none | Profile JSON: `{id, displayName, avatarId, winsTotal}` | `GET /api/me` |
| `update_me` | signed-in users | `displayName?`, `avatarId?`; at least one required | Updated Profile JSON | `PATCH /api/me` |
| `check_display_name` | anyone, including signed out | `displayName` | `{available: boolean}` for the normalized name, or a validation error | New (for sign-up and name editing) |

- Output keys are camelCase, exactly matching the contract's Profile model.
- `update_me`: omitted fields are left unchanged. Null or empty input for a provided field is a validation error.
- `check_display_name` is advisory only. The unique index is the real guarantee, and `update_me` still returns `DISPLAY_NAME_TAKEN` if a name is claimed in between. Display names are already public on the room board, so letting signed-out users check availability reveals nothing private. (**Proposal**)
- Errors use stable, machine-readable codes the shared client maps to `{error: {code, message, field?}}`. `field` names the input the error belongs to (`displayName`, `avatarId`, `email`, or `password`) when there is one, so the UI can attach the error to that input and screen readers announce it there (WCAG 3.3.1, Error Identification). When several inputs are invalid, the first one checked is reported, in this order: display name, then avatar. `field` is omitted for errors that aren't about one input. It's deliberately omitted for `INVALID_CREDENTIALS`, so the response doesn't reveal whether the email or the password was wrong. Codes:
  - `VALIDATION_ERROR`: no fields provided; display name empty, too long, or containing disallowed characters after normalization; or unknown avatar ID.
  - `DISPLAY_NAME_TAKEN` (**new code**, `409`-class): the normalized name belongs to another player.
  - `UNAUTHORIZED`: not signed in, or invalid/expired session.
  - If a signed-in user somehow has no profile, return `SERVICE_UNAVAILABLE` and log it. This shouldn't happen because of §5.3.
- The mechanism for carrying the code from SQL to the client (e.g. custom SQLSTATE values, or a code prefix in the message) is left to the builder, provided the client can map it reliably and tests pin it.

**Security rules** (from Supabase guidance; the plan must include checks for each):

- `get_me` and `update_me`: callable by `authenticated` only. `check_display_name`: callable by `anon` and `authenticated`, read-only, returning only availability. Revoke execute from `PUBLIC` on all functions and grant explicitly.
- Prefer `SECURITY INVOKER`. If `SECURITY DEFINER` is needed to reach the unexposed tables, the function must: set an empty `search_path`, derive the user only from `auth.uid()` (where it acts on a user), touch only that user's row, and grant execute only to the roles listed above.
- Never use `user_metadata` claims for authorization.
- The Supabase database advisors run clean (no security warnings) before merge.

### 5.5 Shared client (`shared/`)

The boundary Ryan builds against. **Joint ownership**: Ryan reviews it, and changes need both partners' approval (contract §9).

- **`shared/contracts/`**: TypeScript types for `Profile`, error codes, and the `{error: {code, message, field?}}` shape (§5.4), plus the display-name rule and the 20 avatar IDs as constants and a shared validation function, so the UI can validate before calling.
- **The client interface** (one interface, two implementations):
  - `signUp({email, password, displayName})` and `signIn({email, password})` return the player's **Profile** on success, so the UI can go straight on (e.g. to an avatar picker). (**Proposal**)
  - `signOut()`; `getSession()` returning whether a player is signed in and their ID; a session-change subscription.
  - `getMe(): Profile`, `updateMe({displayName?, avatarId?}): Profile`, `checkDisplayName(displayName): {available}`.
  - Results are returned as a success/error union (`{data}` or `{error: {code, message}}`), not thrown, matching `supabase-js` conventions. (**Proposal**)
- **Auth error normalization** (**Proposal**; new codes): Supabase Auth's provider errors are mapped to these codes, with the `field` each carries:
  - `EMAIL_TAKEN` (`email`): email already registered.
  - `INVALID_CREDENTIALS` (no field): wrong email or password.
  - `WEAK_PASSWORD` (`password`): too short or rejected by password rules.
  - `RATE_LIMITED` (no field): Supabase Auth rate limit hit.
  - `SERVICE_UNAVAILABLE` (no field): network failure or service down.
  - `VALIDATION_ERROR` (`email` or `displayName`): malformed email or display name, caught before calling Supabase.
  - `DISPLAY_NAME_TAKEN` (`displayName`): from the sign-up pre-check.
- `message` is plain-language text suitable for developers and as a fallback. Ryan's UI is expected to show its own wording keyed on `code` and `field`.
- **Real implementation**: built on `supabase-js`, configured with a project URL and publishable key. It knows function names, not table names.
- **Mock implementation** in `shared/mocks/`: in-memory, same interface, same validation, uniqueness, and error codes, with sample data only. It's what Ryan uses before the backend is ready, and it's what makes switching a one-line change.
- Location of the real client (e.g. `shared/client/`) is a **Proposal**. The contract only names `shared/contracts/` and `shared/mocks/`.

### 5.6 Repository layout and tooling (Proposals, pending Ryan's agreement where shared)

- `supabase/`: CLI config, migrations, seed, and database tests.
- `shared/`: contracts, client, mocks, and their tests.
- TypeScript; `@supabase/supabase-js` and the Supabase CLI as **pinned** dev dependencies with a committed lockfile, so everyone and CI use the same versions.
- **Node 22 or 24 LTS** pinned via `.nvmrc`, npm, and Vitest. These are shared with Ryan's frontend, so they're **for joint agreement**. The root `package.json` structure (single package or npm workspaces) must not block Ryan's frontend later; the builder picks whatever accommodates that.

## 6. Testing and verification

All automated tests run against the **local** stack only.

| Layer | Tool | Covers |
| --- | --- | --- |
| Database | pgTAP via `supabase test db` | Profile auto-created on sign-up with default avatar; metadata name normalized; fallback name when metadata missing, invalid, or taken; display-name rule (length in code points, whitespace normalization, disallowed characters); case-insensitive uniqueness, including changing the case of one's own name; exactly 20 seeded avatars; `anon` can call only `check_display_name` and has no table access; `authenticated` has no direct table access; functions touch only the caller's row; users can't change their ID or wins |
| Integration | Vitest + real shared client against the local stack | AC-01: sign up → sign out → sign in → same profile; two accounts see only their own profiles; every `VALIDATION_ERROR` case; `DISPLAY_NAME_TAKEN` at sign-up and on update; each auth error code that can be triggered locally; signed-out calls return `UNAUTHORIZED`; failed updates leave the profile unchanged (AC-07) |
| Contract | Vitest | The real client and the mock produce identically shaped results and identical error codes for the same scenarios, including uniqueness, so the mock can't drift |
| Security | Supabase database advisors | No security warnings |
| Config | Checklist (§5.1) | Hosted dev auth settings match `config.toml`; Git-ignored env files; no secrets tracked (AC-08, environment separation) |

- **Concurrency:** at least one test has two players claim the same display name at the same time, and asserts exactly one succeeds.
- **Test accounts helper**: a script that creates N users with unique display names on the local stack via the admin API. It's used by integration tests now and by multi-player tests (AC-02) later. It refuses to run against any non-local URL.
- **CI**: a GitHub Actions workflow on every pull request into `dev`. It sets up the pinned Supabase CLI, starts the local stack, runs the database and Vitest suites, and runs the advisors. It must stay within GitHub's free allowance.
- **Manual smoke check** on the hosted dev project before merging: sign up, sign in, read and update the profile, try a taken name, sign out and back in.

## 7. Acceptance for this milestone

- AC-01 passes (integration test), including rejection of unknown avatar IDs.
- Display names are unique (case-insensitive), including under concurrent claims.
- AC-07 (auth/profile part): unauthenticated and invalid calls don't change state.
- AC-08 (environment part): the local stack and hosted dev project are configured to match, and nothing points at production.
- The mock and real client pass the same contract tests.
- CI is green on the pull request, and the advisors are clean.
- Ryan has reviewed `shared/`, the error codes, and the contract update.

## 8. Open items for Ryan

1. **Display-name rule:** 1–24 characters (**Proposal**), case-insensitive uniqueness, the allowed characters, and whether the nameplate font handles emoji.
2. Node version, test runner, package layout (§5.6).
3. The client interface: result style, what sign-up/sign-in return, and the `shared/client/` location (§5.5).
4. New error codes: `DISPLAY_NAME_TAKEN`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `WEAK_PASSWORD`, `RATE_LIMITED`. Also the optional `field` on errors, added to support accessible form errors.
5. The research decisions (sign-in method, no confirmation, no reset, no OAuth).
6. The suggestion in §5.3 about the avatar picker after sign-up is Ryan's to accept or ignore.

## 9. Left to the builder

- Exact schema names, function/trigger implementation, and privilege grants, within §5.2–§5.4.
- How SQL error codes are carried to the client.
- How invisible/formatting characters are detected consistently in SQL and TypeScript.
- Fallback-name format and collision retry.
- CI workflow details and caching.
- Internal structure of tests and the account-helper script.

## 10. Contract update (v0.4)

Contract §9 requires both partners to approve interface changes before anyone builds against them. Alongside this spec, the same pull request proposes a **component contract v0.4** recording:

- The profile operations become database functions called through `supabase.rpc` (`get_me`, `update_me`, `check_display_name`) instead of `GET/PATCH /api/me`, with the same semantics.
- Display names are unique (case-insensitive) and follow the §5.2 rule.
- The new error codes in §5.4 and §5.5, and the optional `field` on errors.
- The shared client and its result style, and the `shared/client/` location.

Ryan's approval of the pull request approves the spec and the contract update together. Implementation starts only after that approval.
