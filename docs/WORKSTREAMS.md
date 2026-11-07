# ShipLock — two-agent execution agreement

## Why two agents
One shared repository, separate worktrees/branches, clear file ownership and a single integration owner. Parallelize the independent payment stack and GitHub/World product stack; **never let two agents commit to the same branch** or rewrite each other's files.

## Ownership
| Agent | Branch | Owns | Must not edit until coordinated |
|---|---|---|---|
| Hermes | `hermes/hedera-x402` | `packages/x402/**`, `scripts/payment-**`, `docs/RESEARCH_NOTES.md`, `docs/evidence/payment/**` | `apps/web/**`, `apps/api/**`, World auth, GitHub merge |
| Cursor | `cursor/product-gate` | `apps/**`, `packages/scanner/**`, `packages/policy/**`, `packages/github/**`, `packages/shared/**` and general UI | `packages/x402/**`, payment smoke scripts |
| Human | `main` | merge approvals, secrets/config, GitHub demo repo, World client, review evidence | no copy/paste of keys into chat |

**Shared type source:** `packages/shared/src/contracts.ts` exists as a minimal contract. Cursor owns subsequent edits. Hermes requests changes through a message or PR rather than changing it unilaterally. Both agents can commit tests within their owned paths. Hermes's payment package must import the shared contracts only when monorepo wiring is ready; do not block x402 live probe on UI scaffolding.

## Branch sequence
1. Human initializes `ShipLock` repo and pushes this documentation package as the initial commit.
2. Each agent creates its own branch or worktree *after that commit*. E.g. `git worktree add ../shiplock-hermes -b hermes/hedera-x402`, and `git worktree add ../shiplock-cursor -b cursor/product-gate`.
3. Hermes writes research compatibility decision and publishes a payment module contract. Cursor proceeds with app/safety checks against a clearly marked local fake adapter only for unit and frontend work.
4. Hermes proves real Hedera x402 on testnet and opens a PR. Cursor merges/rebases that feature (or human approves) and removes any fake adapter from the integrated happy path.
5. Before final signoff, Hermes adversarially reviews Cursor's OIDC + SHA-guarded merge logic; Cursor reviews payment integration/evidence.
6. Any integration conflict is resolved by Cursor on `release/v0.1` (renamed from `cursor/integration`), not parallel edits to main.

## Milestone gate
M0 winner research → M1 real x402 payment → M2 commit-bound review → M3 official Agent Pass auth + explicit approval → M4 real SHA-guarded demo-repo merge → M5 failure proofs and demo. These are **evidence gates, not durations**.

## Handoff message format
```text
AGENT / BRANCH / COMMIT:
MILESTONE:
FILES CHANGED:
API/TYPE CONTRACT:
TEST COMMANDS + RESULTS:
REAL vs MOCK EVIDENCE:
ENV NAMES (NO VALUES):
RISKS / BLOCKERS:
WHAT THE OTHER AGENT NEEDS:
```

Do not place an LLM-generated "safe" badge in place of an auditable scan or claim World authentication alone equals merge approval.
