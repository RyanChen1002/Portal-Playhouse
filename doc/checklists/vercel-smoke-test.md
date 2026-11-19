# Vercel Smoke Test

**Version:** 0.1

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/18/2026 | Created the note for the post-deploy smoke test of the Vercel frontend: what it checks, how it runs, and the open question about the Vercel bypass token. The Cloudflare runtime is not covered. |

A smoke test asks one question of a deployed site: is it basically alive? It is separate from the pull request checks in [ci.yml](../../.github/workflows/ci.yml), which only test code on a CI machine. This one catches deployment problems, such as a failed Vercel build or a misconfigured project.

## Scope

- **Covered:** the Vercel frontend only.
- **Not covered:** the Cloudflare WebSocket runtime, Supabase, and any gameplay. The runtime has its own scripted smoke check in the [Cloudflare hosted setup checklist](cloudflare-hosted-setup.md).

## What it does

[scripts/smoke-frontend.mjs](../../scripts/smoke-frontend.mjs) fetches three URLs from the deployment and fails if any is not HTTP 200:

1. `/`, which must also contain `<title>Portal Playhouse</title>`.
2. `/app.js`
3. `/styles.css`

It is a plain Node script with no dependencies. It is not part of `npm test` and needs no local Supabase stack.

## How it runs

[smoke.yml](../../.github/workflows/smoke.yml) runs in two ways:

- **Automatically** on GitHub's `deployment_status` event, which Vercel's GitHub integration sends when a deployment finishes. It runs only for successful deployments, against the deployment's URL.
- **By hand** from the Actions tab (**Smoke test** > **Run workflow**) with a URL. This is the way to try it first.

To run it locally: `SMOKE_BASE_URL=https://<deployment>.vercel.app node scripts/smoke-frontend.mjs`

## Open questions

- **Bypass token (undecided).** Vercel may protect preview deployments with login (Deployment Protection), which makes the smoke test fail with HTTP 401. First check whether the project's previews are protected: open one in a private browser window. If they are, create a Protection Bypass for Automation secret in the Vercel project settings and save it as the GitHub repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`. The script and workflow already use it when it is set. Never commit the secret.
- **Automatic trigger needs a merge first.** GitHub runs `deployment_status` workflows from the default branch (`dev`), so the automatic run cannot be seen until this change is merged. Use the manual run to verify before then.
- **Not a required check.** It runs after the deploy, so it does not block merging.
