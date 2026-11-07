# AGENTS.md — ShipLock coding agent contract

Applies to **Cursor**, **Hermes**, and any other agents operating in this repository. Before editing, read `README.md`, `docs/MILESTONES.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/RESEARCH_SOURCES.md`, and `docs/COORDINATION.md`.

## Hard objectives

1. Build a distinct GitHub PR audit product, not a clone/fork of Hedron or an existing winner.
2. Prove **standard x402 v2** on Hedera testnet end-to-end: HTTP 402 → signed payload → `/verify` → `/settle` → paid audit response → real transaction evidence. The buyer acts *autonomously* within a configured spend cap.
3. Use official **World IDKit 4.x** with server-side verification (`POST /api/v4/verify/{rp_id}`) for every proof. A World ID proof establishes a unique human only: merge authority additionally requires a GitHub-authenticated maintainer with live repository write permission, and a separate, one-use World ID approval whose signal is the exact operation hash, from the World session enrolled to that maintainer. Never treat a client callback, widget `onSuccess` or client-reported `success:true` as consent. RP signatures are created server-side only.
4. Bind scanner outcome and human approval to repo, PR, current head SHA, review content digest, action, identity and expiry. GitHub merge request must include expected SHA and must reject changes.
5. Demo one successful merge plus at least one changed-SHA and one cancelled/rejected World ID approval with no merge. Label World staging/simulator proofs as development proofs, never as real human verification.

## Required research first

Research `x402-foundation/x402` and the code (not only README) in Carpool, AutoVoyage, Turnstile, Hedera reference, and Hedron. Record checked commit SHAs, APIs, pinned SDK versions, what actually ran on live testnet, licenses and known failures in `docs/RESEARCH_NOTES.md`. **No claims of live evidence without transaction/response proof**.

## Implementation conventions

- TypeScript end-to-end; Next.js frontend + small Node/Hono or Express server as necessary. Deterministic scanner rules first, LLM summary optional.
- Exact fixed-price HBAR `cryptoTransfer` on `hedera:testnet`; do not depend on experimental `transferExecutor` or `upto` while delivering the MVP.
- Use hosted testnet facilitator if `/supported` advertises your network/asset; fail closed if mismatched. Network fees and facilitator may have service limits.
- ECDSA private key required for the tested x402 signer path. Confirm exports against pinned installed packages; avoid mixed SDK instances/types.
- Don’t recompute quote price/payee on paid retry. Idempotent payments and audit fulfillment; uncertain settlement != definite failure; never blindly resettle.
- Secrets server-side, strict allowlist to a **disposable demo GitHub repo**, least privilege, no admin bypasses.
- Audit service must analyze bytes from the exact SHA and produce real findings; never call heuristic scanning a security certification.
- Pin package versions together, run build/typecheck/tests and live probes. Mock tests are unit tests only and are not live integration evidence.

## Milestone rules

A milestone is DONE only when its evidence exists under `docs/evidence/` and its entry in `docs/PROGRESS.md` links to the evidence. Report `not started / in progress / blocked / verified` truthfully. Never skip tests for the negative paths.

## Coordination / branch boundaries

- **Hermes: integration/research** — official SDK and winner audit, payment spike, CI evidence, help review security invariants.
- **Cursor: app/features** — workflow, backend/frontend, scanner, GitHub merge integration; pair with Hermes for shared contracts.
- Prefer separate branches and PRs, one integration feature at a time. Use `docs/COORDINATION.md` handoff template. No simultaneous edits to shared contracts without explicit ownership.
- Whoever touches GitHub merge authorization must get a second-agent review of `docs/SECURITY.md` invariants before calling feature verified.
- Stop and report blockers rather than replacing real integrations with unlabeled stubs.
