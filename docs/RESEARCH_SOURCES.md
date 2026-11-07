# M0 — Proven Hedera x402 implementations to inspect

**Do not treat Hedron as the latest complete end-to-end app.** Inspect current SDK source + **actual winners' implementation**. Store results with commit SHA, package versions and license in `docs/RESEARCH_NOTES.md`. A README statement or passing mock tests is not proof of live settlement.

## Priority A: official spec, installed packages and hosted facilitator

- https://github.com/x402-foundation/x402 — `typescript/packages/mechanisms/hedera/` exact **client**, **server**, **facilitator**; `@x402/core`, `@x402/fetch`, middleware. Inspect installed exports and latest compatible releases (the early November 2026 npm listing was 2.30.0; verify before pinning).
- https://github.com/x402-foundation/x402/pull/3205 — merged `transferExecutor` spec; https://github.com/x402-foundation/x402/pull/4030 — implementation was open on November 7, 2026. **Use ordinary exact `cryptoTransfer`, not unmerged experimental execution.**
- https://docs.hedera.com/solutions/ai/x402 — canonical Hedera x402 docs. Ask chosen facilitator `/supported` for `hedera:testnet`, exact HBAR, fee-payer and method; don't infer from HTTP 200 alone.

## Priority B: ETHOnline 2026 winning builds

1. **Carpool** — https://github.com/RomarioKavin1/carpool
   - `packages/hedera-x402/src/gate.ts` quote preservation, paid retry, durable fulfillment, settlement semantics.
   - `apps/mcp/src/pay.ts`, `apps/bench/src/agent.ts` x402 buyer, signer, `wrapFetchWithPayment`, `PAYMENT-RESPONSE`, spend cap.
   - `docs/AUDIT-MOCKS.md` specifically shows overly permissive fake facilitators and real-transaction test gaps. It warns about duplicate `@hiero-ledger/sdk` / `@x402/hedera` `PrivateKey` versions.
   - Uses USDC paths and other sophistication; **adapt simple HBAR path** rather than copying escrow/refund complexity.
2. **AutoVoyage** — https://github.com/SyuraMoons/ETHOnline-AutonomousTravelAgent
   - `facilitator/src/server.ts`: self-hosted `@x402/hedera/exact/facilitator` with `/supported`, `/verify`, `/settle`.
   - `RUNBOOK.md` and `AGENTS.md`: account IDs, transaction-ID owner versus allowance spender issue, treasury vs allowance modes.
   - Prefer hosted facilitator for MVP; learn the transaction and receipt flow.
3. **Turnstile** — https://github.com/IpastorSan/turnstile
   - Inspect agent discovery, paid analytics API, evidence receipt, HCS logging. Confirm implementation files and whether payments genuinely settle, rather than copying abstract architecture.

## Priority C: smaller developer reference

- https://github.com/hedera-dev/x402-inference-pay-per-request-poc
  - `packages/service/src/x402.ts`: `x402ResourceServer`, `HTTPFacilitatorClient`, server `ExactHederaScheme`.
  - `packages/agent/src/x402-client.ts`: `createClientHederaSigner`, `wrapFetchWithPayment`, buyer state.
  - Reference pins older `@x402` 2.18-era packages. Do **not** blindly use old imports against latest distribution.

## Priority D: other awarded code patterns

- https://github.com/hitakshiA/pinout — usage-based paid sessions and receipts.
- https://github.com/Madhav-Gupta-28/Tally — budget caps and receipts.
- https://github.com/farouk-allani/qisma — grouped settlement patterns (not needed in v1).
- https://github.com/Glorian-Labs/Hedron/pull/11 — quote trust, network mismatch, fee-payer, replay, receipt and live probe lessons.
- https://github.com/Glorian-Labs/Hedron/pull/12 — explicit current limitation of standalone x402 vs integrated Broker+HCS.

## Identity and merge gate

- https://auth.world.org/docs/guides/oidc
- https://auth.world.org/docs/guides/step-up
- https://auth.world.org/docs/guides/testing
- https://docs.github.com/en/rest/pulls/pulls — merge API exact `sha` requirement.

## Mandatory M0 evidence table

| Repo / document | Commit or version checked | File(s) and functions | Live testnet proof vs mock | License | Use / avoid | Notes |
|---|---|---|---|---|---|---|
| x402-foundation/x402 | TBD | TBD | TBD | TBD | TBD | TBD |
| Carpool | TBD | TBD | TBD | TBD | TBD | TBD |
| AutoVoyage | TBD | TBD | TBD | TBD | TBD | TBD |
| Turnstile | TBD | TBD | TBD | TBD | TBD | TBD |
| Hedera dev ref | TBD | TBD | TBD | TBD | TBD | TBD |
| Hedron | TBD | TBD | TBD | TBD | TBD | TBD |

Do not assert third-party code is production secure simply because it won a prize. Use it as inspiration, understand its risk model, and implement ShipLock-specific safeguards.
