# ShipLock

**AI writes. Humans ship.**

Agent-paid independent code review, World Agent Pass release authorization, and a SHA-exact GitHub merge gate.

ShipLock is a research-first ETHGlobal Mumbai 2026 prototype for securing the handoff from agent-authored pull requests to human-authorized GitHub merges.

An autonomous agent buys a *real* code-audit API response using Hedera x402; the report is tied to a particular GitHub pull-request head SHA. A maintainer completes official **World ID Agent Pass** authentication and separately approves **that exact SHA**. The server rechecks the PR and asks GitHub to merge only if the head has not changed. Changed SHA, expired authentication, denial, failed review, or replay = no merge.

> **Repository status:** Documentation and pitch assets only. No application, payments, OIDC integration, or merges are implemented yet. Avoid declaring the milestones done until verifiable evidence is collected.

## Read this first

1. [AGENTS.md](AGENTS.md) — universal operating instructions for Cursor, Hermes, and other coding agents.
2. [docs/MILESTONES.md](docs/MILESTONES.md) — proof-gated milestones, no fixed timeline.
3. [docs/RESEARCH_SOURCES.md](docs/RESEARCH_SOURCES.md) — source-code audit of recent Hedera x402 winners and official SDK, **before implementation**.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — service boundaries, data model and happy/negative paths.
5. [docs/SECURITY.md](docs/SECURITY.md) — immutable approval, wallet, OIDC, replay and PR-race invariants.
6. [docs/COORDINATION.md](docs/COORDINATION.md) — Hermes/Cursor task split and handoff convention.
7. [docs/SETUP.md](docs/SETUP.md) — required testnet accounts, GitHub and World OIDC details.
8. [docs/USER_STORIES.md](docs/USER_STORIES.md) — user narrative and acceptance tests.

## Milestone outcome

| Milestone | Objective | Required evidence |
|---|---|---|
| M0 | Inspect latest official SDK + winning repos | Source/commit/license matrix and chosen APIs |
| M1 | Autonomous Hedera x402 paid audit request | Standard 402, signed paid retry, **real HashScan tx** |
| M2 | Audit a particular GitHub revision | Rule findings and digest linked to `owner/repo#PR@SHA` |
| M3 | World Agent Pass step-up and explicit consent | Backend-validated OIDC + cancellation/denial |
| M4 | SHA-guarded GitHub merge | Approved SHA merges; changed SHA blocked |
| M5 | Reproducible hackathon evidence | Clear live vs staged matrix, tests, demo and debrief |
| M6 | Optional extensions | HCS receipts, required GitHub checks, independent vendors |

## Core sponsor separation

- **Hedera x402:** an autonomous agent buys a useful paid review *without human approval*. A direct HBAR transfer or mocked facilitator is not equivalent to x402.
- **World Agent Pass:** a maintainer uses official World OIDC and then **explicitly** approves a sensitive merge. An ID token is authentication, not consent. Demo a refused/expired/cancelled attempt that leaves the PR unmerged.
- The paid review and the protected merge are **different actions**.

## Testnet wallets and permissions

You can reuse existing **funded ECDSA Hedera testnet** accounts from Hedron if their private keys remain secure. Roles: (A) buyer/agent payer, (B) audit API merchant `payTo`, (C) optional HCS operator. The facilitator is hosted separately and does not require a fourth personal account when using a supported hosted facilitator. Details in [SETUP](docs/SETUP.md).

## Repo ownership / demo safety

Use this repo for product code. Create **a second disposable GitHub repository** to demonstrate the agent's merge powers. Never grant a demo bot access to a production repository. Do not commit `.env`, private keys, World client secrets, tokens, tokens from OIDC callbacks, or real customer source code.

## Research provenance

The first implementation should be based on **installed, pinned compatible x402 packages and verified winner code**, not Hedron alone. Hedron is a tested settlement/security reference, not the most current full-stack x402 web app. Read [RESEARCH_SOURCES](docs/RESEARCH_SOURCES.md).

## Current deliverables

Docs and pitch assets under `docs/` and `pitch/`. Implementation files are intentionally absent until M0 research produces a compatibility decision.

## For both coding agents

**Cursor is the integration owner; Hermes is the payments/research owner.** Read `docs/WORKSTREAMS.md`, then open `prompts/CURSOR_START.md` or `prompts/HERMES_START.md`. Both agents should work on separate feature branches or git worktrees, commit their own changes, and never mutate `main` directly.

## Start the agents

Copy the contents of [`prompts/CURSOR_START.md`](prompts/CURSOR_START.md) into Cursor and [`prompts/HERMES_START.md`](prompts/HERMES_START.md) into Hermes. Human prerequisites are in [`docs/OWNER_SETUP.md`](docs/OWNER_SETUP.md).
