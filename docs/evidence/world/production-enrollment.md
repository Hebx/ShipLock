# production — World ID 4.0 maintainer enrollment

**Environment: production (real World App on a phone). Real human verification, credential most likely Selfie Check (lower assurance than Orb).**

| Field | Value |
|---|---|
| Time (UTC) | 2026-11-07T02:57:15Z |
| ShipLock commit | `aa5b8c1` (`cursor/integration`) |
| IDKit | `@worldcoin/idkit` / `@worldcoin/idkit-core` 4.6.0 |
| `WORLD_ENVIRONMENT` | `production` |
| `WORLD_REQUIRE_USER_PRESENCE` | `true` |
| RP / action | `rp_b1102dd124d31265` / `shiplock-maintainer-enroll` |
| GitHub account | `Hebx` (OAuth sign-in) |
| Enrollment | `wen_26bdb4331d234bc29eb9094c6e1f8214`; proof request status `verified`; audit event `world.enrolled` `{"environment":"production"}` |

ShipLock accepts an enrollment only after World's `POST /api/v4/verify/{rp_id}` returns HTTP 200, `success: true` and `environment: "production"`, after local checks of the signal, nonce, presence and credential. The verify response body was not persisted, so it is not reproduced here.

## How the credential was established

1. With the request limited to `proof_of_human` (Orb), the World App answered `credential_unavailable` (staging simulator and production alike).
2. A debug request (server-side, not sent to verify) allowing `any(proof_of_human, passport, mnc, selfie)` reached `awaiting_confirmation`.
3. ShipLock was widened to `proof_of_human | passport | mnc` (`3210ad3`): still `credential_unavailable`.
4. Adding `selfie` (`aa5b8c1`): the enrollment completed and verified.

So the credential is inferred as Selfie Check; ShipLock does not yet store the credential identifier with the enrollment.

## Not yet recorded

Cancelled approval, successful approval and the SHA-guarded merge (see `README.md` runs 2, 3 and 6).
