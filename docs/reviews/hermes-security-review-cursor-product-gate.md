# Hermes security review: World IDKit approval, GitHub maintainer auth, SHA-guarded merge

- Scope: branch `hermes/x402-contract-v2`, Cursor's product gate from commit `1a62c12`. Files: `apps/api/src/{world,enrollment,authorizations,auth,access,merges,paid-review,app,config,store,mirror-node,review-service}.ts`, `apps/api/src/db/migrations/*.sql`, `packages/policy/src/{operation,paid-review}.ts`, `packages/github/src/index.ts`, `apps/web/components/human-checkpoint.tsx`, `apps/web/lib/*`, `apps/web/next.config.ts`.
- Checked against: `docs/SECURITY.md`, `AGENTS.md`, `docs/MILESTONES.md`, the installed `@worldcoin/idkit-core@4.6.0` / `@worldcoin/idkit-server@1.2.0` type definitions, and the World docs (`/world-id/idkit/integrate`, `/world-id/idkit/session-proofs`, `/api-reference/developer-portal/verify`), all fetched 2026-11-07.
- Method: I read the code and ran throwaway vitest probes (`zz-hermes-review.test.ts`, 8 tests, all passing, so every listed behavior reproduced). They ran against a scratch copy of the repo under `~/.hermes/profiles/dev/cache/scratch/shiplock-review`, using Cursor's in-memory harness (`apps/api/test/harness.ts`). The only change to the repository is this file.
- Limits: the probes stub GitHub, World verify and the mirror node. None of this is live evidence.
- Re-checked by Hermes on `cursor/integration` @ `be878a2`: `merges.ts`, `access.ts`, `packages/github/src/index.ts`, `app.ts` and `config.ts` are unchanged since `1a62c12`, so every line reference holds. M-1 was re-run in Node (`ROLE_RANK["constructor"]` → `[Function: Object]`; `function < 4` → `false`, so a `read` user passes a `maintain` gate). M-2 was confirmed in code: `merges.ts:211` reconciles only `uncertain`, and `store.ts:155` skips `merge_in_progress` in sync. `mirror-node.ts` gained an exact payer-debit check (`!== -amount`); that hardens one transfer shape but does not bind the tx to the quote or job, so M-4 stands.

## Summary

There are no critical or high findings. The core chain holds and is enforced server-side:

GitHub session → live permission → World session proof whose signal is the operation hash → single-use nonce and nullifier → atomic consume → SHA-preconditioned merge.

There are four medium findings:

- one fail-open in the permission ranking;
- one unrecoverable state after a crash or DB error following a successful merge;
- staging/test evidence can drive a real merge;
- the Hedera payment is not bound to the audit it pays for.

| ID | Sev | Inv | Title | Confirmed by |
|---|---|---|---|---|
| M-1 | medium | B/C | `permissionRank` fails open for custom role names that are `Object.prototype` keys | test P1, P1b |
| M-2 | medium | C | A crash or DB error after GitHub merges leaves the attempt `in_progress` forever, with no reconcile path | test P2 |
| M-3 | medium | B | Staging (simulator) World proofs and `test` paid evidence can authorize a real merge | test P3 + code |
| M-4 | medium | A | Ledger check accepts any transfer of the quoted amount to the merchant: no payer, job, quote or time binding | test P4 |
| L-1 | low | B | Approve does not re-check live GitHub permission | test P6 |
| L-2 | low | C | Base SHA is not re-validated before merge (only `baseRef`) | test P5 |
| L-3 | low | B | An approved but unexecuted authorization cannot be revoked (deny/cancel only work on `pending`) | test P7 |
| L-4 | low | D | No rate limiting; unbounded RP-signature issuance and World verify calls | code |
| L-5 | low | D | OAuth without PKCE; cookies lack the `__Host-` prefix; `Secure` depends on the `APP_URL` scheme | code |
| L-6 | low | B/C | Required checks are matched by name only; classic branch-protection required checks are not read | code |
| L-7 | low | B | `user_presence_completed` is a JSON flag in the client-submitted result; whether World verify attests it is unknown | code + docs |
| I-1 | info | B | Execute is not bound to the browser session that approved | code |
| I-2 | info | D | `GET /api/reviews/:jobId` is unauthenticated and exposes operation, approver and events | code |
| I-3 | info | B | World verify's `session_id`/`nullifier` are optional and only cross-checked when present | code |
| I-4 | info | C | Inherent TOCTOU window between the last permission/head read and `PUT /merge` | code |
| I-5 | info | A/B | Operation hash does not include the payment receipt id or the World `app_id` | code |

## Findings

### M-1 `permissionRank` fails open for prototype-key role names

- Invariant: B/C (merge/maintain permission at approval and at merge).
- Location: `packages/github/src/index.ts:145-150`, used at `apps/api/src/access.ts:50`.
- Description: `ROLE_RANK` is a plain object literal, so `ROLE_RANK[p.roleName]` returns `Object.prototype` members for role names such as `constructor`, `toString`, `valueOf` or `__proto__`. A function or object is not nullish, so `??` does not fall back to the legacy `permission` field. `function < 3` evaluates to `false` (NaN comparison), so `assertRepoPermission` does not throw.
- Exploit: GitHub custom repository roles have free-text names. If an org owner creates a role named `constructor` that inherits from `read` and assigns it to a user, that read-only user passes both the authorization-create and pre-merge permission checks. P1b shows such a user reaching `merged`. The actual merge uses ShipLock's server token, so GitHub does not stop it. Exploiting this needs an unusual role name, but it is a fail-open in the main authorization gate.
- Fix: use `Object.hasOwn(ROLE_RANK, name)` or a `Map`. Rank unknown custom roles by the legacy `permission` field only, and treat anything that is not a finite number as 0.

### M-2 Crash or DB error after a successful GitHub merge is unrecoverable

- Invariant: C (crash between merge and DB update, outcome-unknown reconciliation).
- Location: `apps/api/src/merges.ts:155-166` (consume and insert `in_progress`), `:185-201` (only `MergeOutcomeUnknownError` is turned into `uncertain`), `:205-211` (reconcile requires `status === 'uncertain'`). Also `apps/api/src/store.ts:155` and `review-service.ts:55` (sync skips `merge_in_progress`).
- Description: the attempt is committed as `in_progress` before the network call. It only reaches a terminal or `uncertain` state if the handler gets as far as `finish()`. Several things skip that step:
  - process death (deploy, OOM, SIGKILL) while `PUT /merge` is in flight;
  - a SQLite `database is locked` error after the 5 s busy timeout inside `finish()`;
  - any unexpected exception thrown after GitHub returned 200.
  
  In each case the row stays `in_progress` and the job stays `merge_in_progress`. Nothing ever moves it again: reconcile refuses anything that isn't `uncertain`, and sync deliberately skips the state.
- Failing scenario (P2): GitHub merges, then the handler throws. The API returns 500, the attempt stays `in_progress`, `/reconcile` returns `nothing_to_reconcile`, and the UI shows no merge result even though the PR is merged. This fails closed (no double merge), but `SECURITY.md:20` promises reconciliation for an uncertain outcome and this case is not covered.
- Fix: let `/reconcile` (and a startup sweep) also accept `in_progress` attempts older than the merge timeout plus a margin, and resolve them through the existing read-only `reconcile()`. Wrap the post-merge `finish()` so that any throw after `mergePullRequest` resolved records `uncertain` in a separate transaction.

### M-3 Staging World proofs and `test` evidence can authorize real merges

- Invariant: B (staging vs production labeling; whether staging proofs can authorize real merges).
- Location:
  - `apps/api/src/config.ts:35`, `:98-101`: the only staging restriction is that user presence cannot be disabled in production.
  - `apps/api/src/merges.ts:174-175`: only `simulated` paid evidence is refused.
  - `apps/api/src/authorizations.ts:195`: the environment is recorded in the operation but never enforced.
- Description: with `WORLD_ENVIRONMENT=staging`, a simulator proof goes through the full approve path and `PUT /merge` is called on the real allowlisted repository (P3). That proof is not real human verification, as `SECURITY.md:17` and `AGENTS.md:11` both state. `SHIPLOCK_ACCEPTED_EVIDENCE=test` likewise allows non-live paid evidence through to a merge. The UI labels staging correctly (`apps/web/lib/client.ts:28-31`, `human-checkpoint.tsx:102,108`), but the backend does not separate the two cases.
- Exploit: anyone who completes a simulator flow for an enrolled staging session can produce an "approval" without a real human. Today this is mitigated only by the repo allowlist pointing at a disposable demo repo.
- Fix: add an explicit `SHIPLOCK_ALLOW_STAGING_MERGE=true` (default false). Refuse execute at `merges.ts:175` when `op.worldEnvironment !== 'production'` or `op.paidReviewEvidenceKind !== 'live'` unless that flag is set. Record the flag in the merge event, and label resulting merges as development evidence.

### M-4 Hedera settlement verification is not bound to the audit

- Invariant: A (settlement independently verified on the mirror node, bound to the paid audit).
- Location: `apps/api/src/mirror-node.ts:52-60`, `apps/api/src/paid-review.ts:76-84`, `packages/policy/src/paid-review.ts:61-69`.
- Description: the mirror check confirms that *some* successful CRYPTOTRANSFER with the given tx id moved exactly `quotedTinybar` into the merchant account, and that the claimed payer was debited. Nothing ties that transaction to this job, this quote, or this x402 payment:
  - no memo or x402 payment-id check;
  - no consensus-time window after job or quote creation;
  - no expected-payer configuration;
  - `vendorId` is free text.
  
  The only replay protection is `payment_receipts.hedera_transaction_id UNIQUE` (`001_init.sql:68`). The report must equal ShipLock's own deterministic report (`policy/src/paid-review.ts:57-58`), and that report is published verbatim by the unauthenticated `GET /api/reviews/:jobId` (`app.ts:84`).
- Exploit (P4): a holder of the agent token takes the public `localReport` and `localReportSha256` and pairs them with any third-party transfer of the quoted amount to the merchant that ShipLock has not seen (any payer, any time). The job reaches `paid_review_confirmed` without the x402 audit ever being bought. Requires the agent bearer token, so the threat is a misbehaving agent rather than an outside attacker. Bindings to repo id, PR, head SHA, base SHA, diff digest and report digest are all correct (see "Correctly implemented"). What is unbound is the settlement.
- Fix:
  - Bind the paid result to the x402 payment requirements ShipLock issued: store the quote and its nonce/payment id per job, and require the facilitator settle response or a memo to carry it.
  - Require the tx `consensus_timestamp` to fall after quote creation.
  - Optionally pin `payerAccountId` to the configured agent account.

### L-1 Approve does not re-check live GitHub permission

- Invariant: B ("merge/maintain permission at approval AND at merge time").
- Location: `apps/api/src/authorizations.ts:243-306`. Compare `:176` (create) and `merges.ts:79` (execute).
- Description: permission is checked when the authorization is created and again before the merge, but not when the World proof is accepted. P6: a user downgraded to `read` between create and approve still gets `approved`. Execute then blocks with `insufficient_repository_permission`, so there is no merge impact today, but the stated invariant is not met at the approval step.
- Fix: call `assertRepoPermission` in `/approve` before `verifyWithWorld`.

### L-2 Base SHA not re-validated before merge

- Invariant: C (reviewed == approved == live, base SHA binding).
- Location: `apps/api/src/merges.ts:86-90`. Only `baseRef` is compared; `pr.baseSha` is ignored. The operation (`authorizations.ts:180-199`) has no `baseSha` field. It is covered only transitively, through `reportSha256` → `report.baseSha` (`shared/src/schemas.ts:50`).
- Description: if the base branch advances after review, the merge proceeds (P5). The squash result then contains base changes that were never in the reviewed `base...head` diff context. This is low impact because the PR's own commits are unchanged and GitHub checks mergeability.
- Fix: either refuse execute when `pr.baseSha !== job.base_sha`, or explicitly document that only the head is pinned and that GitHub "require branches up to date" is relied on.

### L-3 No way to revoke an approved authorization before execution

- Invariant: B (denial/cancel handling).
- Location: `apps/api/src/authorizations.ts:319`.
- Description: deny and cancel require `status === 'pending'`. Once approved, the only exits are execute, expiry (10 min, `authorizations.ts:17`, `merges.ts:15`), or a head-SHA change (P7). A maintainer who changes their mind, or suspects their session is compromised, cannot withdraw consent.
- Fix: allow `deny` from `approved` (state machine `approved → denied`) inside the same transaction guard used by execute.

### L-4 No rate limiting

- Invariant: D.
- Location: `apps/api/src/app.ts:44-111` (no limiter). `authorizations.ts:227-237` inserts a `world_proof_requests` row and signs an RP context on every call. `enrollment.ts:54-79` does the same, and `/approve` and `/enrollment/complete` call World verify per request.
- Impact: an authenticated maintainer, or a stolen session, can grow the DB without bound and exhaust ShipLock's World verify quota. The agent endpoints can drive unlimited GitHub API calls and lock the GitHub token's rate limit.
- Fix: per-session and per-IP token-bucket limits on `/api/world/*`, `/api/authorizations/*` and `/api/reviews*`; cap open `issued` proof requests per authorization.

### L-5 OAuth and cookie hardening

- Invariant: D.
- Location: `apps/api/src/auth.ts:36-38` and `:97-99`.
- Description:
  - The GitHub OAuth web flow has no PKCE `code_challenge`; GitHub OAuth Apps support S256. State is browser-bound and single-use (`auth.ts:113-118`), so login CSRF is already handled; PKCE adds code-interception defense.
  - Cookies are named `shiplock_session` with no `__Host-` prefix.
  - `secure` is derived from `APP_URL` starting with `https://`, so a misconfigured `http://` production URL silently drops `Secure`.
- Fix: add PKCE S256; use `__Host-shiplock_session` with `Path=/`; refuse to start with a non-https `APP_URL` unless the host is localhost.

### L-6 Required checks matched by name only

- Invariant: C (required checks considered).
- Location: `apps/api/src/merges.ts:101-110`, `packages/github/src/index.ts:311-314`.
- Description:
  - Required contexts from rulesets are satisfied by *any* passing check run or status with that name; the `integration_id` in the rule is ignored. A same-repo PR workflow with `checks: write` can post a passing `ci` run.
  - Only `GET /rules/branches` is read. Classic branch-protection required checks are not.
  - GitHub's own enforcement at `PUT /merge` still applies, so ShipLock is no weaker than GitHub, but this defense-in-depth layer does less than `SECURITY.md:19` implies.
- Fix: compare `integration_id` against `CheckRunSummary.appSlug`/app id, and also read `GET /branches/{b}/protection/required_status_checks` (treat 404 as none).

### L-7 User-presence flag provenance unknown

- Invariant: B.
- Location: `apps/api/src/world.ts:113`.
- Description: `user_presence_completed` is a top-level boolean in the client-submitted IDKit result. The World verify docs describe it as a field IDKit includes, but do not say verify attests it. A tampered client could set it to `true`. I could not confirm whether `/api/v4/verify` checks it cryptographically.
- Fix: confirm with World (or a live negative probe) and record the answer in `docs/RESEARCH_NOTES.md`. Until then, do not treat presence as server-verified in `SECURITY.md:14`.

### Info

- I-1 (`merges.ts:146` vs `authorizations.ts:249`): approve requires the same browser session that created the authorization. Execute only requires the same GitHub user, so another session of that user can execute. Acceptable, since consent was already given, but undocumented.
- I-2 (`app.ts:56-94`): PR list and review detail are unauthenticated. They expose approver login, operation JSON (including nonce and expiry), audit events, and the full local report that M-4 relies on. Fine for a public demo repo; gate them behind a session for private repos.
- I-3 (`authorizations.ts:276`, `enrollment.ts:104`): the World verify response's `session_id` is only compared when present, and its `nullifier` is never compared. The local checks already use the payload World verified, so this is defense in depth only.
- I-4 (`merges.ts:79-110` → `:186`): a permission revocation or check failure in the seconds between the pre-checks and `PUT /merge` is not observed. The `sha` precondition closes the head-change race; the others are inherent.
- I-5 (`packages/policy/src/operation.ts:16-35`): the operation hash commits to `reportSha256`, which transitively commits to `baseSha` and `diffSha256`, plus `paidReviewEvidenceKind`. It does not commit to the receipt's `hedera_transaction_id` or the World `app_id`. Add both if the approval should attest to a specific payment.

## Correctly implemented

### A. Paid review binding

- Job id, repository id, PR, head SHA, scanner version, report repo/PR/head/base and the canonical report digest are all checked (`packages/policy/src/paid-review.ts:43-56`).
- The digest must equal ShipLock's independent report from the exact `base...head` bytes (`:57-58`; `review-service.ts:95-96`). The report schema contains `baseSha` and `diffSha256` (`shared/src/schemas.ts:44-55`).
- Amount equals the quote, is under the cap, payer ≠ merchant, and the network/asset/merchant match config (`policy/src/paid-review.ts:61-69`).
- Live head re-read before the receipt is recorded (`paid-review.ts:68-74`).
- The mirror node is checked independently: SUCCESS, CRYPTOTRANSFER, non-scheduled, nonce 0, exact merchant credit, payer debit (`mirror-node.ts:47-60`). An unknown result is treated as pending, never as success (`paid-review.ts:111-114`), and a mismatch deletes the unverified receipt (`:85-91`).
- A tx id is single-use (`001_init.sql:68`).
- Non-simulated evidence must be ledger-verified before approval (`authorizations.ts:72-77`). Receipt digest and conclusion are rechecked at approval creation (`:172-173`).
- Simulated evidence is never merged (`merges.ts:175`, before any GitHub call). Receipt digest equals operation digest (`merges.ts:176`).

### B. World approval

- RP signatures are created server-side only, with no action for session proofs and a TTL capped by the authorization lifetime (`world.ts:20-27`, `authorizations.ts:98-100`). This matches the `signRequest({signingKeyHex, action?, ttl?})` signature in idkit-server 1.2.0.
- The full IDKit result is forwarded unmodified to `POST {base}/api/v4/verify/{rp_id}` with `redirect:"error"` and a 10 s timeout. Only HTTP 200 + `success:true` + a matching `environment` counts (`world.ts:160-182`), as the World docs require.
- Local checks before the network call (`world.ts:74-143`):
  - protocol `4.0`;
  - session proofs must not carry `action`;
  - `session_id` format;
  - environment equality;
  - exactly one `proof_of_human` response with `issuer_schema_id 1`;
  - `signal_hash` equals `hashSignal(operation_hash)` after canonicalization;
  - presence required when configured, and mandatory in production (`config.ts:98-101`).
- Nonce handling (`enrollment.ts:30-42`, `authorizations.ts:263-269`, `:287-290`): the nonce must have been issued for the purpose `approve`, this browser session, this GitHub user and this authorization. It must also be unexpired and unused. It is claimed with a CAS update inside the final transaction.
- The proof's `session_id` must equal the maintainer's enrolled World session (`authorizations.ts:270-273`). The enrollment must match the current env/rp/action (`access.ts:33-40`) and be the one bound to the authorization (`:255`).
- Session-nullifier replay is blocked globally by a canonicalized PK (`002_*.sql:120-125`, `authorizations.ts:291-293`, `world.ts:34-43`). Hex and decimal re-encodings collide, as required by the docs ("store as numbers").
- Operation:
  - It is built from server state only (`authorizations.ts:180-199`). It contains repo id, repo, PR, head SHA, base ref, report digest, scanner version, evidence kind, merge method, approver id and login, World env, rp_id, a 24-byte random nonce, expiry and authorization id.
  - It is re-hashed from the stored JSON before approve and execute (`:65-69`), and must equal the client-submitted hash (`:250`).
  - The approver is bound by numeric GitHub id (`:93`, `merges.ts:146`).
- Single use:
  - `merge_authorizations_one_open_per_job` and the `operation_hash UNIQUE` constraint (`002_*.sql:54,75-76`);
  - CAS `pending→approved` and `approved→consumed` (`authorizations.ts:295`, `merges.ts:155-158`);
  - approval freshness at most 10 min (`merges.ts:151`);
  - expiry cascades to the proof requests and the job (`authorizations.ts:80-88`).
- Deny/cancel close the pending authorization and cancel issued nonces in one transaction (`authorizations.ts:317-327`). The web widget cancels on close or error, and only the server-side `/approve` result counts as consent (`human-checkpoint.tsx:62-90`).
- Account linking: one World identity cannot enroll two GitHub users (`002_*.sql:43`, unique nullifier per env/rp/action), and one GitHub user cannot swap World identities (`github_user_id UNIQUE`, `:34`; `enrollment.ts:57,96`). Both cases are covered by existing tests.

### C. Merge

- The approval is consumed and the single attempt is claimed atomically before any network call (`merges.ts:143-166`, `BEGIN IMMEDIATE` in `db/index.ts:35-45`, `merge_attempts.authorization_id UNIQUE`). Cursor's concurrency test shows exactly one call reaches GitHub.
- Before the merge (`merges.ts:76-116`), the following are re-checked:
  - live permission, with the numeric id matched to the login (`access.ts:46-53`);
  - repository id;
  - open and not merged;
  - head SHA (stale otherwise);
  - base ref;
  - mergeability;
  - all check runs completed and passing;
  - combined status;
  - ruleset required checks.
  
  Pagination overflow fails closed (`github/src/index.ts:300,307`).
- `PUT /pulls/{n}/merge` is called with `sha` (`github/src/index.ts:322`). A 409 means stale with no retry. A 5xx/429/network error or an unparseable 200 is treated as unknown → `reconcile_required`, resolved by a read-only PR fetch and never by re-sending the merge (`merges.ts:119-135`, `:197-200`).
- Head moves invalidate open authorizations, but not in-flight merges (`store.ts:147-172`).

### D. Sessions, CSRF and other web controls

- Session tokens are 32 random bytes, stored as sha256, HttpOnly, SameSite=Lax, 8 h TTL, revoked on logout. A fresh session is created on every login, so there is no fixation (`auth.ts:26-56,122-127,151-155`).
- OAuth state is 32 bytes, bound to a pre-login browser cookie, single-use with a CAS update and a 10 min TTL. The redirect target is fixed to `APP_URL`, with no open redirect. No scopes are requested and the user token is discarded (`auth.ts:88-129`).
- CSRF: every non-GET maintainer route requires an `x-csrf-token` derived from the session, compared timing-safely, plus Origin equality when the header is present (`auth.ts:62-77`). No CORS headers are set; the API binds to 127.0.0.1 behind the Next same-origin proxy (`server.ts:12`, `next.config.ts:8-10`).
- The agent bearer token is compared with `timingSafeEqual` over sha256 digests, requires at least 32 chars, and agent endpoints are disabled if it is unset (`app.ts:151-162`, `config.ts:24`).
- All SQL is parameterized. Error responses carry codes only, and GitHub bodies are not echoed (`app.ts:164-180`, `github/src/index.ts:229-235`). Body limits are in place (`app.ts:41-47`). Logs contain no secrets (`server.ts:13-18`, `app.ts:178`).

## Cannot be verified without live credentials

- Whether World `/api/v4/verify` cryptographically checks `signal_hash`, `session_id` and `user_presence_completed` against the proof, and whether it enforces RP-nonce single use and expiry on its side (L-7).
- Real World App / simulator payload encodings (hex vs decimal nullifiers, nonce casing) and the verify response shape (`session_id`, `nullifier` presence).
- GitHub behavior for `role_name` on custom roles (M-1 precondition), the `PUT /merge` status codes for draft PRs and ruleset failures, and `/rules/branches` output for the demo repo.
- Hedera mirror-node indexing latency and the transaction shape of real x402 settlements (memo and payer fields needed for the M-4 fix).
- Next.js proxy forwarding of the `Origin`/`Cookie` headers in the deployed configuration.
