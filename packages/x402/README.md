# @shiplock/x402

Hedera x402 v2 payment subsystem for ShipLock: a paid `/audit` merchant and an autonomous buyer. Exact `cryptoTransfer`, native HBAR, `hedera:testnet`, hosted Blocky402 facilitator. Live proof: [`docs/evidence/payment/M1.md`](../../docs/evidence/payment/M1.md).

## Integration (Cursor)

```ts
import { createReviewPurchaser, createMirrorClient, resolveHederaCapability } from "@shiplock/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";

const cap = await resolveHederaCapability(new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL! }), "hedera:testnet");
const purchaser = createReviewPurchaser({
  network: "hedera:testnet",
  payerAccountId: process.env.HEDERA_AGENT_ACCOUNT_ID!,
  payerPrivateKey: process.env.HEDERA_AGENT_PRIVATE_KEY!,   // server-side only
  allowedPayTo: [process.env.HEDERA_AUDIT_PAYTO_ACCOUNT_ID!],
  expectedFeePayer: cap.feePayer,
  globalMaxTinybar: BigInt(process.env.AGENT_MAX_PAYMENT_TINYBAR!),
  mirror: createMirrorClient(process.env.HEDERA_MIRROR_NODE_URL!),
  onSigned: ({ jobId, transactionId }) => db.recordPendingPayment(jobId, transactionId), // persist before send
});

// implements ReviewPurchaseGateway from packages/shared/src/contracts.ts
const result = await purchaser.purchaseReview({
  jobId, reviewUrl: `${AUDIT_URL}/audit?jobId=${jobId}&repo=${owner}/${repo}&sha=${headSha}&pr=${pr}`,
  maxTinybar: "10000", expectedHeadSha: headSha,
});
// result: PaidReviewResult (+ evidence: requirements, consensusTimestamp, full body)
```

`reviewUrl` must carry `jobId`, `repo` (`owner/repo`), `sha` (40-hex) and optional `pr`. The quote is bound to that SHA; the buyer refuses to sign a quote for any other SHA.

### Errors: what the caller must do

| Error | Money moved? | Action |
|---|---|---|
| `PaymentPolicyError` | No | Fix config/quote; safe to retry with a new quote |
| `CapabilityError` | No | Facilitator does not serve the network; fail closed |
| `PaymentUncertainError` (`transactionId`) | Unknown | **Do not re-pay.** Reconcile `transactionId` on the mirror, then retry the same payment or wait out the 180s validity window |
| `PaidButNotFulfilledError` (`transactionId`) | Yes | **Do not re-pay.** Resend the same `PAYMENT-SIGNATURE` to get the audit |
| `AuditShaMismatchError` / `AuditIntegrityError` | Yes | Treat the review as invalid; no merge; flag the vendor |

`settlementConfirmed: true` is set only after the Mirror Node shows `SUCCESS` with the exact payer debit and payTo credit.

## Merchant

```ts
import { createAuditMerchant, createGithubAuditor, createMirrorClient, MerchantStore } from "@shiplock/x402";
const { app } = await createAuditMerchant({
  network: "hedera:testnet", payTo, priceTinybar: 1000n,
  facilitator: process.env.X402_FACILITATOR_URL!, mirror: createMirrorClient(mirrorUrl),
  auditor: createGithubAuditor({ token }),        // or Cursor's packages/scanner adapter
  store: new MerchantStore("data/merchant.sqlite"), publicBaseUrl, repoAllowlist: ["Hebx/shiplock-demo-target"],
});
```

`auditor` is pluggable: `(job) => Promise<{ vendorId, scannerVersion, filesScanned, findings, verdict, disclaimer }>`. The merchant pins `jobId/repository/pullNumber/headSha` from the stored quote, so an auditor cannot report on a different commit.

Merchant invariants:
- The paid retry must deep-equal the stored quote (`quote_modified` otherwise); no repricing.
- One tx per quote, one fulfillment per quote (SQLite UNIQUE); a byte-identical resend returns the stored body.
- Local precheck (decode, fee payer, exact HBAR movement) before `/verify`; then `/verify` then `/settle`, then Mirror Node confirmation before serving.
- Settle error or `success:false`: state `uncertain` and mirror reconcile. Failure is declared only after `validStart + 180s`. Never re-settled.

## Environment (names only)

`HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` (ECDSA), `HEDERA_AUDIT_PAYTO_ACCOUNT_ID`, `HEDERA_MIRROR_NODE_URL`, `X402_FACILITATOR_URL`, `AUDIT_PRICE_TINYBAR`, `AGENT_MAX_PAYMENT_TINYBAR`; optional `GITHUB_TOKEN`, `AUDIT_TARGET_REPO`, `AUDIT_TARGET_SHA`.

## Commands

```bash
pnpm --dir packages/x402 install --frozen-lockfile
pnpm --dir packages/x402 typecheck
pnpm --dir packages/x402 test          # strict official-scheme facilitator, no network
pnpm --dir packages/x402 live          # LIVE testnet: spends AUDIT_PRICE_TINYBAR, writes docs/evidence/payment/
```

Pins: `@x402/{core,fetch,hedera}` 2.30.0, `@hiero-ledger/sdk` 2.90.1 (matches `@x402/hedera`'s exact pin; single SDK instance). Node ≥ 22.5 (`node:sqlite`).
