# World ID (IDKit) evidence — runbook

Status: **no World evidence recorded yet.** Unit tests (stubbed World verify) are not evidence for this folder.

## Labeling (mandatory)

Every artifact here states its environment in the file name and first line:

- `staging-*.md` — **World ID Simulator, staging environment. Development proof, not real human verification.**
- `production-*.md` — real World App on a phone, production environment.

Record per run: date/time (UTC), ShipLock commit SHA, `@worldcoin/idkit*` versions (4.6.0), `WORLD_ENVIRONMENT`, `WORLD_REQUIRE_USER_PRESENCE`, the World verify HTTP status and response body (it contains no personal data; drop anything that does), the ShipLock API response, the resulting authorization / job state, and the PR URL. Never record `WORLD_RP_SIGNING_KEY`, cookies, CSRF tokens, OAuth codes or GitHub tokens. Nullifiers and session ids may be truncated to their first 10 characters.

## Prerequisites

1. `.env.local` (names only; values are yours): `APP_URL`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_DEMO_REPO`, `GITHUB_FINE_GRAINED_TOKEN`, `SHIPLOCK_AGENT_TOKEN`, `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ENVIRONMENT=staging`, `WORLD_ENROLL_ACTION`, `WORLD_REQUIRE_USER_PRESENCE`, `HEDERA_AUDIT_PAYTO_ACCOUNT_ID`, `AUDIT_PRICE_TINYBAR`, `AGENT_MAX_PAYMENT_TINYBAR`, `SHIPLOCK_ACCEPTED_EVIDENCE`.
2. Enrollment action created in the Developer Portal **staging** environment.
3. Simulator: https://simulator.worldcoin.org/id/0x18310f83 (follow its on-screen instructions to scan or paste the IDKit connect link).
4. `pnpm dev:api` and `pnpm dev:web`; the API log line shows `World ID: staging (simulator, not real human verification)`.
5. An open PR in the disposable demo repo, bound with `POST /api/reviews` (agent token) or `pnpm analyze owner/repo#N`, whose local conclusion is `pass`.
6. A paid review for that job: the live one from Hermes's agent (preferred), or — for World-only runs before payment is wired — `SHIPLOCK_ACCEPTED_EVIDENCE=live,simulated` and `pnpm --filter @shiplock/api simulate-paid-review <jobId>`. A simulated paid review is labeled *Simulated* in the UI and **cannot be merged**; the merge steps below need the live one.

## Runs

1. **Positive enrollment.** `/maintainer` → Sign in with GitHub → Enroll with World ID → complete in the simulator. Expect the World verify 200 with `success: true` and `environment: "staging"`, the UI showing "World ID enrolled", and one row in `world_enrollments`.
2. **Positive approval.** Review page → *Review exact merge operation* → check the displayed repository id, PR, full head SHA, review digest, action and expiry → *Approve with World ID* → complete in the simulator. Expect authorization `approved`, job `approved`.
3. **`user_rejected` / cancel.** Open a new authorization, then reject in the simulator (or close the widget). Expect the authorization `denied` with reason `world_cancelled:user_rejected` (or `world_cancelled:closed`), job `denied`, no merge attempt. A fresh authorization can be opened afterwards.
4. **User-presence failure**, if the simulator can produce it: expect `world_cancelled:user_presence_failed`. If the simulator cannot perform the presence check at all, approvals will fail with `user_presence_missing`; record that, and only then decide whether a staging run with `WORLD_REQUIRE_USER_PRESENCE=false` is acceptable (production refuses that setting).
5. **Replay.** Re-POST the approved run's `idkitResult` to `/api/authorizations/:id/approve` (e.g. from browser devtools, same session). Expect 409 (`authorization_not_pending` for the same authorization, `world_proof_replayed` or `nonce_*` for another).
6. **Stale SHA** (live paid review required for the merge half). After approval, push a commit to the PR, then *Merge*. Expect merge attempt `blocked` / `head_sha_changed` (or GitHub 409 `github_rejected_changed_head`), job `stale`, PR still open.
7. **Successful merge** (production World proof preferred for the final demo). Approve, then *Merge*: expect merge attempt `merged`, the merge commit SHA and PR URL.

## Integration debrief (fill with measured values)

- Time to first successful staging verification:
- Friction encountered:
- Missing capability or documentation:
- The one improvement with the greatest impact:

## Open questions to settle on the first run

- Does the IDKit result `nonce` equal the `rp_context` nonce ShipLock signed? ShipLock requires it (fails closed with `unknown_nonce` otherwise).
- Is staging verification served by `https://developer.world.org` (default), or does it need `WORLD_VERIFY_BASE_URL=https://staging-developer.worldcoin.org`? A wrong host fails closed.
- Does the simulator support `require_user_presence`?
