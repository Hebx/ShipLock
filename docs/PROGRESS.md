# Milestone progress (source of truth)

| Milestone | State | Owner | Branch/commit | Proof | Blockers |
|---|---|---|---|---|---|
| M0 research | Verified | Hermes | `hermes/hedera-x402` | [RESEARCH_NOTES](RESEARCH_NOTES.md) | — |
| App foundation (DB, schemas, state machine, API, UI) | In progress — foundation tests pass | Cursor | `cursor/product-gate` | [app-foundation.md](evidence/app-foundation.md) §1 | — |
| M1 paid x402 | Verified (live testnet) and integrated into the app | Hermes (adapter), Cursor (wiring) | `cursor/integration` | [M1 evidence](evidence/payment/M1.md), [Gate C payment](evidence/integration/gate-c-payment.md) | Merchant not publicly hosted |
| M2 SHA-bound audit | Verified (live GitHub read on the demo repo) | Cursor | `5e8133c` | [M2](evidence/github/M2.md) | — |
| M3 World ID (IDKit) + GitHub maintainer | In progress — implemented, unit-tested only; World Portal app, staging action and GitHub OAuth App configured (credentials validated, no proof verified yet) | Cursor | `cursor/integration` | runbook: [world/README.md](evidence/world/README.md) (no evidence yet) | Simulator enrollment + approval run in a browser; Hermes Gate D review |
| M4 GitHub merge | In progress — executor implemented, unit-tested against in-memory GitHub; no real merge | Cursor | `cursor/integration` | — | M3 approval; Hermes Gate D review; demo repo has no branch protection (see M2) |
| M5 evidence/demo | Not started | Joint | — | — | M1–M4 |
| M6 optional | Not started | Joint | — | — | — |

Update this file whenever a milestone changes state. Use `Not started`, `In progress`, `Blocked`, or `Verified` with evidence URL.

## Change log

### Cursor — `cursor/integration` — Hermes Gate D security fixes

- Commit `ce01ba7` addresses M-1 through M-4 and L-6: safe GitHub permission ranking; uncertain/interrupted merge reconciliation without re-sending the merge; development-evidence merge refusal unless explicitly enabled; paid-review payer and job-time binding; and GitHub App identity enforcement for pinned required checks.
- M-4 uses ShipLock-side payer and consensus-time checks only. Merchant quote confirmation keyed by a merchant-stored `quoteId` remains the agreed follow-up and requires a merchant change plus a later optional `PaidReviewResult.quoteId`.
- Tests (unit; World, GitHub, mirror node and payment dependencies stubbed — **not live evidence**): shared 12, scanner 9, github 12, policy 11, x402 61, agent 11, api 77. Workspace typecheck passes.
- M3 and M4 remain in progress and unverified until a live World approval and SHA-guarded GitHub merge produce evidence.

### Cursor — `cursor/integration` — agent wiring and live paid review through ShipLock

- Merged Hermes PR #2 (`hermes/x402-contract-v2`) onto `cursor/product-gate`; one root lockfile, single `@x402/*` 2.30.0 and `@hiero-ledger/sdk` 2.90.1.
- `apps/agent`: `review` (autonomous buyer: ShipLock job → `createReviewPurchaser` within the cap → paid-review submission, per-job payment ledger written before send, never re-pays signed/uncertain/paid-unfulfilled) and `merchant` (`createAuditMerchant` + scanner auditor).
- Mirror check now requires the payer's net debit to equal the price exactly (Hermes review note). `adapterId` accepts `/` and `@`.
- Live: PR #1 accepted (`paid_review_confirmed`), PR #2 accepted and blocked (`review_blocked`); see [Gate C payment](evidence/integration/gate-c-payment.md).
- Tests: shared 12, scanner 9, github 11, policy 11, x402 61, agent 11, api 73.

### Cursor — `cursor/product-gate` — World IDKit pivot, maintainer auth, paid-review acceptance, merge gate

- Pivot from Agent Pass OIDC to **World IDKit 4.6.0** (Proof of Human, user presence where supported). Sponsor target: ETHGlobal Mumbai "Best Use of IDKit" (requirements recorded in `docs/IMPLEMENTATION_BRIEF.md`).
- `packages/policy`: merge operation `v2` binds GitHub approver id/login, World environment and rp_id, paid-review evidence kind.
- `packages/github`: collaborator permission, check runs, combined status, branch rules, SHA-guarded merge (`409` ⇒ head changed; timeout/5xx ⇒ outcome unknown).
- `apps/api`: migration `002` (GitHub OAuth states, sessions, World enrollments, proof requests, session nullifiers; Agent Pass tables retired and open Agent Pass authorizations invalidated); GitHub OAuth sign-in + sessions + CSRF; World enrollment and exact-operation approval verified with World `/api/v4/verify/{rp_id}`; deny/cancel; paid-review acceptance with independent mirror-node check; merge executor with live pre-merge checks and reconcile. Unconfigured integrations return 503. Dev helper `simulate-paid-review` (simulated evidence, never mergeable).
- `apps/web`: maintainer page (GitHub sign-in, World enrollment via `IDKitRequestWidget`), human checkpoint on the review page (`IDKitSessionWidget` over the operation hash, deny, merge, reconcile), session bar; staging labeled as simulator proof.
- Tests (unit; World verify, mirror node and GitHub stubbed — **not live evidence**): shared 10, scanner 9, github 11, policy 10, api 73 = 113 passing. `pnpm typecheck` and `pnpm build:web` pass. Local smoke: API + web with integrations unconfigured return 503 / `no_session` through the web proxy.
- Not run live: GitHub OAuth, World verify (staging or production), mirror-node lookup, any GitHub write.

### Cursor — `cursor/product-gate` — app foundation + start of M2

- pnpm workspace: `apps/api` (Hono + `node:sqlite`), `apps/web` (Next.js 16 + Tailwind 4), `packages/{shared,scanner,github,policy}`. Versions pinned to match Hermes's `packages/x402` (TypeScript 7.0.2, Vitest 5.1.0, Hono 4.13.16).
- `packages/shared`: contract update (see `docs/COORDINATION.md` handoff), Zod schemas, canonical JSON + SHA-256, release state machine.
- `packages/scanner`: deterministic diff scanner `shiplock-deterministic/0.1.0` (credentials, CI workflow, dependency manifests, process execution, sensitive paths, binary/inconclusive). Never executes PR code.
- `packages/github`: allowlisted read client (repo, PR, `compare/{base}...{head}` diff with byte cap, `redirect: "error"`).
- `packages/policy`: `verifyPaidReviewResult` and `computeOperationHash`.
- `apps/api`: schema `001_init.sql` (repositories, PRs, review jobs, findings, payment receipts, World identities, approver links, sessions, merge authorizations, World auth attempts, merge attempts, audit events), `POST /api/reviews` (agent bearer token), `GET /api/pull-requests`, `GET /api/reviews/:id`, `pnpm analyze owner/repo#N`.
- `apps/web`: dashboard and PR detail (exact SHA binding, findings, paid review / checkpoint / merge panels with evidence labels, timeline).
- Tests: 49 passing. See evidence §1.
- Deferred: shadcn/ui is added when interactive approval components are needed; the current screens use Tailwind only.
