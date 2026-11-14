# Hosted Supabase Setup Checklist

**Version:** 0.1

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/14/2026 | Created the manual checklist for the hosted dev project and the production launch. Added project-creation choices (Data API on with the `public` schema, automatic RLS off) and dashboard locations for the auth, signing-key, and Data API steps. Expanded the migration step (when and from which branch, where to run the commands, one-time link, dry run, and verification) and added guidance for the local env file for the hosted dev project. |

These are manual steps for Adam. Agents do not perform them and never run a command with `--remote`. The design is in [section 5.1 of the backend spec](../specs/2026-11-11-backend-foundation-auth-profiles-design.md). The settings below must match `supabase/config.toml`.

## Keys and secrets

| Value | Where it goes |
| --- | --- |
| Project URL (`https://<project-ref>.supabase.co`) | Safe to share. Give to Ryan. |
| Publishable key (`sb_publishable_<placeholder>`) | Safe to share. Give to Ryan. |
| Secret key (`sb_secret_<placeholder>`), service-role key, JWT secret, database password, access tokens | **Never commit. Never give to Ryan.** Keep only in Git-ignored env files or a password manager. |

Use placeholders only in Git, pull requests, chat, and agent logs. Do not paste real keys anywhere.

### Local env file for the hosted dev project

The backend's tests and scripts don't read an env file. They get local values from `npx supabase status` and refuse non-local URLs. The CLI uses your login token and prompts for the database password. The env file holds the hosted dev values for the frontend, which can build against the hosted dev project once its migrations are applied (step 5), and for manual checks.

Setup:

- Name it **`.env.development.local`** at the repository root. `.gitignore` already ignores it (`.env.*`). It's also the name Vite and Next.js both load in development, so Ryan's frontend can use the same file later.
- Put in only the values listed in `.env.example`: `SUPABASE_URL=https://<project-ref>.supabase.co` and `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`. The frontend framework may later require a prefix (for example `VITE_` or `NEXT_PUBLIC_`). Add it then, and update `.env.example` to match.
- Do **not** put the secret key, service-role key, database password or access token in it. Nothing needs them for the hosted project, and keeping them out means no file on disk can leak them.
- Before your first commit after creating it, check that `git status` doesn't list it.

## Warning: local rate limits

The raised `[auth.rate_limit]` values in `supabase/config.toml` (for example `sign_in_sign_ups = 1000`) are **LOCAL ONLY**. They let the integration suite sign up many users from one IP. Do **not** copy them to a hosted project. Hosted projects keep their own stricter limits.

## Finding settings in the dashboard

Supabase moves and renames dashboard menus from time to time. The locations below describe the usual layout. If a label isn't where described, open the dashboard's command menu (**Cmd+K** on macOS, **Ctrl+K** elsewhere) and search for the setting's name. What matters is the **final value** each step lists, not the exact path.

## Dev project (this milestone)

- [ ] 1. Create the project: **Dashboard home → New project**.
  - Organization: Adam's organization, **Free** plan.
  - Project name: anything clearly marked as dev (for example `portal-playhouse-dev`).
  - Database password: generate a strong one and store it in a password manager. Never commit it.
  - Region: the one closest to the team.
  - In the security or advanced options on the same form:
    - **Enable Data API: on.** The shared client reaches the backend only through `supabase.rpc(...)`, which goes through the Data API. With it off, every profile call fails.
    - **Data API schema: use the `public` schema.** Do not choose a dedicated API schema. The three functions (`get_me`, `update_me`, `check_display_name`) live in `public`, and `supabase/config.toml` exposes `public`.
    - **Automatic RLS: off.** It installs an event trigger that turns on RLS for new tables. We don't need it: our tables live in the unexposed `private` schema, the migrations enable RLS on them explicitly, and the database tests check RLS and privileges. Leaving it off also keeps the hosted project identical to the local stack, which has no such trigger.
- [ ] 2. Authentication settings: **Authentication → Sign In / Providers** (older dashboards: **Authentication → Providers**, plus **Authentication → Settings**).
  - In the user sign-up section at the top of the page:
    - **Allow new users to sign up: on.**
    - **Allow anonymous sign-ins: off.**
    - **Confirm email: off.**
  - In the provider list, open **Email**:
    - **Enable Email provider: on.**
    - **Minimum password length: 8.** If it isn't in the Email panel, look under **Authentication → Attack Protection** or search for "password".
    - Leave any extra password-character requirements at their defaults (none). The shared client only enforces the minimum length of 8 and the 72-byte maximum.
  - In the same provider list, check that **every other provider** (Phone, Google, GitHub, Apple, and so on) shows as disabled.
- [ ] 3. Asymmetric JWT signing keys: **Project Settings → JWT Keys** (the **JWT Signing Keys** tab).
  - If the current key's type is already **ECC (P-256)** or **RSA**, this step is done. Newer projects may start this way.
  - If the current key is the **legacy HS256 shared secret**, start the migration on that page (the button is labelled along the lines of **Migrate JWT secret** / **Start using JWT signing keys**). This creates a new asymmetric **standby** key. Then **rotate** so the asymmetric key becomes current. The legacy secret moves to "previously used" and existing sessions keep working until they expire.
  - Do not revoke the legacy key on the same day. Revoking it signs out every session it issued, which only matters once there are real users.
  - While you're in Project Settings, open **API Keys** to find the **publishable** key for step 9. The **secret** key on that page is never shared (see "Keys and secrets").
- [ ] 4. Data API schemas: **Project Settings → Data API** (some dashboard versions: **Integrations → Data API → Settings**).
  - The Data API is **enabled**.
  - **Exposed schemas** contains `public` (and `graphql_public` if present, the default) and does **not** contain `private`. This matches `[api] schemas` in `supabase/config.toml`.
  - Leave **Extra search path** at its default (`public, extensions`).
  - Leave **Max rows** at its default.
  - Check this again after step 5's first migration push: `private` must still not be listed.
- [ ] 5. Apply migrations to the hosted dev project.
  - **When, and from which branch:**
    - **Milestone smoke check (before merge).** The spec requires the hosted smoke check before a milestone's pull request is merged, so the migrations have to reach the hosted dev project first.
      - Push from the **pull request's branch**, and only after its CI run is green.
      - Do this for the **dev** project only.
      - If review later changes a migration, the hosted dev project can be rebuilt; it's a throwaway dev database. Re-push the final migrations after the merge.
    - **Otherwise (after merge).** After each merge into `dev`, push from an up-to-date `dev` branch: `git switch dev && git pull`.
      - This keeps the hosted dev project in step with what was reviewed and merged.
  - **Where to run:**
    - In a terminal on your own machine, at the **repository root**: the folder that contains `package.json` and `supabase/`.
    - On the branch chosen above.
    - Use Node 22 (`nvm use`) and the project's pinned CLI through `npx supabase`. Don't use a globally installed `supabase`.
    - Docker doesn't need to be running for these commands.
  - **One-time setup** (per machine):
    1. `npx supabase login`. This opens the browser and stores a personal access token in your OS keychain. Never paste that token into a file in the repo.
    2. `npx supabase link --project-ref <project-ref>`. The project ref is the `<project-ref>` part of the project URL (`https://<project-ref>.supabase.co`), also shown under **Project Settings → General**. When prompted, enter the database password from step 1. Linking writes local metadata to `supabase/.temp/`, which is Git-ignored.
  - **Every time:**
    1. `npx supabase migration list --remote`. This compares the local migration files with the hosted project's migration history. You should see only the newly merged migrations missing from the remote column.
    2. `npx supabase db push --remote --dry-run`. This prints what would be applied without changing anything. Check that it lists exactly the new migrations.
    3. `npx supabase db push --remote`. Type the confirmation when prompted. Don't add `--yes`, and never put `SUPABASE_YES` in an env file. The prompt is the safety check that you're targeting the right project.
    4. `npx supabase migration list --remote` again. Local and remote should now match.
  - All commands without `--remote` target the **local** stack. Only these manual steps use `--remote`, and only for the dev project. Never run them against production outside the authorized launch process.
- [ ] 6. Run the hosted advisors: `npx supabase db advisors --remote` (also check the Advisors page in the dashboard). Then handle the findings:
  - The hosted linter may flag the three intended SECURITY DEFINER functions. The lint names are believed to be `anon_security_definer_function_executable` and `authenticated_security_definer_function_executable`, but this is unconfirmed.
  - Record the **actual** lint names from the hosted output here: `<lint names, to be filled in by Adam>`.
  - Accept them **only** for `public.get_me`, `public.update_me` and `public.check_display_name`. Any other finding, or the same lint on any other function, is a problem to fix before merging.
  - The local `rls_enabled_no_policy` INFO findings for `private.avatars` and `private.profiles` are intended: those tables are private by design.
- [ ] 7. Smoke check:
  - Sign up.
  - Sign in.
  - `getMe`.
  - `updateMe` with a new avatar.
  - Try a display name that is already taken (expect `DISPLAY_NAME_TAKEN`).
  - Sign out.
  - Sign in again.
- [ ] 8. Record the date and that the hosted auth settings match `config.toml`: `<MM/DD/YYYY, initials>`.
- [ ] 9. Give Ryan the project URL and the publishable key. **Never** the secret key.

## Production project (at first launch)

Only with explicit authorization from both partners.

- [ ] 1. Create the production project with the same creation choices as dev (step 1 above: Data API on with the `public` schema, automatic RLS off). Apply the same auth, signing-key, and Data API settings (steps 2 to 4 above).
- [ ] 2. Apply migrations to production only through the separately authorized launch process. Do not push to production as part of dev work.
- [ ] 3. Run the hosted advisors and record the results as for dev.
- [ ] 4. Give Ryan only the production URL and publishable key, through the launch process.
