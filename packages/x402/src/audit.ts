/**
 * Paid audit document. The report IS Cursor's canonical `ReviewReport` (packages/shared), so
 * ShipLock can recompute `reportSha256` from the same SHA-pinned diff and compare byte for byte.
 */
import { canonicalSha256, type ReviewJob, type ReviewReport } from "@shiplock/shared";

export interface PaidAuditBody {
  jobId: string;
  vendorId: string;
  report: ReviewReport;
  reportSha256: string;
  payment: {
    network: string;
    transactionId: string;
    asset: string;
    amount: string;
    payTo: string;
    quoteId: string;
  };
}

/** Produces the canonical report for the exact job (base...head diff). */
export type Auditor = (job: ReviewJob) => Promise<ReviewReport>;

export function reportDigest(report: ReviewReport): string {
  return canonicalSha256(report);
}
