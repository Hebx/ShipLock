# Multi-agent coordination — Hermes + Cursor

## Suggested lanes (change as needed)

| Owner | Focus | Branch prefix | Deliverable |
|---|---|---|---|
| Hermes | M0 source/version/license audit; M1 live Hedera x402 spike; adversarial security review | `hermes/` | `docs/RESEARCH_NOTES.md`, payment module and evidence |
| Cursor | App UX, DB, audit scanner, OIDC, GitHub SHA merge gate | `cursor/` | backend/frontend modules, integration tests, evidence |
| Human maintainer | World IdP registration, funded keys, GitHub disposable repo, review and final acceptance | `main` reviews | no secrets in repo; verified milestone gates |

### Ownership rules

1. Before coding, each agent opens a scoped task/issue and posts which files it will change. Avoid conflicting changes to shared route schemas.
2. Start with contract definitions/interfaces agreed in `docs/RESEARCH_NOTES.md`, then parallelize.
3. One PR per milestone or bounded feature; all tests and typecheck must pass.
4. Do not claim a feature verified without linked evidence; mocks are named.
5. Security-sensitive OIDC, wallet and GitHub merge code requires independent cross-agent review.
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

**Priority:** real x402 payment & validated World Agent Pass before polish or optional HCS/extra sponsors. Stop and surface integration blockers. Do not quietly replace real sponsors' flows with simulated screens.

## Handoff log

### Hermes → Cursor: Hedera x402 payment subsystem (M0 + M1)

```text
TASK / MILESTONE: M0 research + M1 live x402 paid audit
OWNER / BRANCH / COMMIT SHA: Hermes / hermes/hedera-x402 / see PR head
SOURCE REFS / PACKAGE VERSION PINS: @x402/{core,fetch,hedera}@2.30.0, @hiero-ledger/sdk@2.90.1 (docs/RESEARCH_NOTES.md)
IMPLEMENTED FILES / BEHAVIOR: packages/x402/** (merchant /audit, buyer purchaseReview, mirror confirm, SQLite state)
TESTS / RESULTS (mock vs live): 41/41 unit (strict official facilitator scheme, in-memory ledger); 1 LIVE testnet settlement + 6 live negative probes
REPRO COMMANDS: pnpm --dir packages/x402 install && pnpm --dir packages/x402 typecheck && pnpm --dir packages/x402 test && pnpm --dir packages/x402 live
REQUIRED ENV NAMES (never values): HEDERA_AGENT_ACCOUNT_ID, HEDERA_AGENT_PRIVATE_KEY, HEDERA_AUDIT_PAYTO_ACCOUNT_ID, HEDERA_MIRROR_NODE_URL, X402_FACILITATOR_URL, AUDIT_PRICE_TINYBAR, AGENT_MAX_PAYMENT_TINYBAR, GITHUB_TOKEN (optional)
EVIDENCE LINKS: docs/evidence/payment/M1.md; https://hashscan.io/testnet/transaction/1794012941.965828621
FAILURE CASES TESTED: see docs/evidence/payment/M1.md
OPEN RISKS / HANDOFF TO: Cursor. (1) contracts.ts unchanged; purchaseReview returns PaidReviewResult + evidence. (2) Handle PaymentUncertainError / PaidButNotFulfilledError as "never re-pay". (3) Persist onSigned() tx id per jobId before send. (4) Plug packages/scanner in as the merchant `auditor`. (5) Create Hebx/shiplock-demo-target and set repoAllowlist.
```
