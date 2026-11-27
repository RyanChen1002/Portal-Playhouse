# Development Notes

## 1. Correcting the game plan

**Date: 11/18/2026**

The plan needed to stay focused on the five existing games instead of adding five more. There was also a misunderstanding about five trials: the intended idea was five levels, not a daily limit on attempts. The checklist was revised to keep the existing games, remove daily limits, and leave Portal Partners unchanged for the teammate's multiplayer testing.

## 2. A missing dependency blocked the check

**Date: 11/21/2026**

The local TypeScript check failed because the declared `wrangler` dependency was missing from the installed packages. Passing game tests did not mean all checks had passed. The issue stayed open until dependencies were restored on 11/22/2026, when the TypeScript check passed. The backend code did not need to be changed to work around the missing package.

## 3. Missing account registration

**Date: 11/22/2026**

The login page had a Sign in button but no Create account option, even though the shared client already supported signup. The missing form was added with display name, email, password, and error messages. The change went into PR #28. All 84 frontend/build tests and TypeScript checks passed, but the browser signup test used a mock client rather than creating a real account.

## 4. Signup failed to load locally

**Date: 11/22/2026**

Clicking Create account showed an error loading `portal-client.js`. The local server returned 503 because its sandbox permissions blocked the bundler. Restarting the preview server with the needed permissions fixed the file request, which then returned 200. No Supabase settings needed to change.
