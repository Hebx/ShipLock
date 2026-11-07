# Multi-agent coordination — Hermes + Cursor

## Suggested lanes (change as needed)

| Owner | Focus | Branch prefix | Deliverable |
|---|---|---|---|
| Hermes | M0 source/version/license audit; M1 live Hedera x402 spike; adversarial security review | `hermes/` | `docs/RESEARCH_NOTES.md`, payment module and evidence |
| Cursor | App UX, DB, audit scanner, GitHub sign-in, World IDKit, GitHub SHA merge gate | `cursor/` | backend/frontend modules, integration tests, evidence |
| Human maintainer | World Developer Portal app, GitHub OAuth App, funded keys, GitHub disposable repo, review and final acceptance | `main` reviews | no secrets in repo; verified milestone gates |

### Ownership rules

1. Before coding, each agent opens a scoped task/issue and posts which files it will change. Avoid conflicting changes to shared route schemas.
2. Start with contract definitions/interfaces agreed in `docs/RESEARCH_NOTES.md`, then parallelize.
3. One PR per milestone or bounded feature; all tests and typecheck must pass.
4. Do not claim a feature verified without linked evidence; mocks are named.
5. Security-sensitive World ID, session, wallet and GitHub merge code requires independent cross-agent review.
6. Every branch handoff uses the template below and updates `docs/PROGRESS.md`.

### Handoff template

```text
TASK / MILESTONE:
OWNER / BRANCH / COMMIT SHA:
SOURCE REFS / PACKAGE VERSION PINS:
IMPLEMENTED FILES / BEHAVIOR:
TESTS / RESULTS (mock vs live):
REPRO COMMANDS:
REQUIRED ENV NAMES (never values):
EVIDENCE LINKS (HashScan/GitHub/logs sanitized):
FAILURE CASES TESTED:
OPEN RISKS / HANDOFF TO:
```

**Priority:** real x402 payment & server-verified World ID (IDKit) before polish or optional HCS/extra sponsors. Stop and surface integration blockers. Do not quietly replace real sponsors' flows with simulated screens.

## Handoffs

```text
TASK / MILESTONE: M3 World IDKit pivot + GitHub maintainer auth; M4 merge gate; paid-review acceptance (consumer side of M1)
OWNER / BRANCH / COMMIT SHA: Cursor / cursor/product-gate / see `git log` (commits after 158eedf)
SOURCE REFS / PACKAGE VERSION PINS: @worldcoin/idkit-core 4.6.0 (api), @worldcoin/idkit 4.6.0 (web); docs.world.org/world-id/idkit/{integrate,session-proofs}
IMPLEMENTED FILES / BEHAVIOR:
  - Contract for Hermes (unchanged shape): PaidReviewResult, ReviewPurchaseGateway in packages/shared/src/contracts.ts;
    verifyPaidReviewResult in packages/policy/src/paid-review.ts. Acceptance requires: job/repo id/PR/head SHA/base SHA/
    scanner version match; canonicalSha256(report) == reportSha256 == ShipLock's own local digest; network hedera:testnet;
    asset == X402_HBAR_ASSET (default "0.0.0" — please confirm the exact string your merchant quotes); merchant ==
    HEDERA_AUDIT_PAYTO_ACCOUNT_ID; amount == AUDIT_PRICE_TINYBAR and <= AGENT_MAX_PAYMENT_TINYBAR; payer != merchant;
    settlementConfirmed true; evidenceKind in SHIPLOCK_ACCEPTED_EVIDENCE (default live only).
  - Endpoint: POST /api/reviews/:jobId/paid-review, Authorization: Bearer SHIPLOCK_AGENT_TOKEN,
    body {adapterId, result: PaidReviewResult}. 200 accepted | 202 ledger_pending (mirror node has no record yet; resubmit
    the SAME result later) | 422 paid_review_rejected {reasons} | 409 transaction_already_used / paid_review_already_recorded /
    stale head. ShipLock independently looks up hederaTransactionId on the mirror node (SUCCESS, CRYPTOTRANSFER, merchant
    credited exactly the amount, payer debited at least it). Idempotent for the same transaction.
  - Merchant digest: the merchant should run @shiplock/scanner scanDiff over the GitHub compare base...head bytes for the
    job's exact SHAs (same as packages/github getCompareDiff) so the report and its digest match ShipLock's byte for byte.
  - A labeled fake ReviewPurchaseGateway / `simulate-paid-review` CLI produces evidenceKind "simulated"; it is refused by
    default and can never be merged.
TESTS / RESULTS (mock vs live): unit only — apps/api/test/{paid-review,approval,merge,maintainer,world}.test.ts with
  stubbed World verify, mirror node and in-memory GitHub. Nothing here has run live.
REPRO COMMANDS: pnpm typecheck && pnpm test && pnpm build:web
REQUIRED ENV NAMES (never values): see .env.example (WORLD_*, GITHUB_OAUTH_*, SHIPLOCK_*, HEDERA_AUDIT_PAYTO_ACCOUNT_ID,
  X402_HBAR_ASSET, AUDIT_PRICE_TINYBAR, AGENT_MAX_PAYMENT_TINYBAR, HEDERA_MIRROR_NODE_URL)
EVIDENCE LINKS: none yet; runbook docs/evidence/world/README.md
FAILURE CASES TESTED: see the negative test matrix in docs/SECURITY.md
OPEN RISKS / HANDOFF TO: Hermes —
  1. Please adversarially review (AGENTS.md requires a second agent before "verified"): World IDKit binding
     (apps/api/src/{world,enrollment,authorizations}.ts: nonce/session/signal/nullifier/environment checks), sessions + CSRF
     (apps/api/src/auth.ts), and the merge gate (apps/api/src/merges.ts) against docs/SECURITY.md.
  2. docs/RESEARCH_NOTES.md (yours) still has an Agent Pass identity row; ShipLock now uses IDKit 4.6.0 — please update it.
  3. Confirm the HBAR asset string and the mirror-node transaction id format your payment path produces.
```

### Hermes, coordination cycle 1 (2026-11-07): payment adapter on contract v2

```text
Agent: Hermes
Milestone: M0 (verified), M1 payment (verified live; integration pending Cursor), Gate D review (in progress)
Branch / commit SHA: hermes/x402-contract-v2 @ fc87aca (on cursor/contract-v2 @ 5e8133c) · PR #2 (draft, base cursor/contract-v2), CI green
Completed functionality: @shiplock/x402 workspace package; buyer implements ReviewPurchaseGateway on contract v2 (extra.shiplock
  canonical binding incl. diffSha256); merchant verifies repo id / PR / head / base / diff digest against GitHub before quoting,
  uses @shiplock/scanner, settles via Blocky402, confirms on mirror; SQLite single-use quotes + uncertainty reconciliation.
Verified tests: pnpm -r typecheck clean; pnpm -r test all green (x402 61, incl. Cursor's unmodified verifyPaidReviewResult +
  checkHederaTransfer run on the buyer output).
External evidence: live testnet txs 0.0.7162784@1794012935.145851264, 0.0.7162784@1794014756.028048683,
  0.0.7162784@1794014990.278100917 (contract v2; Cursor verify ok + mirror confirmed). docs/evidence/payment/M1.md
Interfaces exported: createReviewPurchaser, ADAPTER_ID, createAuditMerchant, createScannerAuditor, auditUrl, MerchantStore,
  resolveHederaCapability, createMirrorClient, typed errors. Mapping: docs/integration/PAYMENT_CONTRACT.md
Required environment variables: HEDERA_AGENT_ACCOUNT_ID, HEDERA_AGENT_PRIVATE_KEY, HEDERA_AUDIT_PAYTO_ACCOUNT_ID,
  HEDERA_MIRROR_NODE_URL, X402_FACILITATOR_URL, AUDIT_PRICE_TINYBAR, AGENT_MAX_PAYMENT_TINYBAR, GITHUB_TOKEN (optional),
  SHIPLOCK_AUDIT_URL (new, for Cursor's wiring)
Blockers: none on payment. cursor/product-gate exists only locally (not pushed); cursor/integration does not exist yet.
Next action required from Cursor: push cursor/product-gate; create cursor/integration; replace the simulated gateway with
  createReviewPurchaser; persist onSigned tx id; decide merchant hosting + SHIPLOCK_AUDIT_URL; triage the Hermes security
  review (docs/reviews/hermes-security-review-cursor-product-gate.md, landing next).
```
