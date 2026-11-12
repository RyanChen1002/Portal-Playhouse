# Research: Supabase Auth Sign-In Method

**Version:** 0.1

**Date:** 11/12/2026

**Author:** Adam, with AI-assisted research (Claude Code)

**Status:** Research complete. Adam decided the §7 questions on 2026-11-11 (below); Ryan reviews them in this branch's pull request. The auth provider was an open decision in the [initial spec](../initial-spec.md) (FR-01, §8) and the [component contract](../component-contract.md) (§2). Record the final outcome in the spec/contract change history.

**Decisions (2026-11-11, Adam; pending Ryan's review):**

1. Sign-in method: **Option A**, email + password.
2. Email confirmation: **off** in dev and production.
3. Password reset: **not needed** for the first release, so no custom SMTP provider for now. §6 is kept for reference.
4. GitHub/Google sign-in: **not wanted**, now or later.
5. Supabase projects: **Adam owns** both the dev and production projects. The 1-week inactivity pause is accepted; paused projects are resumed manually when needed.

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/12/2026 | Added the auth sign-in method research and the decisions recorded on 11/11/2026. |

## 1. Question

Supabase Auth is confirmed. Which sign-in method(s) should the first release use, and should email verification be required?

## 2. Constraints from the spec and contract

- Accounts and profiles persist across logout/login (FR-01, FR-02, AC-01).
- Users are friends and classmates. Class access is needed 1–2 weeks before the presentation (§8).
- Separate dev and production Supabase environments, with no cross-environment writes (FR-12, §5).
- Free resources by default; team agreement before costs (§5).
- Verification needs **many distinct accounts**: 2 users first, then 3+, then 16 and a rejected 17th (AC-02). Creating test accounts must be cheap and scriptable.
- The backend verifies the Supabase access token and derives identity from it, not from a client-sent player ID (contract §2). This applies whatever sign-in method we choose.

## 3. Platform facts that drive the choice

Checked against the sources in §9 on November 11, 2026. Figures marked *verify* came from secondary sources or disagreed between sources. Confirm them in the dashboard before relying on them.

1. **Supabase's default email sender barely works for real users.** Without custom SMTP, Supabase Auth only delivers email to members of the project's team, and Supabase calls the service best-effort, for testing only. The hourly cap is very low (most sources say 2 emails/hour per project; *verify* under Authentication → Rate Limits). Every email-dependent flow is affected: confirmation, magic links, OTP codes and password resets.
2. **Custom SMTP removes the team-only restriction.** The default cap becomes about 30 emails/hour, adjustable (*verify*). That requires a third-party email provider. Several have free tiers, but many require a verified sending domain, which we don't have (*verify* for any provider we consider).
3. **The free plan allows 2 active projects** and pauses projects after 1 week of inactivity. Dev + production uses both free slots. A paused production project goes offline until someone manually resumes it, so it must be active before class access and the presentation. How the 2-project cap is counted (per user or per organization) is still to *verify*.
4. **OAuth providers (GitHub, Google)** need a separate OAuth app registered with the provider, with callback URLs for each Supabase environment (local, dev, prod) plus redirect-URL allowlisting for localhost and Vercel preview URLs. A Google app in testing mode only admits listed test users. A published but unverified app shows a warning and the `*.supabase.co` domain on its consent screen.
5. **Local development** (Supabase CLI) captures all auth email in Mailpit (`http://127.0.0.1:54324`). Email confirmation is **off by default locally** and **on by default for hosted projects**. Local email flows can be tested without any SMTP provider.
6. **Anonymous sign-ins** exist but create temporary users. Keeping their data requires linking/converting to a permanent identity, and Supabase recommends CAPTCHA to limit abuse.
7. **Token verification** (applies to every option): with asymmetric JWT signing keys, `supabase.auth.getClaims()` or any standard JWT library can verify access tokens locally against the project's JWKS endpoint. With the legacy shared secret, Supabase recommends verifying with the Auth server. Local verification matters for the runtime decision: a dedicated game service could verify tokens without calling Supabase on every request. Whether new projects use asymmetric keys by default is to *verify* at project creation.

## 4. Options

| | A. Email + password, confirmation **off** | B. Email + password, confirmation **on** | C. Magic link / email OTP | D. OAuth (GitHub and/or Google) | E. Anonymous only |
| --- | --- | --- | --- | --- | --- |
| Works for classmates on free tier with no extra setup | Yes | No: needs custom SMTP | No: needs custom SMTP | Yes, after OAuth app setup | Yes |
| Setup effort | Lowest | Medium (SMTP provider, possibly a domain) | Medium (same) | Medium–high (OAuth app × environments, redirect URLs) | Low |
| Scriptable test accounts (AC-02 needs 16+) | Easy: admin API or plain sign-up in dev | Easy in dev using the admin API to pre-confirm | Awkward: every login needs an email | Hard: needs 16 real external accounts | Easy, but not persistent |
| Persistence across logout/login (AC-01) | Yes | Yes | Yes | Yes | **No**, unless converted |
| Password reset | Needs email. Same SMTP limit as B (team-only on default sender) | Works with custom SMTP | Not applicable | Handled by provider | Not applicable |
| Main risk | Unverified/typo'd emails; no self-service reset without SMTP | SMTP setup/cost/domain; delivery problems block sign-up | Email delivery blocks **every** login | Per-environment configuration; classmates need a GitHub/Google account | Fails FR-01/AC-01 |

## 5. Recommendation (proposal)

**Option A for the first release: email + password with email confirmation turned off in both dev and production. Keep B and D as later upgrades.**

Reasons:

- It's the only option that works for classmates on the free tier without an SMTP provider, a domain, or per-environment OAuth apps.
- It makes multi-account testing (2 → 3+ → 16 → rejected 17th) easy to script, especially with the admin API in dev.
- It behaves the same locally, in dev and in prod, so environment-separation checks (AC-08) stay simple.
- Upgrading later is cheap. Turning on confirmation (B) or adding GitHub/Google (D) is configuration plus UI, not a schema or contract change, because identity always comes from the verified Supabase user ID.

Risks to accept explicitly if we choose A:

- Users can register with emails they don't own. That's acceptable for a class project with synthetic/sample data and no sensitive content.
- **No self-service password reset** without custom SMTP. Mitigation: the team resets passwords manually through the Supabase dashboard (production changes still need explicit authorization per §5), or we add custom SMTP later if this becomes a real problem (options in §6).
- Sign-up is open to anyone with the URL. Supabase's built-in auth rate limits apply. CAPTCHA can be added later if abuse appears.

Independent of the sign-in method, also propose:

- Enable **asymmetric JWT signing keys** on both projects and verify tokens with `getClaims()`/JWKS on the backend.
- Allow-list exact production redirect URLs; use wildcards only for localhost and Vercel previews in dev.
- Keep the service-role key server-side only and out of Git (working agreement).

## 6. Custom SMTP options (free and low-cost)

Researched November 11, 2026 for the case where we want email confirmation (Option B), password reset, or magic links. Provider free tiers change often, and most figures below come from third-party pricing reviews, not the providers' own pages. **Verify every number on the provider's current pricing page before choosing.**

### 6.1 Expected volume

The first release needs very little email. A class-sized audience of a few dozen accounts means roughly one confirmation email each plus occasional password resets. That's dozens of emails, not thousands, so **every free tier below has enough monthly volume.** The binding limit is short bursts: if a whole class signs up during one session, Supabase's custom-SMTP cap of about 30 emails/hour (§3, item 2) may be hit. It can be raised under Authentication → Rate Limits.

Only production needs custom SMTP. The dev project is used by Ryan and Adam, who are team members and can receive email from the built-in sender. Test accounts created with the admin API in dev don't send email at all. Local development uses Mailpit.

### 6.2 The real constraint is a sending domain

Our users' inboxes (often Gmail) check that the From domain is authenticated by whoever actually sends the mail (DMARC alignment via SPF/DKIM). Sending from a `@gmail.com` (or school) address through a third-party provider fails that alignment, even when the provider's own setup is correct. The mail is then likely to land in spam, or the provider rewrites the sender address (Brevo substitutes its own domain when the sender isn't authenticated). **Reliable delivery means owning a domain** and adding the provider's DNS records, with one exception: sending through Gmail's own SMTP server (§6.3).

Domain options:

- **GitHub Student Developer Pack:** the official pack page lists a free 1-year `.me` domain through Namecheap, plus a separate Name.com student offer. Requires verified student status; renewal prices after year one are reported inconsistently (*verify*).
- **Paid domain:** typically around $10–20/year for common extensions (*verify* the exact price). This is a cost, so it **needs team agreement** (working agreement, Data and Costs).
- Side benefit: the same domain could serve the Vercel frontend, giving class users a cleaner URL than `*.vercel.app`.

### 6.3 Providers

| Provider | Free / low-cost terms (*verify all*) | Needs own domain? | Notes |
| --- | --- | --- | --- |
| **Resend** | Free: about 3,000 emails/month, max 100/day, 1 domain; no card | **Yes** | Publishes a Supabase setup guide; simple setup. Sending pauses at the daily cap on the free plan. |
| **Brevo** (formerly Sendinblue) | Free: 300 emails/day, no card; account may need approval before sending | Not strictly (single-sender email verification), but strongly recommended | Publishes a Supabase SMTP guide. Without our own domain, freemail From addresses fail DMARC alignment (§6.2). |
| **Mailjet** | Free: reported about 6,000/month, 200/day (sources conflict) | Recommended | Least-verified figures in this list. |
| **Mailgun** | Free tier reported as about 100/day (sources conflict, including a 100/month figure) | Yes | Short log retention on free tier. |
| **Postmark** | Free developer plan: 100 emails/month | Yes (or approval process) | Known for deliverability; 100/month is enough for confirmations only at small scale. |
| **Amazon SES** | Pay-as-you-go about $0.10 per 1,000 emails; new-account free-tier terms changed in 2025–2026 (sources conflict) | Verified identity (domain or address) | Starts in a **sandbox** that only delivers to verified recipients until AWS approves production access. Needs an AWS account with billing; the most setup. |
| **SendGrid** | Free plan **retired** (May 2025); paid plans only after a 60-day trial | — | Not a free option. |
| **Gmail SMTP** (dedicated project Google account + app password) | Free; daily limit reported around 500 (unverified for consumer accounts) | **No**: mail genuinely comes from Gmail, so alignment passes | Requires 2-Step Verification for an app password. Not intended for transactional/app email. Use a dedicated project account, never a personal one. Credentials go only into Supabase's SMTP settings, never into Git. Fragile, but zero cost and no domain. |

### 6.4 Assessment

- **If we stay on Option A** (confirmation off, no self-service reset), we need no SMTP provider. This is still the recommended starting point (§5).
- **If we want confirmation or password reset**, the most reliable free path is **a domain (free via the Student Pack, if eligible) + Resend or Brevo free tier, configured on production only**. Resend is the simpler setup; Brevo has the higher daily cap.
- **If we want email with zero cost and no domain**, the options are a dedicated Gmail account with an app password, or Brevo single-sender. Both are acceptable for a class project but carry deliverability risk. Test them with several real inbox providers before telling classmates to rely on email.
- Avoid SendGrid (no free tier) and Amazon SES (sandbox approval and billing setup are disproportionate at this scale).

## 7. Decisions needed from Ryan and Adam

1. Sign-in method for the first release (recommend A).
2. Email confirmation on or off in production (recommend off for now).
3. Whether password reset is needed for the first release. If so, choose an SMTP path from §6.4, and decide whether to obtain a domain (free Student Pack or a paid domain, which needs cost agreement).
4. Whether GitHub/Google sign-in is wanted later (affects the account/profile screens Ryan builds).
5. Who owns the dev and prod Supabase projects/organization, given the 2-free-project limit and the 1-week inactivity pause.

## 8. Items to verify before or during implementation

- Current built-in email rate limit and custom-SMTP default (dashboard → Authentication → Rate Limits).
- How the 2-active-free-project limit is counted, and whether both projects can live in one shared organization that both partners can access.
- Whether new projects use asymmetric JWT signing keys by default, or need migration.
- The local `config.toml` setting for email confirmation (expected to default to off), so local and hosted behavior match the chosen option.
- If custom SMTP is chosen: the provider's current free-tier limits on its own pricing page, Student Pack domain eligibility and renewal price, and test delivery to Gmail, Outlook and school inboxes.

## 9. Sources

Official Supabase documentation:

- [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Changes to the default email provider (changelog)](https://supabase.com/changelog/29370-supabase-auth-changes-to-default-email-provider)
- [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Pricing](https://supabase.com/pricing)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Sign in with GitHub](https://supabase.com/docs/guides/auth/social-sign-in/auth-github)
- [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Test auth flows (local Mailpit)](https://supabase.com/docs/guides/auth/testing-auth-flows)
- [CLI config reference](https://supabase.com/docs/guides/local-development/cli/config)
- [JSON Web Tokens](https://supabase.com/docs/guides/auth/jwts)
- [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)

Secondary sources (used only for figures marked *verify*):

- [Supabase email rate limit (Axonbuild)](https://axonbuild.com/blog/supabase-email-rate-limit/)
- [Supabase custom SMTP guide (SendLayer)](https://sendlayer.com/blog/supabase-custom-smtp-and-email-configuration-guide/)
- [GitHub discussion: custom SMTP in local config](https://github.com/orgs/supabase/discussions/27054)

SMTP providers and domains (§6):

- [Resend: configure Supabase to send from your domain](https://resend.com/blog/how-to-configure-supabase-to-send-emails-from-your-domain)
- [Resend review 2026: pricing and limits (WP Mail SMTP)](https://wpmailsmtp.com/resend-review/)
- [Brevo free SMTP server](https://www.brevo.com/free-smtp-server)
- [Brevo: Supabase SMTP integration](https://developers.brevo.com/docs/supabase-smtp-integration)
- [Brevo: Gmail and Yahoo sender requirements](https://www.brevo.com/blog/gmail-and-yahoo-sender-requirements/)
- [SendGrid alternatives: the free tier is gone (Dreamlit)](https://dreamlit.ai/blog/best-sendgrid-alternatives)
- [Best free SMTP servers compared, 2026 (SendLayer)](https://sendlayer.com/blog/best-free-smtp-servers/)
- [Amazon SES FAQs](https://aws.amazon.com/ses/faqs/)
- [Amazon SES pricing 2026 (secondary)](https://www.usecarly.com/blog/amazon-ses-pricing/)
- [Gmail SMTP and DMARC (GMass)](https://www.gmass.co/blog/gmail-smtp-dmarc/)
- [Dealing with Gmail's DMARC policy (SMTP2GO)](https://www.smtp2go.com/blog/dealing-with-gmails-dmarc-policy/)
- [Supabase custom SMTP comparison of six providers (codenote)](https://codenote.net/en/posts/supabase-auth-custom-smtp-comparison/)
- [GitHub Student Developer Pack](https://education.github.com/pack)
- [Name.com GitHub Student Developer Pack offer](https://name.com/partner/github-students)
