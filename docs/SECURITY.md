# Security invariants and adversarial tests

Product invariant: **merged code == reviewed code == explicitly authorized code.** Anything stale, expired, cancelled, replayed or mismatched fails closed.

- **Immutable reviewed bytes.** `owner/repo`, immutable repository ID, PR, head SHA, base ref and scanner/rules version specify the audited input. Never scan a mutable branch name and then claim to have reviewed a stored SHA.
- **Immutable quote.** The paid retry must use original issued x402 network/asset/amount/payee/expiry; client may not reprice. No floats for tinybars, no incorrect Hedera network or fee payer.
- **Real settlement.** Distinguish `/verify` from `/settle` and both from confirmed consensus. Protect replay/idempotency and avoid automatic double settlement on uncertain outcomes. A 200 from a stub is **not** payment proof. ShipLock accepts a paid review only after its own mirror-node lookup confirms the transfer (`SUCCESS`, `CRYPTOTRANSFER`, merchant credited the quoted amount, the configured agent account debited exactly that amount, consensus after the review job was created); an unknown transaction stays pending, never failed and never accepted. The transfer is not yet tied to a specific merchant quote (Hermes review M-4; merchant quote confirmation is a follow-up).
- **Paid review binding.** The merchant's report digest must equal ShipLock's own digest of the same base...head bytes. Simulated paid reviews (`evidenceKind: "simulated"`) are refused unless explicitly enabled for UI work, and are never merged.
- **Maintainer identity = GitHub.** OAuth state is single use, bound to the browser and short-lived; the GitHub access token is used once to read `/user` and then discarded. Sessions are random, server-stored by hash, HttpOnly, SameSite=Lax, expire and can be revoked. Every mutation requires the session's CSRF token and, when present, a matching `Origin`. Repository permission (≥ `SHIPLOCK_MIN_GITHUB_PERMISSION`) is checked live with GitHub when authorization opens and again immediately before merging.
- **World ID = proof of human only.** A World ID proof establishes that a unique human is present. It never by itself grants merge authority, identifies the maintainer, or implies consent.
  - RP signatures (`rp_context`) are created server-side only; the signing key is never `NEXT_PUBLIC_*`, never logged.
  - Every proof is verified by World (`POST /api/v4/verify/{rp_id}`); the response must be HTTP 200 with `success: true` and the expected `environment`. Unreachable, timeout, 4xx/5xx or mismatch = rejected. A client-reported `success: true` or widget `onSuccess` is ignored.
  - Each RP nonce is single use, short-lived and bound to the browser session, the GitHub user, the purpose (enroll/approve) and — for approvals — the authorization.
  - The proof's signal hash must equal the server-expected signal; user presence is required when configured (mandatory in production).
  - Enrollment binds one World ID (environment, rp_id, enrollment action, nullifier) and one World session to one GitHub account; neither can be re-enrolled elsewhere and an existing session is never silently replaced.
  - Approval proofs must come from the enrolled World session (`session_id`), and each `session_nullifier` is accepted once (canonicalized, so re-encoding does not bypass replay protection).
  - Staging/simulator proofs are development evidence, not real human verification, and are labeled as such everywhere. A merge backed by a staging proof or non-live paid evidence is refused unless `SHIPLOCK_ALLOW_DEVELOPMENT_MERGE=true` (demo repositories only); the merge event records `developmentEvidence`.
- **Authentication != permission.** Only an explicit World ID approval whose signal is the operation hash of the displayed repo, repository ID, PR, head SHA, base ref, review digest, scanner version, merge method, approver and World environment grants a single merge attempt. Denied/cancelled/expired/changed operation = fail closed.
- **GitHub permission.** Repo allowlist; least-privilege credential restricted to disposable target; recheck current PR, SHA, base, mergeability, check runs, commit statuses and required status checks from branch rules (a check pinned to a GitHub App must come from that app); use merge `sha` precondition; obey rulesets and required checks.
- **Single use / atomicity.** DB state transitions and unique constraints prevent double fulfillment, double approval and double merge. The approval is consumed before the GitHub call; a blocked pre-check requires a fresh approval. If the network result is uncertain, or the attempt was interrupted (still in progress after 5 minutes), reconcile by reading the PR before any further side effect; never retry the merge.
- **Secrets.** Hedera signing keys, GitHub tokens and OAuth secret, the World RP signing key, session tokens and CSRF tokens stay server-side or in HttpOnly cookies. No keys or identity tokens in logs, client JS, Git repo, HashScan memo, or HCS receipts.
- **Scanner limits.** For v1 report heuristic findings, no guarantee code is safe. For changed code after scan or auth, invalidate evidence and demand a new review.
- **Provider integrity.** Show scanner source and version; audit digest should be computed independently from retrieved bytes rather than trusting a provider-supplied header alone.

## Negative test matrix

Unit tests (stubbed World verify, mirror node and in-memory GitHub) cover each row marked ✓; they are not live evidence.

| Attack or failure | Required result | Unit |
|---|---|---|
| wrong x402 amount, asset, payee, chain | payment rejected, no paid audit | ✓ (acceptance + mirror node) |
| expired/modified 402 requirements | reject quote or require new one | Hermes |
| same receipt reused for another review | reject | ✓ |
| facilitator returns ambiguous settlement | reconcile, never assume failed and repay | Hermes; mirror unknown ⇒ pending ✓ |
| simulated paid review when live is required | rejected; never merged even if enabled | ✓ |
| client sends World `success:true` / forged result | ignored as authorization | ✓ |
| World verify 400 / 404 / timeout / `success:false` / wrong environment | rejected | ✓ |
| unknown, expired, reused or other-session RP nonce | rejected | ✓ |
| signal ≠ operation hash, wrong environment, missing user presence | rejected | ✓ |
| proof from a World session other than the enrolled one | rejected | ✓ |
| replayed session nullifier or enrollment nullifier (incl. concurrent) | rejected | ✓ |
| World cancel / user_rejected / maintainer deny | no approval, no merge | ✓ |
| no GitHub session, missing CSRF, foreign Origin | rejected | ✓ |
| approved SHA then force push | reject as stale; GitHub 409 ⇒ stale | ✓ |
| audit result says block / inconclusive | no authorization by default | ✓ block; inconclusive refused in code, no dedicated test |
| same approval used twice / concurrent execute | second use rejected; one merge call | ✓ |
| expired authorization or stale approval | no merge | ✓ |
| GitHub checks fail / required check missing / permissions revoked | no merge | ✓ |
| attempt to merge non-allowlisted repo | reject at API boundary and before merge | ✓ |
| merge outcome unknown (timeout/5xx) | `reconcile_required`, resolved by reading the PR | ✓ |
| other actor merges outside app | documented limitation; required check recommended | — |

After any failure, preserve an audit event with correlation ID but without personal identity, OAuth tokens, or private code contents.
