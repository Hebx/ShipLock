# Milestone progress (source of truth)

| Milestone | State | Owner | Branch/commit | Proof | Blockers |
|---|---|---|---|---|---|
| M0 research | Not started | Hermes | — | — | — |
| App foundation (DB, schemas, state machine, API, UI) | In progress — foundation tests pass | Cursor | `cursor/product-gate` | [app-foundation.md](evidence/app-foundation.md) §1 | — |
| M1 paid x402 | Not started | Hermes | — | — | — |
| M2 SHA-bound audit | In progress — scanner + SHA binding implemented; live read smoke only | Cursor | `cursor/product-gate` | [app-foundation.md](evidence/app-foundation.md) §2 (not M2 exit) | Disposable `Hebx/shiplock-demo-target` repo does not exist yet |
| M3 Agent Pass | Not started | Cursor | — | — | World client registration (sandbox or production) |
| M4 GitHub merge | Not started | Cursor | — | — | Demo repo + fine-grained token scoped to it |
| M5 evidence/demo | Not started | Joint | — | — | M1–M4 |
| M6 optional | Not started | Joint | — | — | — |

Update this file whenever a milestone changes state. Use `Not started`, `In progress`, `Blocked`, or `Verified` with evidence URL.

## Change log

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
