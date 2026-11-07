/** Cross-agent boundary — Cursor owns changes. Hermes must request interface changes. */
export type HexSha = string; // runtime validator enforces exactly 40 hexadecimal characters

export interface ReviewJob {
  jobId: string;
  repositoryId: number;
  repository: string; // owner/repo, allowlisted
  pullNumber: number;
  headSha: HexSha;
  baseSha?: HexSha;
  scannerVersion: string;
}

export interface ReviewFinding {
  ruleId: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  file: string;
  line?: number;
  description: string;
}

export interface PaidReviewResult {
  jobId: string;
  headSha: HexSha;
  reportSha256: string; // computed from canonical serialized report content
  findings: ReviewFinding[];
  network: "hedera:testnet";
  asset: string;
  amountBaseUnits: string; // not floating point
  merchantAccountId: string;
  hederaTransactionId: string;
  settlementConfirmed: boolean;
  vendorId: string;
  scannerVersion: string;
}

export interface PurchaseReviewInput {
  jobId: string;
  reviewUrl: string;
  maxTinybar: string;
  expectedHeadSha: HexSha;
}

export interface ReviewPurchaseGateway {
  purchaseReview(input: PurchaseReviewInput): Promise<PaidReviewResult>;
}

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
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
}
