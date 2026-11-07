# Milestone progress (source of truth)

| Milestone | State | Owner | Branch/commit | Proof | Blockers |
|---|---|---|---|---|---|
| M0 research | Verified | Hermes | `hermes/hedera-x402` | [RESEARCH_NOTES](RESEARCH_NOTES.md) | — |
| App foundation (DB, schemas, state machine, API, UI) | In progress — foundation tests pass | Cursor | `cursor/product-gate` | [app-foundation.md](evidence/app-foundation.md) §1 | — |
| M1 paid x402 | Verified (payment subsystem, live testnet); app integration pending | Hermes | `hermes/hedera-x402` (PR #1) | [M1 evidence](evidence/payment/M1.md), tx `0.0.7162784@1794012935.145851264` | Adapter must emit Cursor's v2 `PaidReviewResult` (in progress: `hermes/x402-contract-v2`) |
| M2 SHA-bound audit | In progress — scanner + SHA binding implemented; live read smoke only | Cursor | `cursor/product-gate` | [app-foundation.md](evidence/app-foundation.md) §2 (not M2 exit) | Disposable `Hebx/shiplock-demo-target` repo does not exist yet |
| M3 World ID (IDKit) + GitHub maintainer | In progress — implemented, unit-tested only (stubbed World verify); never run against World | Cursor | `cursor/product-gate` | runbook: [world/README.md](evidence/world/README.md) (no evidence yet) | World Developer Portal app values (`app_id`, `rp_id`, signing key) + staging action; GitHub OAuth App; cross-agent security review |
| M4 GitHub merge | In progress — executor implemented, unit-tested against in-memory GitHub; no real merge | Cursor | `cursor/product-gate` | — | Demo repo + fine-grained token; live paid review (M1); cross-agent security review |
| M5 evidence/demo | Not started | Joint | — | — | M1–M4 |
| M6 optional | Not started | Joint | — | — | — |

Update this file whenever a milestone changes state. Use `Not started`, `In progress`, `Blocked`, or `Verified` with evidence URL.

## Change log

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
