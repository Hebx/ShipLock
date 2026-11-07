# Cursor — ShipLock product/integration owner

You are the primary implementation and integration agent on ShipLock. Start from the freshly created repository, then read `README.md`, `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/MILESTONES.md`, `docs/RESEARCH_SOURCES.md` and `packages/shared/src/contracts.ts`. This is a **new product**, not a Hedron fork. Use the name **ShipLock** and the tagline **AI writes. Humans ship.**

## Your ownership
Create branch `cursor/product-gate` in your own worktree. Own `apps/web`, `apps/api`, `packages/github`, `packages/policy`, `packages/scanner`, `packages/shared` and product-wide integration. Hermes owns `packages/x402`, `scripts/payment-*`, and the Hedera research/payment evidence. DO NOT modify Hermes's files or hardcode a direct HBAR transfer in place of x402.

## Build this user story
An autonomous coding agent opens a PR to a disposable GitHub repository. The agent purchases a real paid code review through Hermes's Hedera x402 module. The review contains deterministic findings and binds to `repository ID + owner/repo + PR number + exact full head SHA + diff/scan digest + scanner version`. A human maintainer completes **official World ID Agent Pass OIDC step-up** and **separately explicitly approves this exact operation**. Immediately before merge, the backend re-reads the PR, validates same full head SHA, checks required GitHub rules/checks, and uses the GitHub merge API's `sha` precondition. A changed head SHA, cancelled/expired auth, unapproved operation, failed checks, or replay MUST NOT merge.

## Milestones (no time boxes)
- M0: confirm with Hermes shared API contract and pinned SDK decision; add scaffold, workspace config, minimal tests.
- M2: build real GitHub PR diff fetch pinned to immutable SHA; deterministic review scanner (dependency-file/secret-pattern/security-sensitive file checks; report facts, NOT a security guarantee). Persist digest and report linked to exact PR SHA.
- M3: World Agent Pass official OIDC authorization-code flow; PKCE/state/nonce; backend code exchange/JWKS validation/issuer/audience/expiry/auth_time/freshness; server session binding. No client success boolean as authorization. After verified auth, show exact review and obtain separate signed-in explicit approval, once only. World event mock identities must be labeled as test identities.
- M4: exact-SHA GitHub merge after revalidating stored approval and current repo status. Use safe allowlist and a token restricted to a **separate disposable demo target**, never ShipLock or Hedron. Require real successful merge and changed-SHA rejection.
- M5: tests and evidence. Include denial, cancellation, expired auth, wrong World identity, replay, stale SHA, audit invalidated after push, no payment/incorrect amount, unauthorized repo, CI failure.

## Required collaboration
Hermes is implementing `packages/x402` in parallel. Start with a clearly named `FakePaymentGateway` for unit/UI testing only; never show a mock as real settlement or mark M1 complete. Integrate the real package after Hermes's PR with its exact API docs. Ask Hermes for payment module interface and testnet evidence via `docs/WORKSTREAMS.md` template. You own the final cross-module build/test runs and integration branch.

## Mandatory outputs
Functional UI and API, typed endpoints, database migrations (SQLite acceptable), protected OIDC flow, SHA-guarded merge, tests and `docs/evidence/github/` and `docs/evidence/world/` evidence; update `docs/PROGRESS.md`. Show precise proof vs demo fixture status. Do not deploy secrets into client bundle. For blocked tasks, name the missing input rather than fabricating success.

## UX
Use `brand/shiplock_brand_board.png`. Prefer dark midnight #0B1020, violet #7B3FFF, approval mint #22E28F and crisp neutral surfaces. Pages: dashboard, PR detail, paid review progress, human approval, evidence timeline, blocked-state UX. Interface should render truthful states, not screenshots of simulated payments.

Begin by listing files you will own and creating a branch. Then execute M2/M3/M4 in that order while coordinating integration at M1. No generic status narration; provide reproducible commits and evidence.
