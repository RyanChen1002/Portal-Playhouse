# Backend Foundation, Auth, and Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** 0.1

**Date:** 11/12/2026

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/12/2026 | Added the initial implementation plan for backend foundation, auth, and profiles; contract reference updated to v0.4. |

**Goal:** Local Supabase stack, profile schema with unique display names, three database functions, and a shared TypeScript client (real + mock) with database, integration, and contract tests running in CI.

**Architecture:** Tables live in an unexposed `private` schema. Clients reach them only through three `SECURITY DEFINER` functions in `public`, called with `supabase.rpc`. A sign-up trigger creates every profile. `shared/` holds the contract types, the display-name rule, a real client over `supabase-js`, and an in-memory mock. One contract test suite runs against both the mock and the real client.

**Tech Stack:** Supabase CLI v3 (local Docker stack, pgTAP via `supabase test db`), Postgres/PL/pgSQL, TypeScript, `@supabase/supabase-js` v2, Vitest, `tsx`, npm workspaces, GitHub Actions. Node 22 LTS.

**Spec:** [doc/specs/2026-11-11-backend-foundation-auth-profiles-design.md](../specs/2026-11-11-backend-foundation-auth-profiles-design.md). Read it before starting; this plan argues from it.

**Start condition:** Do not start until Ryan has approved the pull request containing the spec and the contract v0.4 update (spec §10), and it is merged into `dev`. Then create `feature/backend-foundation-auth-profiles` from the latest `dev`.

## Global Constraints

- All automated tests and scripts target the **local** stack only. Nothing in this plan touches a hosted project except Task 9's manual checklist, which Adam performs. Agents never run a command with `--remote`.
- Supabase CLI **v3**: commands are local by default. Hosted commands need `--remote` and a confirmation.
- Pin every dependency exactly (`npm install -D -E`) and commit `package-lock.json`. Versions current on 2026-11-11, for reference: `supabase` 3.1.0, `@supabase/supabase-js` 2.119.0, `vitest` 5.1.0, `typescript` 7.0.2, `tsx` 4.23.15.
- `.nvmrc` contains `22`.
- Avatar IDs: exactly `avatar-01` … `avatar-20`. Default `avatar-01`.
- Display name: normalized; 1–24 Unicode code points; case-insensitively unique (rule below).
- Minimum password length: 8.
- Auth: email + password, sign-ups open, email confirmation off, anonymous sign-ins off, no external providers.
- Error codes (exact strings): `VALIDATION_ERROR`, `UNAUTHORIZED`, `DISPLAY_NAME_TAKEN`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `WEAK_PASSWORD`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`.
- Profile JSON keys: `id`, `displayName`, `avatarId`, `winsTotal` (`winsTotal` is always `0` in this milestone).
- `anon`/`authenticated` get **no** privileges on `private` tables. `private` is not in the Data API's exposed schemas.
- Never use `raw_user_meta_data` / `user_metadata` for authorization. It's read only as the initial display name.
- No secrets in Git. `.env.example` lists names only.

### The display-name rule (identical in SQL and TypeScript)

1. **Whitespace set** `W`: U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
2. **Normalize:** strip leading and trailing `W` characters, then replace every run of one or more `W` characters with a single U+0020.
3. **Disallowed set** `D` (checked after normalizing): U+0000–U+001F, U+007F–U+009F, U+00AD, U+061C, U+180E, U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF, U+FFF9–U+FFFB.
4. **Valid** if the normalized name has 1–24 code points and no character from `D`.
5. **Uniqueness key:** `lower(normalized)` in SQL; `normalized.toLowerCase()` in TypeScript. They agree for the test inputs listed in Task 2. Case folding of rare scripts may differ, and the database is authoritative.

### Error transport from SQL (pinned)

Functions raise errors with `errcode` `'PT400'` / `'PT401'` / `'PT409'` / `'PT503'` and `message` set to the bare contract code (e.g. `'VALIDATION_ERROR'`). A human-readable explanation goes in `detail`. The field name, when the error concerns one input, goes in `hint` (`'displayName'` or `'avatarId'`). PostgREST turns `PTxyz` into HTTP status `xyz`. Validation order in `update_me`: display name first, then avatar (spec §5.4). The real client maps:

- `error.message` that's one of the codes → that code, with `field` taken from `error.hint` when it's a known field name.
- `error.code === '42501'` or HTTP 401 → `UNAUTHORIZED`.
- Anything else → `SERVICE_UNAVAILABLE`.

## Review Focus

1. **A player saves their own current name, or changes only its case.** Expected: success, not `DISPLAY_NAME_TAKEN`. Owned by Task 5 (pgTAP) and Task 8 (contract suite).
2. **An update with a valid name and an invalid avatar.** Expected: the whole update is rejected and nothing changes. Owned by Task 5.
3. **Names that JavaScript and Postgres might treat differently** (`"Zoë"`, `"  a   b  "`, 24 vs 25 emoji, `"a​b"`, `"é"`). Expected: the mock and the real database give identical results. Owned by Task 8 (contract suite) and Task 2 (unit).
4. **A call with an expired or garbage access token.** Expected: `UNAUTHORIZED`, not a crash or `SERVICE_UNAVAILABLE`. Owned by Task 8.
5. **Running tests while the local stack is stopped.** Expected: one clear message, "Local Supabase is not running. Run: npx supabase start", not a wall of fetch errors. Owned by Task 7.

---

## File Structure

```
.nvmrc                                   Node version (22)
package.json                             root: private, npm workspaces ["shared"], scripts
package-lock.json
tsconfig.base.json                       shared TS settings
vitest.config.ts                         root Vitest config (projects: unit, integration)
.env.example                             variable names only
.gitignore                               + .env*, supabase/.temp, node_modules
supabase/config.toml                     local stack + auth settings
supabase/migrations/<ts>_profiles_schema.sql    private schema, avatars, profiles, rule functions
supabase/migrations/<ts>_signup_trigger.sql     auth.users trigger + fallback name
supabase/migrations/<ts>_profile_api.sql        get_me, update_me, check_display_name + grants
supabase/tests/database/01_schema.test.sql
supabase/tests/database/02_signup_trigger.test.sql
supabase/tests/database/03_profile_api.test.sql
supabase/tests/database/04_privileges.test.sql
shared/package.json                      @portal-playhouse/shared
shared/tsconfig.json
shared/contracts/index.ts                types, error codes, constants
shared/contracts/display-name.ts         normalize/validate/uniqueness key
shared/contracts/credentials.ts          email/password pre-validation
shared/contracts/*.test.ts
shared/client/index.ts                   createPortalClient (real)
shared/client/errors.ts                  mapping Supabase errors to AppError
shared/client/errors.test.ts
shared/mocks/index.ts                    createMockPortalClient
shared/test/contract-suite.ts            describeClientContract(name, factory)
shared/test/mock.contract.test.ts
shared/test/real.contract.integration.test.ts
shared/test/real.integration.test.ts     AC-01, concurrency, tokens
scripts/local-env.ts                     getLocalSupabaseEnv()
scripts/create-test-accounts.ts          createTestAccounts() + CLI
scripts/*.test.ts
.github/workflows/ci.yml
doc/checklists/supabase-hosted-setup.md  Adam's manual hosted checklist
README.md                                + local development section
```

`npm test` runs the unit project, which needs no stack. `npm run test:integration` runs the integration project and needs `npx supabase start`. `npm run test:db` runs `supabase test db`.

---

### Task 1: Tooling and local stack

**Files:**
- Create: `.nvmrc`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `shared/package.json`, `shared/tsconfig.json`, `supabase/config.toml` (via `npx supabase init`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm scripts `test` (Vitest unit project: `**/*.test.ts` excluding `*.integration.test.ts`), `test:integration` (Vitest integration project: `**/*.integration.test.ts`, run serially), `test:db` (`supabase test db`), `typecheck` (`tsc -b` or `tsc --noEmit` over root and `shared`), `db:start`/`db:stop`/`db:reset`. Workspace package name `@portal-playhouse/shared`.

- [ ] **Step 1:** Switch to Node 22 (`nvm use` after writing `.nvmrc`). Create the root `package.json` (`"private": true`, `"workspaces": ["shared"]`, `"engines": {"node": ">=22 <23"}`). Install exact dev dependencies: `supabase`, `@supabase/supabase-js`, `vitest`, `typescript`, `tsx`, `@types/node`.
- [ ] **Step 2:** Run `npx supabase --version`. Expected: `3.x`.
- [ ] **Step 3:** Run `npx supabase init`, then set in `supabase/config.toml`:
  - `[auth] enable_signup = true`, `minimum_password_length = 8`, `enable_anonymous_sign_ins = false`
  - `[auth.email] enable_signup = true`, `enable_confirmations = false`
  - leave every `[auth.external.*]` disabled
  - `[api] schemas` must **not** include `private`
  - raise `[auth.rate_limit]` sign-in/sign-up limits enough for the integration suite (local only; note this in a comment)

  Look keys up with `npx supabase --help` and the generated file. Don't guess.
- [ ] **Step 4:** Add a trivial `shared/contracts/smoke.test.ts` (`expect(1).toBe(1)`), run `npm test`. Expected: 1 passed. Delete the smoke test after Task 2 adds real tests.
- [ ] **Step 5:** `npx supabase start`, then `npx supabase status`. Expected: API URL `http://127.0.0.1:54321` and keys printed. Note the key names this CLI prints in `-o json` output (publishable/secret or anon/service_role) for Task 7.
- [ ] **Step 6:** Add `.env*` (except `.env.example`), `supabase/.temp/`, `supabase/.branches/` and `node_modules/` to `.gitignore`. `.env.example` lists `SUPABASE_URL=` and `SUPABASE_PUBLISHABLE_KEY=`. Check `git status` shows no secrets.
- [ ] **Step 7: Commit** `chore: add Node/TypeScript tooling and local Supabase stack`.

---

### Task 2: Shared contracts and validation

**Files:**
- Create: `shared/contracts/index.ts`, `shared/contracts/display-name.ts`, `shared/contracts/credentials.ts`
- Test: `shared/contracts/display-name.test.ts`, `shared/contracts/credentials.test.ts`

**Interfaces:**
- Produces (all exported from `shared/contracts/index.ts`):
  - `type ErrorCode` = union of the eight Global Constraints codes; `const ERROR_CODES: readonly ErrorCode[]`
  - `type ErrorField = 'displayName' | 'avatarId' | 'email' | 'password'`; `interface AppError { code: ErrorCode; message: string; field?: ErrorField }`
  - `type Result<T> = { data: T; error: null } | { data: null; error: AppError }`
  - `const AVATAR_IDS` = the 20 IDs as a readonly tuple; `type AvatarId`; `const DEFAULT_AVATAR_ID = 'avatar-01'`
  - `interface Profile { id: string; displayName: string; avatarId: AvatarId; winsTotal: number }`
  - `interface SessionState { signedIn: boolean; playerId: string | null }`
  - `interface PortalClient` with `signUp({email, password, displayName}): Promise<Result<Profile>>`, `signIn({email, password}): Promise<Result<Profile>>`, `signOut(): Promise<Result<null>>`, `getSession(): Promise<Result<SessionState>>`, `onSessionChange(cb: (s: SessionState) => void): () => void` (returns unsubscribe), `getMe(): Promise<Result<Profile>>`, `updateMe({displayName?, avatarId?}): Promise<Result<Profile>>`, `checkDisplayName(displayName: string): Promise<Result<{available: boolean}>>`
  - `DISPLAY_NAME_MIN = 1`, `DISPLAY_NAME_MAX = 24`, `PASSWORD_MIN = 8`
  - `normalizeDisplayName(raw: string): string`
  - `validateDisplayName(raw: string): { ok: true; value: string } | { ok: false; error: AppError }` (normalizes, then checks)
  - `displayNameKey(normalized: string): string` (lowercase)
  - `isAvatarId(x: unknown): x is AvatarId`
  - `validateCredentials({email, password}): AppError | null` (email must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, otherwise `VALIDATION_ERROR` with `field: 'email'`; password shorter than 8 code points gives `WEAK_PASSWORD` with `field: 'password'`). `validateDisplayName` errors carry `field: 'displayName'`.

- [ ] **Step 1: Write failing tests** in `display-name.test.ts`:
  - `normalizes whitespace`: `normalizeDisplayName("  Ada  \t Lovelace  ")` → `"Ada Lovelace"`
  - `counts code points`: 24 × `"🙂"` valid; 25 × `"🙂"` → `VALIDATION_ERROR`; `"é"` valid (2 code points)
  - `bounds`: `""` and `"   "` → `VALIDATION_ERROR`; `"a".repeat(24)` valid; `"a".repeat(25)` invalid
  - `rejects disallowed`: `"a​b"`, `"a‮b"`, `"﻿ab"`, `"a\u0007b"` → `VALIDATION_ERROR`
  - `allows visible unicode`: `"Zoë"`, `"山田"` valid
  - `key is case-insensitive`: `displayNameKey("Alex") === displayNameKey("aLEX")`
  - `avatar ids`: `AVATAR_IDS.length === 20`, first `avatar-01`, last `avatar-20`; `isAvatarId("avatar-21") === false`

  In `credentials.test.ts`: `"not-an-email"` → `VALIDATION_ERROR` with `field: 'email'`; a 7-char password → `WEAK_PASSWORD` with `field: 'password'`; valid pair → `null`. In `display-name.test.ts`, every invalid case also asserts `field: 'displayName'`.
- [ ] **Step 2:** `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. Build `W` and `D` as `RegExp`s with the `u` flag from the exact ranges in Global Constraints.
- [ ] **Step 4:** `npm test` and `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(shared): add contract types and display-name rule`.

---

### Task 3: Profile schema

**Files:**
- Create: migration via `npx supabase migration new profiles_schema`
- Test: `supabase/tests/database/01_schema.test.sql`

**Interfaces:**
- Produces:
  - schema `private`
  - `private.avatars(id text primary key)` seeded with the 20 IDs in this migration (so hosted projects get them)
  - `private.profiles(id uuid primary key references auth.users(id) on delete cascade, display_name text not null, avatar_id text not null default 'avatar-01' references private.avatars(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now())`
  - `private.normalize_display_name(raw text) returns text` (immutable)
  - `private.is_valid_display_name(normalized text) returns boolean` (immutable)
  - check constraint `display_name = private.normalize_display_name(display_name) and private.is_valid_display_name(display_name)`
  - unique index `profiles_display_name_key` on `lower(display_name)`
  - trigger to maintain `updated_at`
  - RLS enabled on both tables, no policies
  - `revoke all on schema private, all tables in schema private from anon, authenticated, public`

- [ ] **Step 1: Write failing pgTAP tests** (`begin; select plan(n); … select * from finish(); rollback;`):
  - `has_table('private','profiles')`; `has_table('private','avatars')`
  - `(select count(*) from private.avatars) = 20`, min `avatar-01`, max `avatar-20`
  - `normalize_display_name(E'  Ada  \t Lovelace  ') = 'Ada Lovelace'`
  - `is_valid_display_name` agrees with every Task 2 case (24/25 emoji, `é`, empty, `a​b`, `a‮b`, `﻿ab`, BEL, `Zoë`, `山田`)
  - inserting two profiles named `Alex` and `alex` → `throws_ok(..., '23505')`
  - inserting `avatar_id = 'avatar-21'` → `throws_ok(..., '23503')`
  - `row_security_active` / `relrowsecurity` true for both tables

  To insert profiles in tests, first insert rows into `auth.users(id, email)`. The trigger from Task 4 doesn't exist yet, so insert profiles directly.
- [ ] **Step 2:** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. In SQL, build `W` and `D` as bracket expressions using `\uXXXX` escapes in Postgres regular expressions (`regexp_replace(..., 'g')`), matching the Global Constraints ranges exactly. Use `char_length` for length.
- [ ] **Step 4:** `npx supabase db reset`, then `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): add private profiles schema with display-name rule`.

---

### Task 4: Sign-up trigger

**Files:**
- Create: migration `signup_trigger`
- Test: `supabase/tests/database/02_signup_trigger.test.sql`

**Interfaces:**
- Consumes: Task 3 tables and rule functions.
- Produces: `private.handle_new_user()` (`security definer`, `set search_path = ''`) and an `after insert on auth.users for each row` trigger. Reads `new.raw_user_meta_data->>'display_name'`, normalizes and validates it, and inserts the profile. If the name is missing, invalid, or hits `unique_violation`, it uses `'Player-' || 6 random lowercase hex chars`, retrying up to 10 times on collision. It never raises for name problems.

- [ ] **Step 1: Write failing tests:**
  - an insert with metadata `{"display_name":"  Grace   Hopper "}` → profile `Grace Hopper`, avatar `avatar-01`
  - no metadata → name matches `^Player-[0-9a-f]{6}$`
  - metadata `"a​b"` → fallback name
  - metadata `"grace hopper"` while `Grace Hopper` exists → fallback name, and the auth user is still created
  - `delete from auth.users` → the profile is gone (cascade)
- [ ] **Step 2:** `npm run test:db`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement the migration.
- [ ] **Step 4:** `npx supabase db reset && npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): create profile on sign-up with fallback name`.

---

### Task 5: Profile API functions

**Files:**
- Create: migration `profile_api`
- Test: `supabase/tests/database/03_profile_api.test.sql`, `supabase/tests/database/04_privileges.test.sql`

**Interfaces:**
- Consumes: Task 3 and 4.
- Produces (all in `public`, `language plpgsql`, `security definer`, `set search_path = ''`, `revoke execute … from public`):
  - `public.get_me() returns jsonb`. `{id, displayName, avatarId, winsTotal: 0}`. `auth.uid()` null → `PT401 UNAUTHORIZED`; no profile row → `PT503 SERVICE_UNAVAILABLE`, also emitting a `raise warning` for the log. Grant to `authenticated`.
  - `public.update_me(display_name text default null, avatar_id text default null) returns jsonb`. Both null → `PT400 VALIDATION_ERROR`. A provided name that's invalid after normalizing (including empty) → `PT400`. Unknown avatar → `PT400`. Name taken by **another** user (matching `lower()`, `id <> auth.uid()`), or `unique_violation` → `PT409 DISPLAY_NAME_TAKEN`. Validate everything before writing, so nothing is partially applied. Returns the same shape as `get_me`. Grant to `authenticated`.
  - `public.check_display_name(display_name text) returns jsonb`. Invalid → `PT400`. Otherwise `{available: boolean}`, where `true` also when the only match is the caller's own profile. Grant to `anon, authenticated`.
  - Error `message` = bare code, `detail` = human text, `hint` = field name for name/avatar errors (Global Constraints). Validate the name before the avatar.
  - Note: an "empty string provided" and an "omitted" argument differ. `update_me(display_name => '')` is a validation error, not "unchanged".

- [ ] **Step 1: Write failing tests.** Create the users in the test. Act as a user with `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);` and as signed-out with `set local role anon`.
  - **03 (behavior):**
    - `get_me` returns the exact JSON for the caller
    - `update_me(avatar_id => 'avatar-07')` changes only the avatar
    - `update_me()` → `throws_ok('PT400', 'VALIDATION_ERROR')`
    - `update_me(display_name => '')` → `PT400`
    - `update_me(avatar_id => 'avatar-21')` → `PT400`
    - another user owns `Alex`: `update_me(display_name => 'ALEX')` → `PT409 DISPLAY_NAME_TAKEN`
    - **Review focus 1:** the caller named `Alex` calls `update_me(display_name => 'Alex')` and then `'aLeX'` → both succeed, and the stored name becomes `aLeX`
    - **Review focus 2:** `update_me(display_name => 'Fresh Name', avatar_id => 'avatar-99')` → `PT400` with hint `avatarId`, and the name is unchanged afterwards
    - `update_me(display_name => '', avatar_id => 'avatar-99')` → hint `displayName` (the name is checked first); `PT409` carries hint `displayName`
    - after renaming `Alex` → `Ada`, another user can claim `alex`
    - `check_display_name('  alex ')` → `{"available": false}` for another user and `true` for the owner; `check_display_name('a​b')` → `PT400`
    - `update_me` as user A never changes user B's row
  - **04 (privileges):**
    - as `anon`: `get_me()` and `update_me(...)` → `throws_ok('42501')`; `check_display_name('x')` succeeds; `select from private.profiles` → `42501`
    - as `authenticated`: direct `select`/`update` on `private.profiles` and `private.avatars` → `42501`
    - `has_function_privilege('anon', 'public.get_me()', 'execute')` is false
    - `pg_proc.proconfig` for each function contains `search_path=""`
- [ ] **Step 2:** `npm run test:db`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement the migration.
- [ ] **Step 4:** `npx supabase db reset && npm run test:db`. Expected: PASS.
- [ ] **Step 5:** Run the advisors (`npx supabase db advisors`, or the v3 equivalent per `npx supabase db --help`). Expected: no security warnings. If a lint flags the `SECURITY DEFINER` functions being executable by `anon`/`authenticated`, that's intended for these three functions only. Record the lint name and the reason in a comment at the top of the migration and in the PR description, and don't suppress anything else.
- [ ] **Step 6: Commit** `feat(db): add get_me, update_me, check_display_name`.

---

### Task 6: Mock client and contract suite

**Files:**
- Create: `shared/mocks/index.ts`, `shared/test/contract-suite.ts`, `shared/test/mock.contract.test.ts`

**Interfaces:**
- Consumes: Task 2 contracts.
- Produces:
  - `createMockPortalClient(options?: { store?: MockStore }): PortalClient` and `createMockStore(): MockStore`. Several clients sharing one store simulate several players. Each client holds its own session.
  - `describeClientContract(label: string, factory: ContractFactory): void`, where `interface ContractFactory { newClient(): Promise<PortalClient>; uniqueEmail(): string; uniqueName(): string }`. Uniqueness helpers let the real run reuse a database without collisions.

  The mock follows the same rules as the database: validation first, a `VALIDATION_ERROR` for empty updates, `DISPLAY_NAME_TAKEN` via `displayNameKey` excluding self, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `UNAUTHORIZED` when signed out, and `winsTotal: 0`. On sign-up it mirrors the trigger's fallback only if called with a name taken after its own pre-check, which can't happen in a single-threaded mock, so the mock's `signUp` simply returns `DISPLAY_NAME_TAKEN`.

- [ ] **Step 1: Write the suite** (`contract-suite.ts`). Each `it` asserts the `Result` shape, the exact code, and the exact `field`: `displayName`/`avatarId`/`email`/`password` as the spec assigns it, and **absent** for `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, and `updateMe({})`. Cases:
  - `signUp returns profile with normalized name and avatar-01, winsTotal 0`
  - `signUp → signOut → signIn returns the same profile` (AC-01)
  - `getSession reflects sign in/out; onSessionChange fires and unsubscribes`
  - `signUp with taken name (other case) → DISPLAY_NAME_TAKEN`
  - `signUp with existing email → EMAIL_TAKEN`
  - `signIn wrong password → INVALID_CREDENTIALS`
  - `signUp short password → WEAK_PASSWORD`; `bad email → VALIDATION_ERROR`
  - `getMe/updateMe while signed out → UNAUTHORIZED`
  - `updateMe({}) → VALIDATION_ERROR`; `updateMe({avatarId:'avatar-21'}) → VALIDATION_ERROR`; `updateMe({displayName:'   '}) → VALIDATION_ERROR`
  - `updateMe own name with different case succeeds` (Review focus 1)
  - `updateMe name owned by another player → DISPLAY_NAME_TAKEN`, and the profile is unchanged afterwards
  - `checkDisplayName` available/taken/invalid
  - **Review focus 3** (parametrized; same expectations as Task 2): `"Zoë"`, `"  a   b  "` → stored `"a b"`, 24/25 × `"🙂"`, `"a​b"`, `"é"`, each through `updateMe`
- [ ] **Step 2:** `mock.contract.test.ts` calls `describeClientContract('mock', …)`. Run `npm test`. Expected: FAIL (no mock).
- [ ] **Step 3:** Implement the mock.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add mock client and shared contract suite`.

---

### Task 7: Local environment and test-account helpers

**Files:**
- Create: `scripts/local-env.ts`, `scripts/create-test-accounts.ts`
- Test: `scripts/local-env.test.ts`, `scripts/create-test-accounts.integration.test.ts`

**Interfaces:**
- Produces:
  - `getLocalSupabaseEnv(): Promise<{ url: string; publishableKey: string; secretKey: string }>`. Runs `npx supabase status -o json` and accepts either key naming the CLI prints (publishable/secret or anon/service_role). If the stack isn't running, it throws `Error('Local Supabase is not running. Run: npx supabase start')` (Review focus 5).
  - `assertLocalUrl(url: string): void`. Throws unless the hostname is `127.0.0.1` or `localhost`.
  - `createTestAccounts(n: number, env: {url: string; secretKey: string}, opts?: {prefix?: string}): Promise<Array<{id: string; email: string; password: string; displayName: string}>>`. Calls `assertLocalUrl` first, then uses the admin API `createUser({email, password, email_confirm: true, user_metadata: {display_name}})`. Names are `<prefix>-<run id>-<i>` and stay ≤ 24 code points.
  - CLI: `npx tsx scripts/create-test-accounts.ts <n>` prints the JSON array.

- [ ] **Step 1: Write failing tests:**
  - unit: `assertLocalUrl('https://abc.supabase.co')` throws; `http://127.0.0.1:54321` passes
  - unit: with the status command stubbed to fail, `getLocalSupabaseEnv` rejects with the exact message
  - integration: `createTestAccounts(3, env)` returns 3 accounts, each can `signIn` via `@supabase/supabase-js`, and the profile names equal the returned `displayName`s
- [ ] **Step 2:** Run both test projects. Expected: FAIL.
- [ ] **Step 3:** Implement. Make the status-command runner injectable for the unit test.
- [ ] **Step 4:** `npm test && npm run test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): add local env and test-account helpers`.

---

### Task 8: Real client and integration tests

**Files:**
- Create: `shared/client/index.ts`, `shared/client/errors.ts`
- Test: `shared/client/errors.test.ts`, `shared/test/real.contract.integration.test.ts`, `shared/test/real.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 contracts, Task 5 functions, Task 6 suite, Task 7 helpers.
- Produces:
  - `createPortalClient(config: { url: string; publishableKey: string; storage?: SupportedStorage }): PortalClient`. Each instance holds its own session (pass in-memory `storage` in tests so instances don't share sessions). Calls only `rpc('get_me')`, `rpc('update_me', {display_name, avatar_id})`, `rpc('check_display_name', {display_name})` and `auth.*`, never `from(<table>)`.
  - `mapRpcError(err: {message?: string; code?: string; status?: number} | null): AppError`
  - `mapRpcError` sets `field` from `err.hint` only when it is `'displayName'` or `'avatarId'`.
  - `mapAuthError(err: {code?: string; status?: number; name?: string} | null): AppError`:
    - `user_already_exists`/`email_exists` → `EMAIL_TAKEN`, field `email`
    - `invalid_credentials` → `INVALID_CREDENTIALS`, no field
    - `weak_password` → `WEAK_PASSWORD`, field `password`
    - `over_request_rate_limit`/`over_email_send_rate_limit`/status 429 → `RATE_LIMITED`
    - `validation_failed`/`email_address_invalid` → `VALIDATION_ERROR`, field `email`
    - `AuthRetryableFetchError` or status 0 → `SERVICE_UNAVAILABLE`
    - anything else → `SERVICE_UNAVAILABLE`
  - `signUp` order: `validateCredentials` → `validateDisplayName` → `checkDisplayName` (taken → `DISPLAY_NAME_TAKEN`) → `auth.signUp({email, password, options: {data: {display_name: normalized}}})` → `getMe`. Returns the Profile, which may carry a fallback name (spec §5.3).
  - `signIn` → `auth.signInWithPassword` → `getMe`.

- [ ] **Step 1: Write failing unit tests** (`errors.test.ts`): one case per mapping row above, asserting code and field, plus `mapRpcError({message:'DISPLAY_NAME_TAKEN', code:'PT409', hint:'displayName'})` → `DISPLAY_NAME_TAKEN` with field `displayName`, an unknown hint → no field, `{code:'42501'}` → `UNAUTHORIZED`, `{message:'boom'}` → `SERVICE_UNAVAILABLE`.
- [ ] **Step 2: Write failing integration tests:**
  - `real.contract.integration.test.ts`: `describeClientContract('real', …)` with a factory building `createPortalClient` from `getLocalSupabaseEnv()`.
  - `real.integration.test.ts`:
    - **concurrency:** two signed-in clients call `updateMe({displayName: X})` via `Promise.all`; exactly one succeeds and the other gets `DISPLAY_NAME_TAKEN`
    - **AC-01** across two accounts from `createTestAccounts(2)`: each `getMe` returns only its own profile
    - **Review focus 4:** a client whose session holds a garbage or expired access token gets `UNAUTHORIZED` from `getMe` (inject with `auth.setSession` or a crafted header)
    - the client never calls `.from(` (a static grep assertion over `shared/client/*.ts`)
    - If Supabase returns a different auth error code locally than mapped (e.g. for an existing email with confirmations off), fix the mapping and record the real code in a test comment.
- [ ] **Step 3:** Run `npm test` and `npm run test:integration`. Expected: FAIL.
- [ ] **Step 4:** Implement `errors.ts`, then `index.ts`.
- [ ] **Step 5:** `npm test && npm run test:integration && npm run typecheck`. Expected: all PASS, and the mock and real contract suites both green.
- [ ] **Step 6: Commit** `feat(shared): add real Supabase client with error mapping`.

---

### Task 9: CI, hosted checklist, and docs

**Files:**
- Create: `.github/workflows/ci.yml`, `doc/checklists/supabase-hosted-setup.md`
- Modify: `README.md` (add a "Local development" section), `doc/specs/2026-11-11-backend-foundation-auth-profiles-design.md` (status line, if changed by approval)

**Interfaces:**
- Consumes: all npm scripts from Task 1.

- [ ] **Step 1: Write `ci.yml`.** Trigger: `pull_request` to `dev`. Steps, on one `ubuntu-latest` job:
  1. checkout
  2. `actions/setup-node` with `node-version-file: .nvmrc` and npm cache
  3. `npm ci`
  4. `npx supabase start` (pinned CLI from the lockfile; no `--remote` anywhere)
  5. `npm run typecheck`
  6. `npm test`
  7. `npm run test:db`
  8. `npm run test:integration`
  9. the advisors command from Task 5, failing the job on any security warning not recorded as intended in Task 5
  10. `npx supabase stop` with `if: always()`
- [ ] **Step 2:** Push the branch and open a **draft** PR into `dev`. Expected: the workflow runs green. If it fails, fix it and push again. Don't mark the PR ready until it's green.
- [ ] **Step 3:** Write `doc/checklists/supabase-hosted-setup.md`. These are **manual steps for Adam**; agents don't perform them.
  - **Dev:**
    1. Create the project in Adam's org (free plan).
    2. Auth → providers: email on, confirm email off, every other provider off, anonymous off, minimum password 8.
    3. Enable asymmetric JWT signing keys.
    4. Confirm the Data API exposed schemas exclude `private`.
    5. After each merge into `dev`: `npx supabase link`, then `npx supabase db push --remote` (confirm when prompted).
    6. Run the advisors on the hosted project.
    7. Smoke check: sign up, sign in, `getMe`, `updateMe` avatar, try a taken name, sign out, sign in again.
    8. Record the date and that settings match `config.toml`.
    9. Give Ryan the URL and publishable key. **Never** the secret key.
  - **Production (at first launch, with explicit authorization):** same auth settings and signing keys. Migrations to production only through the separately authorized launch process.
- [ ] **Step 4:** In `README.md`, add "Local development": prerequisites (Docker, Node 22 via `.nvmrc`), `npm ci`, `npx supabase start`, the four test commands, and a link to the checklist. Replace the "Application code… will be added" sentence in Project status as appropriate.
- [ ] **Step 5:** Run every command in the README section on a clean checkout (`npx supabase stop --no-backup && npx supabase start`, then the tests). Expected: all PASS.
- [ ] **Step 6: Commit** `ci: run database, unit, and integration tests on pull requests` and `docs: add hosted Supabase checklist and local development guide`.

---

## Handoff to Adam (after Task 9)

These are human steps, listed so they aren't forgotten. They are not agent tasks.

- Perform the dev section of the hosted checklist, and the smoke check, before marking the PR ready.
- Request Ryan's review. Per the development rules, Ryan leaves the approval comment, and Adam merges into `dev`.
