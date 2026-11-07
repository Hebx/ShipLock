/** Cross-agent boundary — Cursor owns changes. Hermes must request interface changes. */
export type HexSha = string; // runtime validator enforces exactly 40 lowercase hexadecimal characters

/**
 * Where a piece of evidence came from. The UI must render this label next to every
 * payment, identity and merge artifact.
 * - live: real Hedera testnet settlement / production World IdP / real GitHub API side effect
 * - test: real protocol run against a sandbox or test environment (e.g. World sandbox identity)
 * - simulated: fake adapter or fixture; never proof of anything external
 */
export type EvidenceKind = "live" | "test" | "simulated";

export interface ReviewJob {
  jobId: string;
  repositoryId: number;
  repository: string; // owner/repo, allowlisted
  pullNumber: number;
  headSha: HexSha;
  baseSha: HexSha;
  scannerVersion: string;
}

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ReviewFinding {
  ruleId: string;
  severity: FindingSeverity;
  file: string;
  line?: number;
  description: string;
  /** Redacted, truncated excerpt of the matched added line. Untrusted repository content. */
  evidence?: string;
}

export type ReviewConclusion = "pass" | "block" | "inconclusive";

/**
 * Canonical review report. Contains no timestamps or payment data so that anyone holding
 * the same diff bytes and scanner version can recompute an identical `reportSha256`.
 */
export interface ReviewReport {
  schema: "shiplock.review-report/v1";
  repositoryId: number;
  repository: string;
  pullNumber: number;
  headSha: HexSha;
  baseSha: HexSha;
  diffSha256: string;
  scannerVersion: string;
  conclusion: ReviewConclusion;
  findings: ReviewFinding[];
  stats: {
    filesChanged: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  limitations: string[];
}

export interface PaidReviewResult {
  jobId: string;
  repositoryId: number;
  pullNumber: number;
  headSha: HexSha;
  reportSha256: string; // sha256 of canonicalJson(report)
  report: ReviewReport;
  network: "hedera:testnet";
  asset: string;
  amountBaseUnits: string; // tinybar, decimal integer string, never floating point
  payerAccountId: string;
  merchantAccountId: string;
  hederaTransactionId: string; // e.g. 0.0.1234@1700000000.123456789
  /** Facilitator-reported settlement. Necessary, not sufficient: ShipLock verifies independently. */
  settlementConfirmed: boolean;
  evidenceKind: EvidenceKind;
  vendorId: string;
  scannerVersion: string;
}

export interface PurchaseReviewInput {
  job: ReviewJob;
  reviewUrl: string;
  maxTinybar: string;
}

export interface ReviewPurchaseGateway {
  /** Identifies the adapter in evidence; a fake adapter must return evidenceKind "simulated". */
  readonly adapterId: string;
  purchaseReview(input: PurchaseReviewInput): Promise<PaidReviewResult>;
}

export type MergeAuthorizationStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "invalidated"
  | "consumed";

export interface MergeAuthorization {
  authorizationId: string;
  reviewJobId: string;
  repositoryId: number;
  repository: string;
  pullNumber: number;
  headSha: HexSha;
  reportSha256: string;
  operationHash: string;
  worldIssuer: string;
  worldSubject: string; // server-only, NOT HCS
  expiresAt: string;
  status: MergeAuthorizationStatus;
}
