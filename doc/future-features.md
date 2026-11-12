# Portal Playhouse — Future Features

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 11/12/2026 | Created the list, collecting features already deferred in the initial spec, backend design, and auth research. |

## Purpose

One place to track features and upgrades we have deliberately **left out of the first release**, so they are not lost and not accidentally built early. Nothing here is committed scope. Moving an item into scope needs agreement from Ryan and Adam and an update to the [initial spec](initial-spec.md) and, where interfaces change, the [component contract](component-contract.md).

Add new ideas as they come up. Keep each entry to its source and the reason it was deferred.

**Status labels:** **Deferred** means the team explicitly decided to leave it out of the first release. **Ruled out** means the team decided it is not wanted. **Idea** means it has been mentioned but not decided either way.

## Gameplay and world

| Feature | Status | Source and notes |
| --- | --- | --- |
| More mini-games | Deferred | [Initial spec](initial-spec.md) §4. The first game is still TBD. |
| Games with other player counts | Deferred | FR-06. The first game requires exactly two players; other sizes are "future extensions". |
| Competitive games | Idea | [Initial spec](initial-spec.md) §4 calls them "a future possibility". |
| In-room spectator mode | Deferred | FR-07. Board score and status are visible to others in the first version; entering a playing room is not. |
| Public matchmaking | Deferred | [Initial spec](initial-spec.md) §4. |
| World editor | Deferred | [Initial spec](initial-spec.md) §4. |
| Voice and video | Deferred | [Initial spec](initial-spec.md) §4. |
| Complex avatar customization | Deferred | [Initial spec](initial-spec.md) §4. The first release offers 20 fixed avatars. |
| Capacity above 16 players | Idea | FR-03: "Revisit capacity after performance testing." |

## Accounts and security

| Feature | Status | Source and notes |
| --- | --- | --- |
| Email confirmation | Deferred | [Auth research](research/auth-provider.md) option B. Upgrading is configuration plus UI, not a schema or contract change. |
| Self-service password reset (custom SMTP) | Deferred | [Auth research](research/auth-provider.md) §5–§6. Until then, the team resets passwords manually through the Supabase dashboard. Production changes still need explicit authorization. |
| CAPTCHA on sign-up | Idea | [Auth research](research/auth-provider.md): "can be added later if abuse appears". Relates to risk R3 in [governance](governance.md). |
| Account-creation abuse detection (repeat attempts, same-IP patterns) | Idea | Risk R3 in [governance](governance.md). The response is undecided. |
| Account deletion | Deferred | [Backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) §2 non-goals. |
| Display-name moderation | Deferred | [Backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) §2 non-goals. |
| Reusable token verifier for a dedicated game service | Deferred | [Backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) §4. Becomes relevant if runtime research selects a separate game service. |
| GitHub or Google sign-in | Ruled out | [Auth research](research/auth-provider.md) §7: not wanted, now or later. Listed so the decision is not re-litigated. |
| Magic links | Ruled out | [Backend design](specs/2026-11-11-backend-foundation-auth-profiles-design.md) §2 non-goals: decided out (see [auth research](research/auth-provider.md) §7). |
