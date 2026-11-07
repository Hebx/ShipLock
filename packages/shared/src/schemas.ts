import { z } from "zod";

export const HexShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "expected 40 lowercase hex characters");
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
export const RepoFullNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "expected owner/repo");
export const PositiveIntSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const TinybarSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/, "expected integer tinybar string");
export const HederaAccountIdSchema = z.string().regex(/^0\.0\.[0-9]{1,12}$/, "expected 0.0.N");
export const HederaTransactionIdSchema = z
  .string()
  .regex(/^0\.0\.[0-9]{1,12}@[0-9]{1,12}\.[0-9]{1,9}$/, "expected 0.0.N@seconds.nanos");
export const EvidenceKindSchema = z.enum(["live", "test", "simulated"]);

export const ReviewJobSchema = z.strictObject({
  jobId: z.string().min(1).max(100),
  repositoryId: PositiveIntSchema,
  repository: RepoFullNameSchema,
  pullNumber: PositiveIntSchema,
  headSha: HexShaSchema,
  baseSha: HexShaSchema,
  scannerVersion: z.string().min(1).max(100),
});

export const ReviewQuoteBindingSchema = ReviewJobSchema.extend({ diffSha256: Sha256HexSchema });

export const PurchaseReviewInputSchema = z.strictObject({
  job: ReviewJobSchema,
  expectedDiffSha256: Sha256HexSchema,
  reviewUrl: z.url({ protocol: /^https?$/ }).max(2048),
  maxTinybar: TinybarSchema,
});

export const ReviewFindingSchema = z.strictObject({
  ruleId: z.string().min(1).max(64),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  file: z.string().min(1).max(1024),
  line: PositiveIntSchema.optional(),
  description: z.string().min(1).max(500),
  evidence: z.string().max(300).optional(),
});

export const ReviewReportSchema = z.strictObject({
  schema: z.literal("shiplock.review-report/v1"),
  repositoryId: PositiveIntSchema,
  repository: RepoFullNameSchema,
  pullNumber: PositiveIntSchema,
  headSha: HexShaSchema,
  baseSha: HexShaSchema,
  diffSha256: Sha256HexSchema,
  scannerVersion: z.string().min(1).max(100),
  conclusion: z.enum(["pass", "block", "inconclusive"]),
  findings: z.array(ReviewFindingSchema).max(1000),
  stats: z.strictObject({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaryFiles: z.number().int().nonnegative(),
  }),
  limitations: z.array(z.string().max(300)).max(50),
});

export const PaidReviewResultSchema = z.strictObject({
  jobId: z.string().min(1).max(100),
  repositoryId: PositiveIntSchema,
  pullNumber: PositiveIntSchema,
  headSha: HexShaSchema,
  reportSha256: Sha256HexSchema,
  report: ReviewReportSchema,
  network: z.literal("hedera:testnet"),
  asset: z.string().min(1).max(64),
  amountBaseUnits: TinybarSchema,
  payerAccountId: HederaAccountIdSchema,
  merchantAccountId: HederaAccountIdSchema,
  hederaTransactionId: HederaTransactionIdSchema,
  settlementConfirmed: z.boolean(),
  evidenceKind: EvidenceKindSchema,
  vendorId: z.string().min(1).max(100),
  scannerVersion: z.string().min(1).max(100),
});

/** Parses "owner/repo#123" style references used by CLI tools. */
export const PullRefSchema = z.strictObject({
  repository: RepoFullNameSchema,
  pullNumber: PositiveIntSchema,
});
