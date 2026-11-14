# Hosted Supabase Setup Checklist

**Version:** 0.1

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/14/2026 | Created the manual checklist for the hosted dev project and the production launch. |

These are manual steps for Adam. Agents do not perform them and never run a command with `--remote`. The design is in [section 5.1 of the backend spec](../specs/2026-11-11-backend-foundation-auth-profiles-design.md). The settings below must match `supabase/config.toml`.

## Keys and secrets

| Value | Where it goes |
| --- | --- |
| Project URL (`https://<project-ref>.supabase.co`) | Safe to share. Give to Ryan. |
| Publishable key (`sb_publishable_<placeholder>`) | Safe to share. Give to Ryan. |
| Secret key (`sb_secret_<placeholder>`), service-role key, JWT secret, database password, access tokens | **Never commit. Never give to Ryan.** Keep only in Git-ignored env files or a password manager. |

Use placeholders only in Git, pull requests, chat, and agent logs. Do not paste real keys anywhere.

## Warning: local rate limits

The raised `[auth.rate_limit]` values in `supabase/config.toml` (for example `sign_in_sign_ups = 1000`) are **LOCAL ONLY**. They let the integration suite sign up many users from one IP. Do **not** copy them to a hosted project. Hosted projects keep their own stricter limits.

## Dev project (this milestone)

- [ ] 1. Create the project in Adam's organization on the free plan.
- [ ] 2. Authentication, providers:
  - Email on.
  - Confirm email **off**.
  - Every other provider off.
  - Anonymous sign-ins off.
  - Sign-ups open.
  - Minimum password length **8**.
- [ ] 3. Enable asymmetric JWT signing keys.
- [ ] 4. Confirm the Data API exposed schemas do **not** include `private`.
- [ ] 5. After each merge into `dev`, apply migrations:
  - `npx supabase link` (select the dev project).
  - `npx supabase db push --remote` (confirm when prompted).
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

- [ ] 1. Create the production project and apply the same auth settings as dev (steps 2 to 4 above), including asymmetric signing keys.
- [ ] 2. Apply migrations to production only through the separately authorized launch process. Do not push to production as part of dev work.
- [ ] 3. Run the hosted advisors and record the results as for dev.
- [ ] 4. Give Ryan only the production URL and publishable key, through the launch process.
