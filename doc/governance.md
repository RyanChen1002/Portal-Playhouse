# Governance

## Risks

| Risk | Likelihood (high/medium/low) | Impact (high/medium/low) | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Data: User emails and other personal data are viewable to unauthorized people. Passwords are hashed by Supabase Auth and are not stored by us. | low | high | Access control for the database as provided by Supabase, including row-level security. The Supabase service-role key is never used in client code or committed to Git. | Adam (primary), Ryan. Adam is responsible for setting up permissions correctly. | In progress. |
| Code: unlicensed code. | high | low | We chose an MIT license. | Adam, Ryan. | In progress. |
| Security: A malicious user spams or overloads the account creation feature, preventing other users from creating accounts. | medium | medium | Identify multiple emails from the same user? Flag multiple user creation attempts from the same IP? Further discussion is needed to effectively combat this problem. | Adam, Ryan. | Not yet addressed. |
| Agents: agents spend actual money on unauthorized resources. | low | high | AGENTS.md limits agent scope and requires team agreement before incurring costs. We use free tiers on Vercel and Supabase, and keep production credentials out of agent sessions. | Adam, Ryan. | Implemented. |
| Failure: The free-tier Supabase project is paused after about a week of inactivity, making the database unavailable. | high | low | Supabase sends an alert email before the pause. The authors can manually restore the production database. | Adam (primary), Ryan. | Implemented. |
