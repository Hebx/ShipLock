# Research: Carpool + AutoVoyage (Hedera x402, ETHOnline 2026)

Source-code read only (shallow clones, nothing installed/run). Clones: `~/.hermes/profiles/dev/cache/scratch/research/{carpool,ETHOnline-AutonomousTravelAgent}`. Audit date 2026-11-07.

## Summary table

| | Carpool | AutoVoyage |
|---|---|---|
| Repo | github.com/RomarioKavin1/carpool | github.com/SyuraMoons/ETHOnline-AutonomousTravelAgent |
| HEAD | `060c4662a9985625f6f071c069bb6ca4d37a4677` (2026-09-14) | `043a2580ad266c3566218c7db12ea8841c8e19f9` (2026-09-13) |
| License | MIT, "Copyright (c) 2026 Carpool contributors" (`LICENSE`) | MIT, "Copyright (c) 2023 BuidlGuidl" (`LICENCE`, inherited Scaffold template) |
| Asset | Testnet USDC HTS token `0.0.429274` (6 dp) | Native HBAR, asset `"0.0.0"`, tinybars |
| Facilitator | Hosted Blocky402 `https://api.testnet.blocky402.com` (default in `apps/registry/src/config.ts:70`, `.env.example:3`) | Self-hosted (`facilitator/src/server.ts`, Railway); Blocky402 used for one qualifying proof run (treasury mode only) |
| Buyer lib | `@x402/fetch` `wrapFetchWithPayment` + `x402Client.fromConfig` spend controls | `@x402/core/client` `x402HTTPClient` manual quote()/pay() split |
| Live settlement verified by me | Yes (USDC, 2 txs) | Yes (HBAR, 3 txs incl. HIP-336 approved transfer) |

## Versions

Carpool (pnpm):
- package.json: `@x402/core|fetch|hedera|express` `^2.25.0` (`packages/hedera-x402/package.json:26-36`, `apps/mcp/package.json:26-27`, `apps/bench/package.json:18-20`); `@hiero-ledger/sdk` `^2.88.0` (registry, bench, carpool-core, hedera-x402).
- pnpm-lock resolved: `@x402/{core,express,extensions,fetch,hedera}@2.25.0`; `@hiero-ledger/sdk@2.85.0` AND `@2.88.0` (lock lines 587, 593). 2.85.0 is the exact pin inside `@x402/hedera@2.25.0` (npm registry deps: `@hiero-ledger/sdk: 2.85.0`, `@x402/core: ~2.25.0`). This is the duplicate-SDK source (see below).
- No `@hashgraph/sdk`.

AutoVoyage (npm):
- facilitator/package.json: `@x402/core ^2.14.0`, `@x402/hedera 2.13.2` (exact). facilitator/package-lock: core 2.14.0, hedera 2.13.2, `@hiero-ledger/sdk` 2.80.0.
- packages/frontend: `@x402/core ~2.14.0`, `@x402/hedera 2.13.2`, `@hiero-ledger/sdk ^2.80.0`; root package.json:78 overrides `@hiero-ledger/sdk` to `2.87.0`. Root lock: core 2.14.0, hedera 2.13.2, sdk 2.87.0.
- packages/supplier: `@x402/core ^2.14.0`, `@x402/hedera 2.25.0` → lock: nested `packages/supplier/node_modules/@x402/{core,hedera}@2.25.0`.
- So the repo runs two x402 generations at once (2.13/2.14 for facilitator + buyer, 2.25 for seller). No `@x402/fetch`. No `@hashgraph/sdk`.
- Current npm latest (checked): `@x402/fetch` 2.30.0, `@x402/hedera` 2.30.0 (pins `@hiero-ledger/sdk 2.90.1`, `@x402/core ~2.30.0`).

## Live settlement evidence (mirror node checked with curl)

Carpool:
- `0.0.7162784@1789202339.427560739` — `docs/evidence/v2-first-testnet-run/README.md:32`, `docs/FINAL-REVIEW.md:113`, mirror capture `08-mirror-purchase-tx.json`. **Verified**: CRYPTOTRANSFER SUCCESS, USDC `0.0.429274` −110000 from buyer `0.0.10477413`, +110000 to `0.0.10475802`; fee 1481541 tinybar paid by `0.0.7162784` (Blocky402 fee payer).
- `0.0.7162784@1789276127.843209072` — `docs/ETHGLOBAL-FORM.md:66` (HashScan link). **Verified**: SUCCESS, 4278 µUSDC `0.0.10477413` → `0.0.10513939`.
- Many more in `docs/evidence/v2-full-feature-run/*.json` (settlements, refunds, reconcile) — not individually checked.

AutoVoyage:
- `0.0.7162784@1789314270.640883616` — `README.md:27`, `AGENTS.md:104` (Blocky402, deployed supplier). **Verified**: SUCCESS, 30000000 tinybar (0.3 HBAR) `0.0.10286792` → `0.0.10440357`, fee 263182 by `0.0.7162784`.
- `0.0.7162784@1789203651.016492909` — `AGENTS.md:365` (Blocky402 CLI proof). **Verified**: SUCCESS, same 0.3 HBAR shape.
- `0.0.10440385@1789312290.086572549` — `README.md:28` (allowance mode via self-hosted facilitator). **Verified**: SUCCESS, `0.0.10286792` −0.3 HBAR with `is_approval: true`, agent `0.0.10440385` pays fee. Confirms their HIP-336 claim on chain.

Blocky402 `/supported` (curl today): hedera:testnet `extra.feePayer: "0.0.7162784"`, also eip155:80002 and solana devnet; hedera is listed third. No API key needed.

## Carpool

### Seller: `packages/hedera-x402/src/gate.ts`

Custom gate over `x402ResourceServer` + `HTTPFacilitatorClient` (not `@x402/express` middleware):
```ts
// gate.ts:123-127
this.facilitator = new HTTPFacilitatorClient({ url: opts.facilitatorUrl });
this.server = new x402ResourceServer(this.facilitator).register("hedera:*" as Network, new ExactHederaScheme({}));
```
- Quote preservation: issued requirements cached in an LRU (max 50k, TTL `DEFAULT_QUOTE_TTL_MS = 30_000`, gate.ts:19,128-131) keyed `${key}|${amount}|${payTo}` (gate.ts:76-77). Rationale (gate.ts:45-48): "re-quoting is exactly the bug that breaks real payments, since the facilitator compares payload.accepted.amount and .payTo to the requirements by strict equality."
- Paid retry: decodes `PAYMENT-SIGNATURE`, looks up the issued quote by `accepted.amount/payTo` (gate.ts:179-191); miss → fresh 402 with error "quote expired or not recognised" (gate.ts:218-224). Hit → `facilitator.verify(payload, replay.reqs)` then `facilitator.settle(...)` against the *cached* requirements (gate.ts:229-239), sets `PAYMENT-RESPONSE` (gate.ts:240).
- Settlement semantics: goods only after settle success. `GateOutcome.paid` carries `recorded` and `durable` flags (gate.ts:85-108); callers must branch on them, not on `kind`.
- Durable fulfillment: `onPaid` must be idempotent on txId (gate.ts:55-56). Settle success with empty txId skips `onPaid` and goes straight to `owe()` (gate.ts:260-269). `onPaid` throws → `deferred()` → `owe()` outbox; no outbox → loud `LEDGER WRITE LOST` log and `X-Payment-Record: deferred` header (gate.ts:283-299).
- Replay handling: idempotency is delegated to the ledger (unique index on `purchase.tx_id`, per comment gate.ts:254-259). The gate itself does not block re-submission of the same signature; the facilitator/Hedera duplicate-tx rejection is what stops a double settle (unverified in code here).
- Gap they documented (AUDIT-MOCKS §2.1): cache key omits asset/scheme/network, so those fields were trusted from the payload; fixed only in the stub's strictness, the gate still keys on 3 fields.
- Errors: facilitator init failure → 503; verify/settle throw → 502 (gate.ts:206-208, 249-251). Init promise cached and reset on failure (gate.ts:135-143).

### Buyer: `apps/mcp/src/pay.ts`, `apps/bench/src/agent.ts`

```ts
// pay.ts:6-8
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
// pay.ts:160-170
const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network });
const client = x402Client.fromConfig({
  schemes: [{ network: network as never, client: new ExactHederaScheme(signer) }],
  spendControls: { allowedAssets: [{ network: network as never, asset, maxAmountPerPayment: MAX_PER_PAYMENT }] },
});
const paidFetch = wrapFetchWithPayment(fetch, client);
```
- Spend cap: `wrapFetchWithPayment` in 2.25.0 takes 2 args, no `maxAmount` (agent.ts:27-29); cap is per-asset `spendControls.maxAmountPerPayment` in atomic units, string. Rejection is thrown client-side before any request (pay.ts:175-186). Default 500,000 µUSDC from `@carpool/core`.
- PAYMENT-RESPONSE decoding: header is base64 JSON, not an id; `decodePaymentResponseHeader(raw).transaction` (pay.ts:49-58, agent.ts:66-75). Earlier bug: they printed the raw header as the tx id.
- Pre-pay probe: plain `fetch(url)` to read `accepts[0].amount` (pay.ts:122-158) because the paid response carries no amount; non-402 status is surfaced as a seller-side failure with body excerpt.
- Integrity: sha256 of body vs manifest `bodyHash` fetched free before paying (pay.ts:105-115, 208-221). Three-state `Verification`.
- ECDSA only (`fromStringECDSA`); docs/RUNBOOK.md:14 notes ED25519 fails at signing.

### Duplicate `@hiero-ledger/sdk` PrivateKey issue

`@x402/hedera@2.25.0` pins `@hiero-ledger/sdk@2.85.0`; the app depends on `^2.88.0`, so pnpm installs both. A `PrivateKey` from the app's 2.88 copy is a different class from the one `createClientHederaSigner` expects (type clash; runtime `instanceof`-style checks may also fail — runtime failure unverified). Fix: import `PrivateKey` re-exported from `@x402/hedera` instead of `@hiero-ledger/sdk` (agent.ts:11-13 "avoids the dual @hiero-ledger/sdk type clash"; pay.ts:1-6; e2e.test.ts:25-27). Their own `docs/X402-RESEARCH.md:46` still shows the wrong import.

### `docs/AUDIT-MOCKS.md` — failures found with permissive mocks

27 doubles audited: 19 legit, 4 undocumented, 4 masking + 1 absence. Suite 828 → 862 tests.
1. Stub facilitator inspected nothing (§2.1): 4 hand-written copies returned `isValid/success: true` for anything, including `{signature:"stub"}`. Consequences: no check buyers produce a signed tx; no enforcement of `accepted ≡ requirements`; registry would serve goods for a payment in a token it doesn't accept (cache key ignores asset). Fix: one shared `stubFacilitator.ts` enforcing 5-field equality (`refuseReason`, :192) and `payload.transaction` base64 ≥64 bytes (`requireSignedTransaction`). Caught `reads.test.ts`/`delist.test.ts` sending payloads real facilitator refuses, and `audit-onpaid-throw.test.ts` sending `accepted` without scheme/network/asset.
2. MCP server unimportable (§2.2): `server.connect(StdioServerTransport)` at module scope → zero coverage of the 4 tool handlers, consent `confirm` gate, secret stripping. Fix: named exports + entry-point guard, 17 tests via `InMemoryTransport`. Mutants M9-M11 survived the old suite.
3. Fake `TransferTransaction` accepted lists HTS rejects (§2.3): non-zero-sum (`INVALID_ACCOUNT_AMOUNTS`) and >10 entries (`TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED`). Fix: `assertSubmittable`; mutant M4 (debit −total vs −moved) now caught.
4. Mirror stub tx-id notation (§2.4): stub used `0.0.9@111.222`; real mirror returns `0.0.x-sec-nanos`. `batch.tx_id` holds both notations depending on path; still open (§4.2).
5. Stub made payer == tx-id account (§2.5): with Blocky402 the tx id is `0.0.7162784@…` (fee payer) while payer is the buyer. Code deriving buyer from tx id would mis-attribute every purchase to the facilitator. Fix: distinct defaults + e2e assertion (mutant M3).
Open gaps: real ONNX embedder never tested; mirror stub serves 1 of 2 endpoints; multi-key accounts unexercised. Note: workspace deps resolve to `dist/`, so mutating `packages/*/src` needs `tsc` first.

## AutoVoyage

### Facilitator: `facilitator/src/server.ts` (154 lines, raw `node:http`)

```ts
// server.ts:84-95
const signer = toFacilitatorHederaSigner({
  getAddresses: () => [ADVERTISED_FEE_PAYER],
  signAndSubmitTransaction: createHederaSignAndSubmitTransaction(buildClient, FEE_PAYER_KEY),
  preflightTransfer: createHederaPreflightTransfer(buildClient),
});
const facilitator = new x402Facilitator().register(NETWORK, new ExactHederaScheme(signer, { aliasPolicy: "reject" }));
```
- Fee payer: `FACILITATOR_ACCOUNT_ID` / `FACILITATOR_PRIVATE_KEY` (ECDSA, required, server.ts:45-46) set as client operator (server.ts:78-82). `FACILITATOR_ADVERTISED_FEE_PAYER` (server.ts:72) overrides what `/supported` advertises.
- Endpoints: `GET /health` (mode treasury/allowance), `GET /supported` → `facilitator.getSupported()`, `POST /verify`, `POST /settle` → `facilitator.verify/settle(paymentPayload, paymentRequirements)` (server.ts:115-139). 500 with error message on throw.
- `aliasPolicy: "reject"`: payTo must be `0.0.x`, not an EVM alias (prevents fee-payer-funded auto account creation).
- Built on `@x402/hedera` 2.13.2 (pinned, see below).

### Transaction-ID owner vs allowance spender (RUNBOOK/AGENTS.md)

- `extra.feePayer` = "account that owns the transaction id", not just fee sponsor; scheme rejects mismatch (`invalid_exact_hedera_payload_fee_payer_mismatch`), so signer must use `TransactionId.generate(feePayer)` (AGENTS.md ~286-289).
- For HIP-336 approved HBAR transfers, tx-id owner MUST be the spender; facilitator-owned tx id → `SPENDER_DOES_NOT_HAVE_ALLOWANCE` at precheck (probe A); another account may still submit (probes D1/D2); over-spend → `AMOUNT_EXCEEDS_ALLOWANCE` (probe C) (AGENTS.md:315-323; scripts `packages/frontend/scripts/allowance-probe*.ts`, not read).
- Modes (AGENTS.md:297-326): Allowance (default) — advertise agent as feePayer; user debited via `addApprovedHbarTransfer`, agent signs and pays node fee, facilitator only verifies+submits. Treasury — advertised = facilitator; agent pays from own balance; facilitator sponsors fee. Mutually exclusive per instance (one advertised address; scheme picks randomly if several).
- Blocky402 can only do treasury mode (fixed fee payer `0.0.7162784`) (AGENTS.md:337-345).
- Pin rationale: `@x402/hedera` ≥2.25 adds mandatory `verifyPayerSignature` (fetches debited account key from mirror); in allowance mode the user never signs → fails `invalid_exact_hedera_payload_signature_invalid`. Hence 2.13.2 exact pin (AGENTS.md ~290-295). Not independently verified.
- Three distinct accounts required: buyer == payTo → `amount_mismatch`; buyer == fee payer → `fee_payer_transferring_hbar` (AGENTS.md ~276-278).
- HBAR allowances never expire; app must revoke on-chain (`approveHbarAllowance(owner, spender, 0)`).

### Agent payment flow (`packages/frontend/services/x402/agentBuyer.ts`)

- `quote()` (agentBuyer.ts:116-153): unpaid fetch, `httpClient.getPaymentRequiredResponse(...)`, amount from `accepts[0].amount` as bigint tinybars. Mandate check (`checkMandate()`) runs on the real quote before `pay()`.
- `pay()` (agentBuyer.ts:160-192): `createPaymentPayload(quote.paymentRequired)` → `encodePaymentSignatureHeader` → refetch → `processResponse` → `settleResponse.transaction/payer`.
- Signer (agentBuyer.ts:94-109): treasury `createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(...))` with `PrivateKey` from `@hiero-ledger/sdk` (works because root overrides sdk to one version); allowance → custom `createAllowanceHederaSigner` (`allowanceSigner.ts:81-91`: `addApprovedHbarTransfer(owner,-amt)`, `addHbarTransfer(payTo,amt)`, `setTransactionId(TransactionId.generate(feePayer))`, freeze with network-only client, sign with agent key). Guards: HBAR only, `feePayer === spender`.
- No client spend controls (core 2.14 lacks them); mandate is the only app-level cap; allowance is on-chain cap.
- Seller (`packages/supplier/src/services/x402/server.ts`): `x402HTTPResourceServer` + `processHTTPRequest` / `processSettlement`; `HTTPFacilitatorClient({ timeoutMs: FACILITATOR_TIMEOUT_MS })` default 120000 because 30s default timed out on testnet settle ("1.10 HBAR was lost", server.ts:43-51). Quote cache 300s unpaid / 900s paid, keyed on canonical query hash (AGENTS.md).

## Reusable patterns (for us)

- Carpool's quote cache + replay of issued requirements (only needed if price can drift between 402 and retry; with `@x402/express`-style static pricing the library rebuilds identical requirements).
- `@x402/fetch` buyer construction exactly as pay.ts:160-170, with `PrivateKey` imported from `@x402/hedera`.
- Decode `PAYMENT-RESPONSE` with `decodePaymentResponseHeader(...).transaction`; record `payer` from settle response, never parse it from the tx id (tx id account = facilitator fee payer `0.0.7162784`).
- Mirror verification: convert `0.0.x@s.n` → `0.0.x-s-n` for `/api/v1/transactions/`; HashScan accepts the dash form.
- Raise facilitator timeout (AutoVoyage) and treat settle timeout as "unknown, reconcile via mirror", not as failure.
- Stub facilitator must enforce `accepted` ≡ requirements and a real signed tx, else tests lie (Carpool §2.1).
- Treat `durable/recorded` separately from "paid" (Carpool gate).

## Incompatibilities

- AutoVoyage's 2.13.2/2.14 stack vs Carpool/current 2.25+: `x402Client.fromConfig`/`spendControls`/`setSpendControls` absent in core 2.14 (calling throws); `processResponse` result shape differs across versions (AGENTS.md ~282-285). Don't mix examples across versions.
- `ExactHederaScheme` exists under `/exact/client`, `/exact/server`, `/exact/facilitator` with different constructors (X402-RESEARCH.md:51).
- Allowance mode is incompatible with Blocky402 and with `@x402/hedera` ≥2.25 (per AutoVoyage, unverified).
- Duplicate `@hiero-ledger/sdk` whenever the app's sdk version ≠ the exact pin in `@x402/hedera` (2.25.0→2.85.0, 2.30.0→2.90.1).
- HBAR asset `"0.0.0"` under ≥2.25 spend controls: AutoVoyage claims native HBAR would need `.setSpendControls(false)` or an allowlist entry (AGENTS.md:280-281, unverified against 2.30).

## Security concerns

- Carpool gate: replay key omits asset/scheme/network; relies on facilitator equality check for those. Fine with Blocky402 (strict equality claimed), weaker with a lax facilitator.
- Carpool: single third-party facilitator dependency, no fallback configured (RESTRUCTURE-REVIEW-1.md:193).
- AutoVoyage facilitator: no auth, no CORS policy, no body size limit on `readJson` (server.ts:103-108); anyone can call `/settle` with a valid signed payload (acceptable-ish since non-custodial, but it spends the fee-payer's HBAR on fees and is a DoS/fee-drain surface). Error messages echoed to callers.
- AutoVoyage serves goods on settle exception (`x-settlement-unconfirmed`), i.e. free data if settle genuinely failed — deliberate trade-off.
- AutoVoyage server-held agent key spending user funds via never-expiring HBAR allowance; revocation is app responsibility.
- AutoVoyage pins an older `@x402/hedera` specifically to avoid a payer-signature check added later.
- Both: ECDSA hex private keys in env vars.

## Recommendations for ShipLock

Target: simple HBAR `exact` cryptoTransfer on `hedera:testnet`, hosted Blocky402 `https://api.testnet.blocky402.com`, buyer via `@x402/fetch`.

1. Pin exact versions, one generation: `@x402/core`, `@x402/fetch`, `@x402/hedera` all at the same version (2.25.0 is proven by Carpool against Blocky402; 2.30.0 is latest but unverified against Blocky402). Set the app's `@hiero-ledger/sdk` to the exact version `@x402/hedera` pins (2.85.0 for 2.25.0; 2.90.1 for 2.30.0), or add a pnpm override, and import `PrivateKey` from `@x402/hedera` regardless.
2. Buyer: copy Carpool pay.ts:160-170 with `asset: "0.0.0"` and `maxAmountPerPayment` in tinybars (string). Confirm on first run that spend controls accept native HBAR `"0.0.0"` (unverified; AutoVoyage hints an opt-out may be needed).
3. Treasury mode only. Buyer account must be ECDSA, funded with HBAR, distinct from `payTo` and from `0.0.7162784`. Do not attempt HIP-336 allowance with Blocky402.
4. Seller: `x402ResourceServer` + `HTTPFacilitatorClient({ url, timeoutMs: ~120000 })` + `ExactHederaScheme` from `/exact/server`; register `hedera:testnet`; `payTo` as `0.0.x` (not EVM alias). Static per-route pricing avoids needing Carpool's quote cache; if price is dynamic, cache issued requirements and settle against them.
5. Record `settle.payer` as buyer and `settle.transaction` as tx id; decode `PAYMENT-RESPONSE` via `decodePaymentResponseHeader`. Normalise tx ids to one notation (store `@` form, derive dash form for mirror/HashScan).
6. Verify each settlement independently via `https://testnet.mirrornode.hedera.com/api/v1/transactions/<dash-id>`: expect `CRYPTOTRANSFER`, `SUCCESS`, buyer −amount, payTo +amount, fee from `0.0.7162784` (shape confirmed on AutoVoyage's 0.3 HBAR txs).
7. On settle timeout: don't retry blindly (double charge risk); reconcile via mirror before re-paying.
8. Tests: a stub facilitator must byte-match live `/supported` and enforce `accepted` ≡ requirements + real signed tx bytes (Carpool lessons). Keep one live testnet run as the real proof.
9. Unverified items to check before relying on them: HBAR under 2.25/2.30 spend controls; Blocky402 behaviour under 2.30; whether Blocky402 rejects duplicate signature replays itself.
