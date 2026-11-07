import { SCANNER_VERSION, scanDiff } from "@shiplock/scanner";
import type { PaidReviewResult, ReviewJob } from "@shiplock/shared";
import { describe, expect, it } from "vitest";
import { computeOperationHash, verifyPaidReviewResult, type MergeOperation, type PaidReviewExpectations } from "../src/index.ts";

const job: ReviewJob = {
  jobId: "job_1",
  repositoryId: 42,
  repository: "Hebx/shiplock-demo-target",
  pullNumber: 7,
  headSha: "1".repeat(40),
  baseSha: "2".repeat(40),
  scannerVersion: SCANNER_VERSION,
};
const diff = new TextEncoder().encode("diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1 +1,2 @@\n x\n+y\n");
const { report, reportSha256 } = scanDiff(job, diff);

const expectLive: PaidReviewExpectations = {
  network: "hedera:testnet",
  asset: "0.0.0",
  merchantAccountId: "0.0.2002",
  quotedTinybar: "1000",
  maxTinybar: "10000",
  allowedEvidenceKinds: ["live"],
  independentReportSha256: reportSha256,
};

function result(overrides: Partial<PaidReviewResult> = {}): PaidReviewResult {
  return {
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    pullNumber: job.pullNumber,
    headSha: job.headSha,
    reportSha256,
    report,
    network: "hedera:testnet",
    asset: "0.0.0",
    amountBaseUnits: "1000",
    payerAccountId: "0.0.1001",
    merchantAccountId: "0.0.2002",
    hederaTransactionId: "0.0.1001@1762480000.000000001",
    settlementConfirmed: true,
    evidenceKind: "live",
    vendorId: "shiplock-review-merchant",
    scannerVersion: SCANNER_VERSION,
    ...overrides,
  };
}

function reasons(candidate: unknown, e: PaidReviewExpectations = expectLive): string[] {
  const v = verifyPaidReviewResult(job, candidate, e);
  return v.ok ? [] : v.reasons;
}

describe("verifyPaidReviewResult", () => {
  it("accepts a fully bound result", () => {
    expect(verifyPaidReviewResult(job, result(), expectLive).ok).toBe(true);
  });

  it("does not accept settlementConfirmed:true when anything else is wrong", () => {
    expect(reasons(result({ amountBaseUnits: "999" }))).toContain("amount differs from quote");
    expect(reasons(result({ merchantAccountId: "0.0.6666" }))).toContain("unexpected merchant");
    expect(reasons(result({ asset: "0.0.456858" }))).toContain("unexpected asset");
    expect(reasons(result({ settlementConfirmed: false }))).toContain("settlement not confirmed");
    expect(reasons(result({ payerAccountId: "0.0.2002" }))).toContain("payer and merchant are the same account");
  });

  it("enforces the spend cap even when the quote is honoured", () => {
    expect(reasons(result({ amountBaseUnits: "20000" }), { ...expectLive, quotedTinybar: "20000" })).toContain(
      "amount exceeds spend cap",
    );
  });

  it("rejects a stale report for a different head SHA", () => {
    const stale = scanDiff({ ...job, headSha: "3".repeat(40) }, diff);
    const r = reasons(result({ report: stale.report, reportSha256: stale.reportSha256 }));
    expect(r).toContain("report head SHA mismatch");
    expect(r).toContain("report digest differs from ShipLock's independent analysis");
  });

  it("rejects a tampered report whose digest no longer matches", () => {
    const tampered = { ...report, conclusion: "pass" as const, findings: [] };
    const r = reasons(result({ report: { ...tampered, stats: { ...tampered.stats, additions: 99 } } }));
    expect(r).toContain("report digest does not match report content");
  });

  it("rejects results for another job, PR or repository", () => {
    expect(reasons(result({ jobId: "job_2" }))).toContain("job id mismatch");
    expect(reasons(result({ pullNumber: 8 }))).toContain("pull request mismatch");
    expect(reasons(result({ headSha: "4".repeat(40) }))).toContain("head SHA mismatch");
  });

  it("refuses simulated evidence where live evidence is required", () => {
    expect(reasons(result({ evidenceKind: "simulated" }))).toContain("evidence kind simulated not accepted here");
  });

  it("rejects malformed payloads including float amounts and bad tx ids", () => {
    expect(reasons(result({ amountBaseUnits: "10.5" }))).toEqual(["malformed paid review result"]);
    expect(reasons(result({ hederaTransactionId: "fake-tx" }))).toEqual(["malformed paid review result"]);
    expect(reasons({ ...result(), extra: true })).toEqual(["malformed paid review result"]);
  });
});

describe("computeOperationHash", () => {
  const op: MergeOperation = {
    schema: "shiplock.merge-operation/v1",
    action: "merge_pull_request",
    authorizationId: "auth_1",
    repositoryId: 42,
    repository: "Hebx/shiplock-demo-target",
    pullNumber: 7,
    headSha: "1".repeat(40),
    baseRef: "main",
    reportSha256,
    scannerVersion: SCANNER_VERSION,
    mergeMethod: "squash",
    approverGithubLogin: "Hebx",
    worldIssuer: "https://auth.world.org",
    nonce: "n".repeat(32),
    expiresAt: "2026-11-07T12:00:00.000Z",
  };

  it("is stable and changes when any bound field changes", () => {
    const h = computeOperationHash(op);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeOperationHash({ ...op })).toBe(h);
    for (const change of [
      { headSha: "5".repeat(40) },
      { pullNumber: 8 },
      { reportSha256: "f".repeat(64) },
      { mergeMethod: "merge" as const },
      { approverGithubLogin: "someone-else" },
      { expiresAt: "2026-11-07T12:00:01.000Z" },
      { nonce: "m".repeat(32) },
    ]) {
      expect(computeOperationHash({ ...op, ...change })).not.toBe(h);
    }
  });

  it("rejects unknown or malformed fields", () => {
    expect(() => computeOperationHash({ ...op, headSha: "abc" })).toThrow();
    expect(() => computeOperationHash({ ...op, extra: 1 } as MergeOperation)).toThrow();
  });
});
