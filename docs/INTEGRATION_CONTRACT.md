# Payment-to-review integration contract (v2)

Owner: **Cursor** (`packages/shared`). Hermes proposes changes in PR comments or `docs/COORDINATION.md`; Cursor edits.
Code: `packages/shared/src/contracts.ts` (types), `packages/shared/src/schemas.ts` (Zod runtime validation),
`packages/policy/src/paid-review.ts` (ShipLock's acceptance check).

Flow: `GitHub PR → review job → x402 quote bound to the job → payment → audit report → ShipLock acceptance`.

## Field mapping

The coordination brief proposed field names. Working code already used the names on the right, so they are kept.

| Brief name | Contract field | Notes |
|---|---|---|
| `jobId` | `job.jobId` | ShipLock job id |
| `repositoryId` | `job.repositoryId` | GitHub numeric id; survives renames |
| `pullRequestNumber` | `job.pullNumber` | |
| `expectedHeadSha` | `job.headSha` | 40 lowercase hex |
| — | `job.baseSha` | required: the diff is `compare/{baseSha}...{headSha}` |
| `diffDigest` | `expectedDiffSha256` | sha256 of the compare diff bytes ShipLock fetched |
| `reviewProvider` | `reviewUrl` + result `vendorId`, gateway `adapterId` | |
| `maxPaymentAmount` | `maxTinybar` | tinybar integer string |
| `auditedHeadSha` | `headSha`, `report.headSha` | |
| `reviewReportDigest` | `reportSha256` | `sha256(canonicalJson(report))` |
| `findings` | `report.findings` | inside the digested report |
| `scannerVersion` | `scannerVersion`, `report.scannerVersion` | must equal `job.scannerVersion` |
| `hederaNetwork` | `network` | `hedera:testnet` |
| `paymentAsset` | `asset` | `0.0.0` (native HBAR, `@x402/hedera` `HBAR_ASSET_ID`) |
| `paymentAmount` | `amountBaseUnits` | tinybar integer string |
| `settlementTransactionId` | `hederaTransactionId` | `0.0.N@seconds.nanos` |
| `settlementVerified` | `settlementConfirmed` | buyer's mirror-node check; ShipLock re-checks the mirror node itself |

## Buyer: `ReviewPurchaseGateway.purchaseReview(input: PurchaseReviewInput): Promise<PaidReviewResult>`

`PurchaseReviewInput = { job: ReviewJob, expectedDiffSha256, reviewUrl, maxTinybar }` (`PurchaseReviewInputSchema`).

Before signing, the buyer must refuse a quote unless `extra.shiplock` canonically equals
`{ ...input.job, diffSha256: input.expectedDiffSha256 }` (`ReviewQuoteBindingSchema`, strict: no extra or missing fields).
Existing checks stay: exact scheme, `hedera:testnet`, HBAR, payTo allowlist, fee payer from `/supported`, amount ≤ cap.

After payment, return `PaidReviewResult` (`PaidReviewResultSchema`, strict) with:
`jobId, repositoryId, pullNumber, headSha` from the job; `report` = the full `ReviewReport`; `reportSha256` recomputed by the
buyer; `payerAccountId`; `merchantAccountId`; `hederaTransactionId`; `settlementConfirmed: true` only after mirror `SUCCESS`
with the exact transfer; `evidenceKind: "live"`; `vendorId`; `scannerVersion`. The gateway object exposes `adapterId`.

## Merchant: the report must be recomputable by ShipLock

ShipLock accepts a paid review only if `reportSha256` equals the digest of its **own** scan of the same diff. So the
merchant must:

1. Take `jobId, repo, repoId, pr, base, sha, diff, scanner` from the request; verify `repoId`/`pr`/`sha`/`base` against GitHub.
2. Fetch `compare/{base}...{sha}` with `Accept: application/vnd.github.diff` (`@shiplock/github` `getCompareDiff`) and
   refuse to quote unless `sha256(diffBytes) == diff`. Mismatched diffs are refused **before** the 402, so nobody pays.
3. Run `scanDiff(job, diffBytes)` from `@shiplock/scanner` (version must equal `scanner`) and serve that `ReviewReport`
   unchanged, with `reportSha256 = canonicalSha256(report)` from `@shiplock/shared`. Payment data stays outside the report.
4. Put the `ReviewQuoteBinding` in the quote as `extra.shiplock`.

## ShipLock acceptance: `POST /api/reviews/:jobId/paid-review`

`Authorization: Bearer $SHIPLOCK_AGENT_TOKEN`, body `{ adapterId, result: PaidReviewResult }`.

`verifyPaidReviewResult` requires job/repo id/PR/head/base/scanner to match, `report.diffSha256 == ShipLock's diff digest`,
`canonicalSha256(report) == reportSha256 ==` ShipLock's independent digest, network/asset/merchant/quote/cap, payer ≠ merchant,
`settlementConfirmed`, and an accepted `evidenceKind`. The API then re-reads the live PR head and looks up
`hederaTransactionId` on the mirror node itself.

Responses: `200 accepted` · `202 ledger_pending` (resubmit the same result) · `422 paid_review_rejected {reasons}` ·
`409 transaction_already_used | paid_review_already_recorded | stale head`.

Error handling (buyer errors from `packages/x402`): `PaymentUncertainError` and `PaidButNotFulfilledError` mean **never
re-pay**; reconcile the transaction id. `AuditShaMismatchError`/`AuditIntegrityError` mean the review is invalid; no merge.
