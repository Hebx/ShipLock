# M0 — Hedera x402 source audit and SDK decision

Checked 2026-11-07 against live GitHub, npm and the Hedera testnet mirror node. Long-form notes with file:line references:

- [`docs/internal/research-carpool-autovoyage.md`](internal/research-carpool-autovoyage.md)
- [`docs/internal/research-turnstile-hederadev-hedron.md`](internal/research-turnstile-hederadev-hedron.md)

## Comparison matrix

| Source | Commit / version | Files inspected | Live settlement (verified by us on mirror) | License | Reuse decision | Risks / incompatibilities |
|---|---|---|---|---|---|---|
| x402-foundation/x402 (npm) | `@x402/core`, `@x402/fetch`, `@x402/hedera` **2.30.0** (published 2026-11-04); `@hiero-ledger/sdk` 2.90.1 (pinned exactly by `@x402/hedera`) | installed `dist/esm`: `createClientHederaSigner`, client/server/facilitator `ExactHederaScheme`, `x402Client` spend controls + policies + hooks, `x402ResourceServer.settleWithPendingRetry`, `HTTPFacilitatorClient` | n/a (library); **our own live tx below** | Apache-2.0 | **Use as-is**: buyer signing, 402 encoding, facilitator client | Client signer signs whatever requirements it gets, so ShipLock policy must run before signing. Spend-control default "$1" applies only to USD default assets; HBAR needs an explicit `allowedAssets` cap. Core retries `/settle` once on a *pending* result with the same signed bytes (safe: Hedera dedupes by tx id). |
| Carpool | `060c4662a9985625f6f071c069bb6ca4d37a4677` | `packages/hedera-x402/src/gate.ts`, `apps/mcp/src/pay.ts`, `apps/bench/src/agent.ts`, `docs/AUDIT-MOCKS.md` | Yes: 2 USDC txs SUCCESS via Blocky402 | MIT | Patterns: immutable quote, `wrapFetchWithPayment` + spend controls, `PAYMENT-RESPONSE` decode | `@x402/*` 2.25.0 pinned `@hiero-ledger/sdk` 2.85.0 while app wanted ^2.88, giving two `PrivateKey` classes. Permissive mock facilitator accepted wrong-token payloads. USDC/escrow complexity not needed. |
| AutoVoyage | `043a2580ad266c3566218c7db12ea8841c8e19f9` | `facilitator/src/server.ts`, `RUNBOOK.md`, `AGENTS.md`, `packages/frontend/services/x402/agentBuyer.ts` | Yes: 3 × 0.3 HBAR txs SUCCESS (incl. HIP-336 approved transfer) | MIT (inherited BuidlGuidl) | Lesson only: tx-id owner vs allowance spender | Self-hosted facilitator on 2.13.2; mixes x402 2.13/2.14/2.25 in one repo. Allowance mode fails with `SPENDER_DOES_NOT_HAVE_ALLOWANCE` when facilitator owns tx id, so hosted Blocky402 = treasury mode only. 30s facilitator timeout was too short on testnet (we use 120s). |
| Turnstile | `8f6249a` | agent payment flow, paid analytics API, HCS receipts | Yes: `0.0.7162784-1788791855-758948636` SUCCESS; HCS topic `0.0.10408013` | MIT in `package.json`, **no LICENSE file** | Patterns only (HCS hash receipts for M6) | Replay guard in memory only; resource binding advisory. |
| hedera-dev/x402-inference-pay-per-request-poc | `a56ad60` | `packages/service/src/x402.ts`, `packages/agent/src/x402-client.ts` | **Unverified**: no tx ids in repo | **None** | Read-only reference | 2.18-era pins; defaults mainnet to `api.blocky402.com`; agent server holds keys behind open CORS. |
| Glorian-Labs/Hedron PR #11 / #12 | #11 merged `894d5b9`; #12 open (docs) | `src/settlement/x402/*`, `docs/X402_ADAPTER.md` | **Unverified**: no tx id recorded | (repo license) | Security lessons: `freezeWith`, fee payer from `/supported`, quote checks, never auto-resettle, mainnet/testnet host pitfall | Hand-rolled wire types on 2.20; in-memory replay set; not wired into Broker+HCS. |
| World IDKit 4.6.0 (replaces Agent Pass OIDC; Agent Pass registration blocked by account eligibility) | `@worldcoin/idkit-core` / `@worldcoin/idkit` 4.6.0 | Cursor lane | not yet run live | n/a | Cursor owns (M3) | Hermes reviews in M5 |

## Facilitator capability (verified, not assumed)

`GET https://api.testnet.blocky402.com/supported` (2026-11-07):

```json
{ "x402Version": 2, "scheme": "exact", "network": "hedera:testnet", "extra": { "feePayer": "0.0.7162784" } }
"signers": { "hedera:*": ["0.0.7162784"] }
```

`resolveHederaCapability()` requires all of: v2, `exact`, exact `hedera:testnet`, a `0.0.x` `extra.feePayer`, and that fee payer listed in `signers["hedera:*"]`. The merchant refuses to boot otherwise; the buyer only signs requirements whose `extra.feePayer` equals it. `https://x402.org/facilitator` also advertises `hedera:testnet` (fee payer `0.0.9185802`): viable fallback, not exercised.

## SDK decision

Pin **`@x402/core@2.30.0`, `@x402/fetch@2.30.0`, `@x402/hedera@2.30.0`, `@hiero-ledger/sdk@2.90.1`** (exact).

- 2.30.0 is current npm `latest`. `@x402/hedera@2.30.0` depends on `@hiero-ledger/sdk` **2.90.1 exactly**; we pin the same, so pnpm installs one SDK instance (no Carpool-style duplicate `PrivateKey`). `PrivateKey` is imported from `@x402/hedera`'s re-export.
- Carpool proved Blocky402 on 2.25.0; we proved Blocky402 on **2.30.0** ourselves (live tx below).
- Scheme: ordinary exact `cryptoTransfer`, native HBAR `asset: "0.0.0"`, integer tinybar. No `transferExecutor` (PR #4030 unmerged), no `upto`.
- Native HBAR passes 2.30 spend controls via `allowedAssets: [{ network, asset: "0.0.0", maxAmountPerPayment }]` (open question in the Carpool notes, answered by the live run).

## Answers to the required questions

1. **Versions/imports/CAIP-2**: above. `hedera:testnet`, `@x402/hedera/exact/{client,server}`, `@x402/fetch` `wrapFetchWithPayment`.
2. **Facilitator**: Blocky402 testnet, fee payer `0.0.7162784`, verified in the `/supported` body and signers.
3. **`PAYMENT-RESPONSE`**: base64 JSON `{ success, transaction: "0.0.7162784@<secs>.<nanos>", network, amount }`. The tx id payer is the facilitator (fee payer), not our agent. Confirm via mirror `/api/v1/transactions/0.0.7162784-<secs>-<nanos>` and HashScan.
4. **Replay / uncertainty / restart**: SQLite (`node:sqlite`) quotes/payments/fulfillments with UNIQUE(tx_id) and UNIQUE(quote_id); uncertain outcomes reconciled on the mirror; failure declared only after Hedera's 180s validity window. See `packages/x402/README.md`.
5. **World test mode**: Cursor's lane (M3).
6. **GitHub permissions**: Cursor's lane (M4); reviewed by Hermes in M5.

## Live proof (M1)

`0.0.7162784@1794012935.145851264`: SUCCESS, payer `0.0.7304745` −1000 tinybar, merchant `0.0.9050506` +1000, fee payer paid the 296,290 tinybar network fee. Evidence: [`docs/evidence/payment/M1.md`](evidence/payment/M1.md).
