# ShipLock — research-first coding agent brief

**Product:** An agent commissions a pay-per-request independent code review on Hedera x402. A GitHub-authenticated maintainer with repository write permission proves they are a unique, present human with World ID (IDKit, Proof of Human) and explicitly authorizes merging the *specific* reviewed commit. The integration prevents unauthorized, stale, changed-SHA, cancelled, or replayed merges.

**Hackathon:** ETHGlobal Mumbai, November 2026. **Delivery approach:** evidence-gated milestones, not timeboxes. **Build from scratch** in a new repository. Reference older code for patterns; disclose what was reused and respect licenses. Don't call Hedron the latest working end-to-end x402 app.

## Non-negotiable outcome

1. A real public `/api/audit/:id` endpoint that returns HTTP **402** with valid x402 v2 Hedera `exact` requirements before purchase.
2. An autonomous agent fetches it, pays **HBAR on Hedera testnet** using a current compatible facilitator, and receives a genuine audit output. The user does NOT approve this small research payment. Save the real `transactionId` and HashScan link. **Do not consider a mocked facilitator or direct HBAR transfer equivalent to x402.**
3. The audit is bound to `owner/repo`, pull request number, **head SHA**, and the scanner output digest.
4. The maintainer signs in with GitHub, enrolls a World ID Proof of Human once, and approves precisely that action with a fresh World ID session proof whose signal is the operation hash. Every proof is verified server-side with World. A World ID proof establishes humanness only — it is *not* consent or authority to merge by itself.
5. Before merge, re-read the live PR's head SHA and check repo allowlist, actor role, CI policy and immutable approval binding. Call GitHub merge API with the approved `sha` (server side). New SHA = reject and request a new audit/approval.
6. Demonstrate refused/cancelled World verification, expired approval, replay, failed or changed SHA, and insufficient audit status: no merge.
7. Demo in a **disposable dedicated GitHub repository**, not a production repo.

## Research gate: do BEFORE implementing payments

Produce `docs/RESEARCH_NOTES.md` with a matrix of **source URL, latest inspected commit SHA, file paths, actual relevant functions, package versions, implementation status (live testnet / docs / stub), license, reuse decision**. Complete a focused evidence review, then construct a live payment spike. Do not let repository research become a substitute for a real settlement.

Priority source audit:

**A. Primary current SDK and docs**
- https://github.com/x402-foundation/x402  — inspect `typescript/packages/mechanisms/hedera` exact client/server/facilitator and examples, along with core/fetch/express. Verify actual installed exports against `@x402/hedera`, `@x402/core`, `@x402/fetch`, `@x402/express`. Current npm organization lists v2.30.0 as of 2026-11-07; confirm package availability locally and **pin compatible exact versions**.
- https://docs.hedera.com/solutions/ai/x402 — exact scheme, supported facilitator and `hedera:testnet` vs `hedera:mainnet` and fee payer. Query `/supported` in the chosen testnet facilitator. Never assume `transferExecutor` is merged; keep standard `cryptoTransfer` exact HBAR payments.
- https://docs.world.org/world-id/idkit/integrate and https://docs.world.org/world-id/idkit/session-proofs — World IDKit 4.x (pivoted from Agent Pass OIDC; see `docs/RESEARCH_SOURCES.md`).

**B. Latest ETHOnline 2026 Hedera x402 winners (inspect actual code, not just READMEs)**
- **Carpool:** https://github.com/RomarioKavin1/carpool
  - `packages/hedera-x402/src/gate.ts`: issue and preserve a quote between the initial HTTP 402 and the paid retry; validate exact `amount`, `payTo`, resource; durable payment record/outbox.
  - `apps/mcp/src/pay.ts`, `apps/bench/src/agent.ts`: actual `x402Client`, `wrapFetchWithPayment`, Hedera signer, spend cap and `PAYMENT-RESPONSE` transaction extraction.
  - `docs/AUDIT-MOCKS.md`: learn why fake facilitators and green unit tests can conceal a broken real settlement path. Notice `@x402/hedera` and `@hiero-ledger/sdk` versions can cause duplicate `PrivateKey` type clashes.
  - Do not copy Carpool's USDC economics or escrow unless required; ShipLock uses HBAR for time efficiency.
- **AutoVoyage:** https://github.com/SyuraMoons/ETHOnline-AutonomousTravelAgent
  - `facilitator/src/server.ts` and the supplier code: complete self-hosted `/supported`, `/verify`, `/settle` and paid service. Investigate HBAR allowance-mode vs treasury-mode incompatibilities before using them. Prefer existing listed facilitator for the six-hour build; don't self-host unless necessary.
  - inspect immutable quote/operation hash and HCS patterns. Flight inventory is fixtures despite real payments; do not misrepresent app output.
- **Turnstile:** https://github.com/IpastorSan/turnstile
  - inspect agent discovery and `PaymentRail` abstraction, Hedera-paid analytics, HCS audit. Avoid copying its cross-chain complexity.
- **Hedera developer reference:** https://github.com/hedera-dev/x402-inference-pay-per-request-poc
  - `packages/service/src/x402.ts` and `packages/agent/src/x402-client.ts` provide small client/server wiring and live event stages. Repo references older 2.18-era SDK; adapt to pinned current SDK after inspecting actual exports.

**C. Previous official Hedera x402 bounty winners (Aug 31, 2026)**
- https://github.com/hitakshiA/pinout — metered paid sessions and HCS receipts.
- https://github.com/Madhav-Gupta-28/Tally — metered spending caps and receipts (`upto` is NOT necessary for our fixed-price MVP).
- https://github.com/farouk-allani/qisma — atomic payment splitting and receipt verification (not required for MVP).
- https://github.com/nickthelegend/xorv — paid jobs, HTS and audit.
- Winner announcement: https://hedera.com/blog/x402-bounty-on-hedera-winners-announced/

**D. Hedron: prior security reference ONLY**
- https://github.com/Glorian-Labs/Hedron/pull/11 — quote integrity; facilitator URL and fee-payer trap; idempotency, replay and receipt handling; real payment test; account/private key separation.
- https://github.com/Glorian-Labs/Hedron/pull/12 — explicit limitations: standalone x402 rail is proven, but not a complete current Broker + HCS application.

**E. GitHub correctness**
- https://docs.github.com/en/rest/pulls/pulls — inspect merge API `sha` guard (returns HTTP 409 on mismatch). Use least-privilege GitHub App / fine-grained credential scoped to a disposable test repository. Do not bypass branch protection. Run CI/status check and make policy explicit.

## Product scope

A user visits ShipLock, selects a PR in a disposable repo, and sees a `Review required` state. A background agent selects a paid scanner API, autonomously buys an audit, and surfaces deterministic results. The UI shows actual payment proof (HashScan), exact commit SHA and report. An authorized maintainer (GitHub write permission, enrolled World ID) explicitly approves the merge with a fresh World ID proof over the exact operation. Only if the audit passes and approval binds to the unchanged head SHA will a server-side workflow merge the PR. A second PR with a changed SHA or cancelled authentication stays blocked.

### MVP audit service
- The service fetches a GitHub diff by SHA and performs **real deterministic checks** (e.g. detect added high-entropy tokens, `eval()`/shell calls, insecure permissions, risky dependency/package changes, new external request endpoints). Include line numbers and an `inconclusive` status for unsupported analyses.
- Optional LLM summary is informational, not a security certification. Do not attempt to build a full SAST product for the MVP. The scanner should work without expensive model API keys.
- Pricing for the demonstration may be fixed (e.g. 100–10,000 tinybar) using HBAR `asset=0.0.0`; payment prices must be in base units and exact SDK semantics must be checked.
- Audit JSON shape: `reviewId, repo, pr, headSha, rulesVersion, findings[], conclusion, evidenceHash, paymentTxId`. Avoid reporting 'secure' merely because no heuristic alerts fired.

### Minimal API
- `POST /api/reviews` validates repo allowlist, PR metadata, creates review intent.
- `GET /api/reviews/:id` returns status, source SHA, paid audit summary and HashScan tx URL.
- `GET /api/audit/:id` is x402-gated; first request returns 402, authenticated paid retry fulfills exactly once and returns audit.
- Maintainer, World and merge endpoints as implemented: see `docs/ARCHITECTURE.md` (`/api/auth/github/*`, `/api/world/enrollment/*`, `/api/authorizations/*`, `/api/merges/*`).

### Suggested database tables
`reviews` (repo, pr, head_sha, scanner_version, state, paid_tx_id, audit_hash, created_at), `payment_receipts` (unique tx id, quote hash, fulfilled_at), World proof requests (single-use RP nonce bound to session, purpose and authorization), enrollments, session nullifiers, `merge_authorizations` (unique operation hash + GitHub/World binding, consumed_at) — implemented schema in `docs/ARCHITECTURE.md`, `merge_attempts` (unique review id, GitHub result), `audit_events` (hashes, not sensitive token data).

### Workflow state machine
`NEW -> PAYMENT_REQUIRED -> PAID -> AUDITED -> WORLD_AUTH_PENDING -> AWAIT_EXPLICIT_APPROVAL -> APPROVED -> MERGING -> MERGED`
Failures: `PAYMENT_REJECTED`, `AUDIT_BLOCKED`, `WORLD_CANCELLED`, `WORLD_EXPIRED`, `IDENTITY_MISMATCH`, `SHA_CHANGED`, `APPROVAL_REPLAY`, `MERGE_FAILED`. No failure path may mark MERGED.

## Security invariants (must be tested)

1. The user-facing frontend never holds Hedera private keys, the World RP signing key, the GitHub OAuth secret or the GitHub write credential.
2. Paid audit result must be derived from the repo+PR+SHA quoted. Merchant cannot silently reprice/rebind after HTTP 402. Buyer verifies amount/payTo/network/assets against allowlist and spend cap before signing.
3. Return deliverable only after real confirmed settlement. Save receipt idempotently before deliverable; no duplicate settlement calls or double fulfillment. On uncertain settlement, reconcile via mirror node rather than blindly retrying `/settle`.
4. A World ID proof is **proof of human, not approval**. Verify every proof with World server-side; bind the RP nonce to the signed-in session and operation; require the enrolled World session, the operation hash as signal, user presence and the expected environment; reject replayed nullifiers. No trust in client-supplied 'verified'. Use one-use approval and exact action hash; distinguish staging/simulator proofs from real proofs.
5. Merge operation is bound to immutable PR head SHA, repo, PR number, reviewed diff/hash, authorizing identity, expiration and intended merge method; re-read SHA, CI and policy immediately before executing. GitHub merge call MUST include expected SHA.
6. Avoid granting GitHub write permission beyond the isolated demo repository. Do not allow arbitrary repo URLs, SSRF, unsafe git commands, or untrusted PR code execution on the backend. Don't run attacker-controlled scripts to scan a PR.
7. No secrets in logs, public HCS or frontend. HCS audit is optional and only after real payment + World + merge working; publish hashes rather than private findings.
8. Tests and demo must identify fixtures, simulations, and real chain events honestly.

## Real-world use case and user story

**User:** A maintainer of a small open-source payments library who delegates code changes to autonomous coding agents. A contributor opens a PR touching wallet payment validation, a high-consequence area. The maintainer wants to ship quickly without personally operating a full security tooling stack, but refuses to let the agent merge a different revision from the one reviewed.

**Narrative:** The agent requests an independent paid static-analysis service for the PR's fixed head SHA. The service quotes a price via HTTP 402; the agent pays autonomously on Hedera testnet, receives concrete findings, and records the payment and audit hashes. If the report and required CI checks pass, a human maintainer signed in with GitHub reads the exact operation and explicitly approves it with a fresh World ID proof. The backend re-reads the PR head and GitHub merge conditions. An expected-SHA merge succeeds only while everything remains unchanged. A push after approval invalidates the authorization.

**Important differentiation:** GitHub already has CI, branch protection, CodeQL and pull-request reviews. Our product is a *paid review procurement + exact-version human release authority* workflow; it does not promise to detect all vulnerabilities or override GitHub repository protections.

**Personas and jobs-to-be-done:**
- Maintainer: 'When agents ship PRs in my security-sensitive repository, I want to procure extra scrutiny on demand and approve exactly one reviewed revision so I can merge confidently without granting the agents release authority.'
- Coding agent: 'When I finish a PR, I want to select a bounded-price audit, pay without onboarding, and present an evidence packet rather than ask the human to operate the scanner.'
- Independent review provider: 'When someone requests my code scan, I want to charge per immutable analysis job and return verifiable output tied to exact source bytes.'

**Near-future opportunity:** Today it protects a GitHub merge. The same pattern can extend to production deployments, package publication, contract upgrades and machine-to-machine procurement. That extension is a product hypothesis, not something the hackathon prototype proves.

## Project layout

```
apps/web             # Next.js PR dashboard and approval UI
apps/api             # Hono HTTP service: sessions, World verify, merge gate
packages/x402        # isolated buyer + seller payment integration
packages/scanner     # deterministic diff analysis
packages/policy      # immutable SHA, replay, expiry and merge gates
packages/github      # safe read/merge API and typed clients
packages/shared      # types, schema, hashing
scripts/             # live payment smoke probe; demo setup
/docs/               # RESEARCH_NOTES, payment proof, runbook, submission
```

Simplify to a single Next.js application + modules if that yields a more reliable deploy. Do not let architecture replace product functionality.

## Milestone delivery plan (completion gates, not a schedule)

| Milestone | Artifact | Definition of done / proof |
|---|---|---|
| **M0 — Verify the implementation baseline** | `docs/RESEARCH_NOTES.md` | Compare current upstream x402 with Carpool, AutoVoyage, Turnstile, Hedera reference, and Hedron; record inspected SHA, relevant file, real-vs-mock, package compatibility, license and chosen pattern. |
| **M1 — Prove autonomous settlement** | x402 paid audit endpoint + autonomous buyer | HTTP 402 challenge, signed HBAR Hedera testnet payment, facilitator settlement, accurate HashScan transaction, actual paid API response. Fail if simulated. |
| **M2 — Make the review evidence trustworthy** | deterministic scanner + report | Report anchored to repo, PR number, HEAD SHA, scanner/rules version and content hash; real findings with line references; blocking/inconclusive states distinguished. |
| **M3 — Validate a fresh human checkpoint** | World IDKit Proof of Human + GitHub sign-in | Server verifies World proofs (environment, nonce, signal, session, presence, nullifier replay). Explicit approval binds one GitHub maintainer and enrolled World ID to one exact merge operation. Cancelled, denied and expired flows fail closed. |
| **M4 — Enforce the actual merge** | least-privilege GitHub App + policy gate | Re-read current head SHA and required checks; enforce repo allowlist; consume one-use approval; GitHub merge API uses expected SHA; changed code cannot merge. Respect branch protection; optionally publish required status check. |
| **M5 — Demonstrate both outcomes** | reproducible live evidence | Disposable repo has one genuine approved merge, one blocked attempt after SHA mutation/cancel; public links, tests, transaction and auth integration proof. No fake successes. |
| **M6 — Package and extend** | docs, deployment, demo, optional HCS | Setup instructions, sponsor debrief, source references, honest limitations; optionally add hash-only HCS audit and provider marketplace architecture only after M1–M5 work. |

**Milestone dependency:** M0 → M1 → M2 → M3 → M4 → M5. M6 is not a precondition for primary sponsor qualification. Prioritize real integrations ahead of UI polish.

## Acceptance test matrix

- `A1` unpaid audit => standard HTTP 402 and no deliverable.
- `A2` buying agent => real HBAR payment; verified Hedera testnet transfer, HashScan link and complete audit response.
- `A3` malformed payload, wrong network, amount, asset or payTo => rejected.
- `A4` duplicate payment receipt or paid retry => at most one fulfillment, no new payment.
- `A5` audit `inconclusive` or blocking finding => cannot merge unless an explicit policy override exists (not MVP).
- `A6` server-verified World ID session proof over the operation hash, from the enrolled session => bound one-use authorization.
- `A7` cancel/expired/wrong-account/replay => cannot merge.
- `A8` after approval, change PR head SHA => cannot merge; status `SHA_CHANGED`; requires fresh paid audit and approval.
- `A9` exact approved SHA, no blockers, valid GitHub permissions => actual merge into disposable repo, show GitHub URL.
- `A10` every UI badge maps to real persistent state; no screenshot-only fake success.

## Demo storyboard (show success and failure)
1. A PR is awaiting review. Agent sees paid scan offer and obtains HTTP 402.
2. Agent pays autonomously with HBAR, API supplies actual review and HashScan explorer link.
3. Maintainer sees exact SHA, report, safe-to-merge policy status; approves the exact SHA with World ID.
4. Backend calls GitHub merge with bound SHA; show real merge and audit record.
5. Repeat with changed SHA or a cancelled/rejected World ID approval; show blocked state and unchanged GitHub PR.

## Submission proof record

Create `docs/SUBMISSION_EVIDENCE.md` with exact URLs: repo URL, demo deployment, PR source/head SHA and merge URL, actual Hedera tx id and HashScan URL, World integration mode and validated journey (do not share tokens), negative path result, any HCS topic/sequence, tests and commands. Mark unrun E2E checks as *unverified*.

## Sponsor alignment — ETHGlobal Mumbai "Best Use of IDKit"

Source: https://ethglobal.com/events/mumbai/prizes (World section; $2,500, up to 2 teams × $1,250; a separate Continuity-Track copy of the same prize exists). The same page lists the Agent Pass prizes ShipLock no longer targets. Qualification requirements, verbatim:

- "Integrate IDKit in a functioning application, mini app, or onchain flow."
- "Use at least one supported World ID credential and verify the result on the server or onchain as appropriate."
- "Clearly explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance."
- "Demonstrate a successful verification and one meaningful alternative path, such as cancellation, unavailable credential, rejection, or an ineligible user."
- "Include a short integration debrief/feedback: time to first success, friction encountered, missing capability or documentation, and the one improvement with the greatest impact."

How ShipLock maps (claims become evidence only once `docs/evidence/world/` has it):

- **Trust event:** releasing agent-written code into a protected branch. ShipLock must know that a unique human — not the agent, and not one operator posing as several maintainers — is present and approves this exact commit.
- **Credential:** Proof of Human with a fresh user-presence check where supported. GitHub supplies *who* the maintainer is and whether they may merge; World only needs to supply *a unique human is here now*. Passport/document credentials would collect identity attributes ShipLock does not need. Selfie Check (Proof of Presence) is lower assurance; ShipLock binds one World ID to one GitHub account, which is only meaningful with a strong uniqueness guarantee. This choice is the team's to defend in the submission.
- **Server verification:** every enrollment and approval proof goes to `POST /api/v4/verify/{rp_id}`; no client result is trusted.
- **Alternative paths:** World `user_rejected`/closed ⇒ authorization cancelled, no merge; maintainer deny; ineligible user (no repository permission, or World ID already enrolled to another account); stale SHA after approval.
- **Debrief:** record measured values during the simulator and production runs in `docs/evidence/world/`.

## One-line pitch

**ShipLock — AI can write code and pay for independent review, but only a verified maintainer can authorize merging the exact code that was reviewed.**
