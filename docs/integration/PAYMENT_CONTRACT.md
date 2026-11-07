# Payment ↔ review contract (Hermes → Cursor)

Status: Hermes adapter implements Cursor's **contract v2** (`docs/INTEGRATION_CONTRACT.md`, `a8350ab`) unchanged: `PurchaseReviewInput` with `expectedDiffSha256`, quote `extra.shiplock` = `ReviewQuoteBinding` (strict, canonical equality), `PaidReviewResult` validated with `PaidReviewResultSchema`.
Compatibility is proven two ways:
- Unit: `packages/x402/test/cursor-acceptance.test.ts` runs Cursor's unmodified `verifyPaidReviewResult` + `checkHederaTransfer` on the buyer's output.
- Live: `docs/evidence/payment/M1.md` run 3 (demo PR `Hebx/shiplock-demo-target#1`, tx `0.0.7162784@1794014990.278100917`): `verifyPaidReviewResult` ok with ShipLock's independent report digest **and** diff digest; `checkHederaTransfer` → `confirmed`.

No change to `packages/shared/src/contracts.ts` is requested.

## Mapping: coordination brief fields → existing contract

| Brief field | Contract field | Notes |
|---|---|---|
| `jobId` | `ReviewJob.jobId` / `PaidReviewResult.jobId` | |
| `repositoryId` | `ReviewJob.repositoryId` | GitHub numeric repo id |
| `pullRequestNumber` | `ReviewJob.pullNumber` | |
| `expectedHeadSha` | `ReviewJob.headSha` | 40 lowercase hex; also `baseSha` is bound |
| `diffDigest` | `PurchaseReviewInput.expectedDiffSha256` → quote `extra.shiplock.diffSha256` → `ReviewReport.diffSha256` | sha256 of GitHub `compare/{base}...{head}` diff bytes. Merchant re-fetches and refuses to quote on mismatch (409, before any 402) |
| `reviewProvider` | `ReviewPurchaseGateway.adapterId` + `PaidReviewResult.vendorId` | adapter `hermes-x402-hedera/2.30.0`, vendor `shiplock-x402-audit` |
| `maxPaymentAmount` | `PurchaseReviewInput.maxTinybar` | integer tinybar string; min'd with `AGENT_MAX_PAYMENT_TINYBAR` |
| `auditedHeadSha` | `PaidReviewResult.headSha` = `report.headSha` | |
| `reviewReportDigest` | `PaidReviewResult.reportSha256` | `canonicalSha256(report)` from `@shiplock/shared` (single implementation) |
| `findings` | `PaidReviewResult.report.findings` | |
| `scannerVersion` | `PaidReviewResult.scannerVersion` = `report.scannerVersion` | `shiplock-deterministic/0.1.0` |
| `hederaNetwork` | `PaidReviewResult.network` | `hedera:testnet` |
| `paymentAsset` | `PaidReviewResult.asset` | **`"0.0.0"`** (native HBAR, `HBAR_ASSET_ID` in `@x402/hedera`) — matches `X402_HBAR_ASSET` default |
| `paymentAmount` | `PaidReviewResult.amountBaseUnits` | tinybar integer string |
| `settlementTransactionId` | `PaidReviewResult.hederaTransactionId` | SDK form `0.0.<feePayer>@<secs>.<nanos>`; payer of the tx id is the **facilitator fee payer** (`0.0.7162784`), not the agent. Mirror form `0.0.7162784-<secs>-<nanos>`; nanos are always 9 digits from the SDK |
| `settlementVerified` | `PaidReviewResult.settlementConfirmed` | `true` only after the buyer's own Mirror Node check (SUCCESS, exact payer debit, payTo credit). Cursor re-checks independently |

`evidenceKind` is always `"live"` from this adapter. `payerAccountId` is the agent account.

## How Cursor calls it

```ts
import { auditUrl, createReviewPurchaser, createMirrorClient, resolveHederaCapability } from "@shiplock/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";

const cap = await resolveHederaCapability(new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL, timeoutMs: 120_000 }), "hedera:testnet");
const gateway = createReviewPurchaser({
  network: "hedera:testnet",
  payerAccountId: env.HEDERA_AGENT_ACCOUNT_ID,
  payerPrivateKey: env.HEDERA_AGENT_PRIVATE_KEY,
  allowedPayTo: [env.HEDERA_AUDIT_PAYTO_ACCOUNT_ID],
  expectedFeePayer: cap.feePayer,
  globalMaxTinybar: BigInt(env.AGENT_MAX_PAYMENT_TINYBAR),
  mirror: createMirrorClient(env.HEDERA_MIRROR_NODE_URL),
  onSigned: ({ jobId, transactionId }) => persistPendingPayment(jobId, transactionId),
});

const job = toReviewJob(row);                     // apps/api/src/review-service.ts
const r = await gateway.purchaseReview({
  job, expectedDiffSha256: row.diff_sha256,
  reviewUrl: auditUrl(env.SHIPLOCK_AUDIT_URL, job, row.diff_sha256),
  maxTinybar: env.AGENT_MAX_PAYMENT_TINYBAR,
});
const { evidence, ...result } = r;                // `result` is a plain PaidReviewResult
await fetch(`${api}/api/reviews/${job.jobId}/paid-review`, { method: "POST", headers: { authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ adapterId: gateway.adapterId, result }) });
```

Merchant URL params (contract v2): `jobId, repoId, repo, pr, base, sha, diff, scanner`. With `github` configured the merchant verifies repo id, PR open, head/base and the diff digest against GitHub before quoting. The merchant (`createAuditMerchant` + `createScannerAuditor`) runs `@shiplock/scanner` `scanDiff` over the GitHub compare diff for the quoted base/head, so `reportSha256` equals Cursor's `local_report_sha256` byte for byte (live-verified).

## Errors → Cursor action

| Error | Money moved | Cursor should |
|---|---|---|
| `PaymentPolicyError` / `CapabilityError` | no | mark the job's payment failed; a new quote is safe |
| `PaymentUncertainError(transactionId)` | unknown | store the tx id; poll mirror; **never** start a second purchase for the job until resolved |
| `PaidButNotFulfilledError(transactionId)` | yes | store the tx id; retry fulfilment (resend the same payment), never re-pay |
| `AuditShaMismatchError` / `AuditIntegrityError` | yes | the review is invalid; job stays unmergeable; flag the vendor |

## Proposed (not required) follow-ups for Cursor-owned code

1. `apps/api/src/mirror-node.ts:toMirrorTransactionId` keeps nanos as given. The SDK always emits 9 digits, so this is fine today; `padStart(9, "0")` would make it robust to hand-written ids. Low.
2. `checkHederaTransfer` accepts a payer net debit ≥ amount. In exact x402 the facilitator pays fees, so the payer debit is exactly `amount`; tightening to equality would detect bundled extra transfers. Low.
