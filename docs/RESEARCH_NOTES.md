# M0 — Source audit (not yet performed by coding agent)

The starter package includes **preliminary** reading links in `docs/RESEARCH_SOURCES.md`; this file must be completed against live GitHub/npm by Hermes or Cursor before beginning implementation.

| Source | Commit/SDK version | Files and real imports verified | Integration actually executed? | License | Reuse decision | Risks |
|---|---|---|---|---|---|---|
| x402-foundation/x402 | TBD | TBD | TBD | TBD | TBD | TBD |
| Carpool | TBD | TBD | TBD | TBD | TBD | TBD |
| AutoVoyage | TBD | TBD | TBD | TBD | TBD | TBD |
| Turnstile | TBD | TBD | TBD | TBD | TBD | TBD |
| hedera-dev/x402-inference-pay-per-request-poc | TBD | TBD | TBD | TBD | TBD | TBD |
| Glorian-Labs/Hedron | TBD | TBD | TBD | TBD | patterns only | not full end-to-end app |
| World ID Agent Pass OIDC | TBD | TBD | TBD | TBD | official integration | credentials required |

## Questions that must be answered with evidence

1. Which current pinned `@x402/*` versions, imports and CAIP-2 identifiers work together with current `@hiero-ledger/sdk`?
2. Which testnet facilitator advertises Hedera HBAR exact and what are its actual `/supported` fields and fee-payer rules?
3. What does the paid `PAYMENT-RESPONSE` really return and how can we confirm a transaction on HashScan?
4. How are signed payload replays, uncertain settlements, HTTP retries, and fulfillment crash/restart handled?
5. Does the World event development/test mode return an authentically validated OIDC token and support canceled/expired flow tests?
6. What GitHub permissions, required checks and branch rules are needed for safe SHA-guarded merge in the demo repo?
