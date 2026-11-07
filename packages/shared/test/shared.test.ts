import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  canonicalJson,
  canonicalSha256,
  HexShaSchema,
  HederaTransactionIdSchema,
  InvalidTransitionError,
  PurchaseReviewInputSchema,
  ReviewQuoteBindingSchema,
  TERMINAL_STATES,
  TinybarSchema,
} from "../src/index.ts";

describe("payment-to-review boundary", () => {
  const job = {
    jobId: "job_1",
    repositoryId: 42,
    repository: "Hebx/shiplock-demo-target",
    pullNumber: 1,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    scannerVersion: "shiplock-deterministic/0.1.0",
  };

  it("requires the full binding in a quote, with no extra fields", () => {
    expect(ReviewQuoteBindingSchema.safeParse({ ...job, diffSha256: "c".repeat(64) }).success).toBe(true);
    expect(ReviewQuoteBindingSchema.safeParse(job).success).toBe(false);
    expect(ReviewQuoteBindingSchema.safeParse({ ...job, diffSha256: "c".repeat(64), price: "1" }).success).toBe(false);
    expect(ReviewQuoteBindingSchema.safeParse({ ...job, headSha: "A".repeat(40), diffSha256: "c".repeat(64) }).success).toBe(false);
  });

  it("validates purchase input", () => {
    const input = { job, expectedDiffSha256: "c".repeat(64), reviewUrl: "https://audit.example/audit?jobId=job_1", maxTinybar: "10000" };
    expect(PurchaseReviewInputSchema.safeParse(input).success).toBe(true);
    expect(PurchaseReviewInputSchema.safeParse({ ...input, maxTinybar: "1.5" }).success).toBe(false);
    expect(PurchaseReviewInputSchema.safeParse({ ...input, reviewUrl: "file:///etc/passwd" }).success).toBe(false);
    expect(PurchaseReviewInputSchema.safeParse({ ...input, expectedDiffSha256: undefined }).success).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined members", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: true, x: null }], c: "s" }, u: undefined })).toBe(
      '{"a":{"c":"s","d":[2,{"x":null,"y":true}]},"b":1}',
    );
  });

  it("is insensitive to insertion order", () => {
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(canonicalSha256({ b: 2, a: 1 }));
  });

  it("rejects floats, non-finite numbers and unsupported types", () => {
    expect(() => canonicalJson({ amount: 0.1 })).toThrow(TypeError);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ n: 2 ** 60 })).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
    expect(() => canonicalJson({ b: 1n })).toThrow(TypeError);
  });
});

describe("schemas", () => {
  it("accepts only full lowercase 40-hex SHAs", () => {
    expect(HexShaSchema.safeParse("a".repeat(40)).success).toBe(true);
    expect(HexShaSchema.safeParse("A".repeat(40)).success).toBe(false);
    expect(HexShaSchema.safeParse("a".repeat(7)).success).toBe(false);
    expect(HexShaSchema.safeParse("main").success).toBe(false);
  });

  it("validates tinybar strings and Hedera transaction ids", () => {
    expect(TinybarSchema.safeParse("1000").success).toBe(true);
    expect(TinybarSchema.safeParse("1.5").success).toBe(false);
    expect(TinybarSchema.safeParse("-1").success).toBe(false);
    expect(TinybarSchema.safeParse("01").success).toBe(false);
    expect(HederaTransactionIdSchema.safeParse("0.0.1234@1700000000.123456789").success).toBe(true);
    expect(HederaTransactionIdSchema.safeParse("0.0.1234-1700000000-123456789").success).toBe(false);
  });
});

describe("release state machine", () => {
  it("allows the happy path in order", () => {
    const path = [
      "discovered",
      "review_pending",
      "paid_review_confirmed",
      "approval_pending",
      "approved",
      "merge_in_progress",
      "merged",
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(() => assertTransition(path[i - 1]!, path[i]!)).not.toThrow();
    }
  });

  it("never reaches merged except from merge_in_progress or reconciliation", () => {
    expect(canTransition("approved", "merged")).toBe(false);
    expect(canTransition("paid_review_confirmed", "merged")).toBe(false);
    expect(canTransition("reconcile_required", "merged")).toBe(true);
  });

  it("cannot skip the paid review or the approval", () => {
    expect(canTransition("review_pending", "approval_pending")).toBe(false);
    expect(canTransition("approval_pending", "merge_in_progress")).toBe(false);
  });

  it("treats stale, invalid, failed, merged and review_blocked as terminal", () => {
    for (const s of ["stale", "invalid", "failed", "merged", "review_blocked"] as const) {
      expect(TERMINAL_STATES.has(s)).toBe(true);
      expect(() => assertTransition(s, "approval_pending")).toThrow(InvalidTransitionError);
    }
  });

  it("does not let an uncertain merge be retried directly", () => {
    expect(canTransition("reconcile_required", "merge_in_progress")).toBe(false);
  });
});
