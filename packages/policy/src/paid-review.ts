import {
  canonicalSha256,
  PaidReviewResultSchema,
  type EvidenceKind,
  type PaidReviewResult,
  type ReviewJob,
} from "@shiplock/shared";

export interface PaidReviewExpectations {
  network: "hedera:testnet";
  asset: string;
  merchantAccountId: string;
  /** The agent account allowed to pay; any other payer is refused. */
  payerAccountId?: string;
  /** Price issued in the original quote; the paid result must match it exactly. */
  quotedTinybar: string;
  maxTinybar: string;
  allowedEvidenceKinds: readonly EvidenceKind[];
  /** Digest ShipLock computed itself from the same SHA-pinned diff, when available. */
  independentReportSha256?: string;
  /** sha256 of the diff bytes ShipLock analyzed; the paid report must have reviewed the same bytes. */
  diffSha256?: string;
}

export type PaidReviewVerdict =
  | { ok: true; result: PaidReviewResult }
  | { ok: false; reasons: string[] };

/**
 * Accepts a purchased review only if every binding matches the job ShipLock created.
 * `settlementConfirmed: true` is required but never sufficient on its own; on-ledger
 * confirmation of `hederaTransactionId` is a separate check.
 */
export function verifyPaidReviewResult(
  job: ReviewJob,
  candidate: unknown,
  expect: PaidReviewExpectations,
): PaidReviewVerdict {
  const parsed = PaidReviewResultSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reasons: ["malformed paid review result"] };
  const r = parsed.data;
  const reasons: string[] = [];
  const check = (cond: boolean, reason: string) => {
    if (!cond) reasons.push(reason);
  };

  check(r.jobId === job.jobId, "job id mismatch");
  check(r.repositoryId === job.repositoryId, "repository id mismatch");
  check(r.pullNumber === job.pullNumber, "pull request mismatch");
  check(r.headSha === job.headSha, "head SHA mismatch");
  check(r.scannerVersion === job.scannerVersion, "scanner version mismatch");

  const rep = r.report;
  check(rep.repositoryId === job.repositoryId, "report repository id mismatch");
  check(rep.repository.toLowerCase() === job.repository.toLowerCase(), "report repository mismatch");
  check(rep.pullNumber === job.pullNumber, "report pull request mismatch");
  check(rep.headSha === job.headSha, "report head SHA mismatch");
  check(rep.baseSha === job.baseSha, "report base SHA mismatch");
  check(rep.scannerVersion === job.scannerVersion, "report scanner version mismatch");
  if (expect.diffSha256 !== undefined) {
    check(rep.diffSha256 === expect.diffSha256, "report reviewed a different diff");
  }
  check(canonicalSha256(rep) === r.reportSha256, "report digest does not match report content");
  if (expect.independentReportSha256 !== undefined) {
    check(r.reportSha256 === expect.independentReportSha256, "report digest differs from ShipLock's independent analysis");
  }

  check(r.network === expect.network, "unsupported network");
  check(r.asset === expect.asset, "unexpected asset");
  check(r.merchantAccountId === expect.merchantAccountId, "unexpected merchant");
  const amount = BigInt(r.amountBaseUnits);
  check(amount === BigInt(expect.quotedTinybar), "amount differs from quote");
  check(amount <= BigInt(expect.maxTinybar), "amount exceeds spend cap");
  check(r.payerAccountId !== r.merchantAccountId, "payer and merchant are the same account");
  if (expect.payerAccountId !== undefined) check(r.payerAccountId === expect.payerAccountId, "payer is not the configured agent account");
  check(r.settlementConfirmed, "settlement not confirmed");
  check(expect.allowedEvidenceKinds.includes(r.evidenceKind), `evidence kind ${r.evidenceKind} not accepted here`);

  return reasons.length === 0 ? { ok: true, result: r } : { ok: false, reasons };
}
