/**
 * Paid audit document shape shared by merchant and buyer.
 * `reportSha256` = sha256(canonicalJson(report)); the buyer recomputes it, never trusts it.
 */
import type { ReviewFinding } from "../../shared/src/contracts.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";

export interface AuditJob {
  jobId: string;
  repository: string;
  pullNumber: number | null;
  headSha: string;
}

export interface AuditReport {
  jobId: string;
  repository: string;
  pullNumber: number | null;
  headSha: string;
  vendorId: string;
  scannerVersion: string;
  filesScanned: number;
  findings: ReviewFinding[];
  verdict: "pass" | "block" | "inconclusive";
  disclaimer: string;
}

export interface PaidAuditBody {
  report: AuditReport;
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

export type Auditor = (job: AuditJob) => Promise<Omit<AuditReport, "jobId" | "repository" | "pullNumber" | "headSha">>;

export function reportDigest(report: AuditReport): string {
  return sha256Hex(canonicalJson(report));
}
