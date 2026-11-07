import type { PaidReviewResult, PurchaseReviewInput, ReviewPurchaseGateway } from "@shiplock/shared";
import { AuditIntegrityError, PaymentPolicyError, PaymentUncertainError } from "@shiplock/x402";
import { describe, expect, it } from "vitest";
import { AgentLedger } from "../src/ledger.ts";
import { runReview, type AgentDeps, type JobSummary, type OnSigned, type ShipLockClient, type SubmitResponse } from "../src/run.ts";

const ref = { repository: "Hebx/shiplock-demo-target", pullNumber: 1 };
const TX = "0.0.7162784@1794014990.278100917";

function jobSummary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job_1",
    repositoryId: 1448904918,
    repository: ref.repository,
    pullNumber: 1,
    headSha: "d".repeat(40),
    baseSha: "b".repeat(40),
    scannerVersion: "shiplock-deterministic/0.1.0",
    state: "review_pending",
    diffSha256: "e".repeat(64),
    ...overrides,
  };
}

function setup(opts: { job?: Partial<JobSummary>; buy?: (input: PurchaseReviewInput, onSigned: OnSigned) => Promise<PaidReviewResult>; responses?: SubmitResponse[] } = {}) {
  const ledger = new AgentLedger(":memory:");
  const inputs: PurchaseReviewInput[] = [];
  const submitted: unknown[] = [];
  const responses = [...(opts.responses ?? [{ httpStatus: 200, body: { status: "accepted", jobState: "paid_review_confirmed" } }])];
  let ledgerAtSend: string | undefined;

  const shiplock: ShipLockClient = {
    createJob: async () => jobSummary(opts.job),
    submitPaidReview: async (_jobId, _adapterId, result) => {
      submitted.push(result);
      return responses.length > 1 ? responses.shift()! : responses[0]!;
    },
  };
  const buy =
    opts.buy ??
    (async (input: PurchaseReviewInput, onSigned: OnSigned) => {
      onSigned({ jobId: input.job.jobId, transactionId: TX });
      ledgerAtSend = ledger.get(input.job.jobId)?.status;
      return { jobId: input.job.jobId, hederaTransactionId: TX, evidence: { secret: "x" } } as unknown as PaidReviewResult;
    });
  const purchaser = (onSigned: OnSigned): ReviewPurchaseGateway => ({
    adapterId: "test-adapter",
    purchaseReview: async (input) => {
      inputs.push(input);
      return buy(input, onSigned);
    },
  });
  const deps: AgentDeps = { shiplock, ledger, purchaser, adapterId: "test-adapter", auditBaseUrl: "http://127.0.0.1:4402", maxTinybar: "10000", sleep: async () => {} };
  return { deps, ledger, inputs, submitted, ledgerAtSend: () => ledgerAtSend };
}

describe("runReview", () => {
  it("pays once, records the payment before it is sent, and submits without buyer evidence", async () => {
    const t = setup();
    const out = await runReview(t.deps, ref);
    expect(out).toMatchObject({ kind: "accepted", transactionId: TX });
    expect(t.ledgerAtSend()).toBe("signed");
    expect(t.inputs).toHaveLength(1);
    expect(t.inputs[0]!.expectedDiffSha256).toBe("e".repeat(64));
    expect(new URL(t.inputs[0]!.reviewUrl).searchParams.get("diff")).toBe("e".repeat(64));
    expect(t.submitted[0]).not.toHaveProperty("evidence");

    expect((await runReview(t.deps, ref)).kind).toBe("accepted");
    expect(t.inputs).toHaveLength(1);
  });

  it("resubmits the same paid result while the mirror node catches up", async () => {
    const t = setup({ responses: [{ httpStatus: 202, body: { status: "ledger_pending" } }, { httpStatus: 200, body: { status: "accepted" } }] });
    expect((await runReview(t.deps, ref)).kind).toBe("accepted");
    expect(t.submitted).toHaveLength(2);
    expect(t.submitted[1]).toEqual(t.submitted[0]);
  });

  it("keeps a still-pending result and resubmits it on the next run without paying again", async () => {
    const t = setup({ responses: [{ httpStatus: 202, body: { status: "ledger_pending" } }] });
    expect((await runReview({ ...t.deps, submitAttempts: 2 }, ref)).kind).toBe("ledger_pending");
    expect(t.ledger.get("job_1")!.status).toBe("paid");
    await runReview({ ...t.deps, submitAttempts: 1 }, ref);
    expect(t.inputs).toHaveLength(1);
    expect(t.submitted).toHaveLength(3);
  });

  it("never pays again when the outcome of a signed payment is unknown", async () => {
    const t = setup({
      buy: async (input, onSigned) => {
        onSigned({ jobId: input.job.jobId, transactionId: TX });
        throw new PaymentUncertainError("facilitator timed out", TX);
      },
    });
    expect(await runReview(t.deps, ref)).toMatchObject({ kind: "needs_reconcile", status: "uncertain", transactionId: TX });
    expect(await runReview(t.deps, ref)).toMatchObject({ kind: "needs_reconcile" });
    expect(t.inputs).toHaveLength(1);
    expect(t.submitted).toHaveLength(0);
  });

  it("treats a crash after signing as unresolved, not as unpaid", async () => {
    const t = setup({
      buy: async (input, onSigned) => {
        onSigned({ jobId: input.job.jobId, transactionId: TX });
        throw new Error("socket hang up");
      },
    });
    expect(await runReview(t.deps, ref)).toMatchObject({ kind: "needs_reconcile", status: "signed" });
    await runReview(t.deps, ref);
    expect(t.inputs).toHaveLength(1);
  });

  it("leaves no record when the buyer refuses before signing, so a corrected run may pay", async () => {
    const t = setup({ buy: async () => Promise.reject(new PaymentPolicyError("amount exceeds cap")) });
    await expect(runReview(t.deps, ref)).rejects.toThrow(PaymentPolicyError);
    expect(t.ledger.get("job_1")).toBeUndefined();
  });

  it("does not submit or repay a paid review that fails integrity checks", async () => {
    const t = setup({
      buy: async (input, onSigned) => {
        onSigned({ jobId: input.job.jobId, transactionId: TX });
        throw new AuditIntegrityError("report digest mismatch", TX);
      },
    });
    expect((await runReview(t.deps, ref)).kind).toBe("invalid_review");
    expect((await runReview(t.deps, ref)).kind).toBe("invalid_review");
    expect(t.inputs).toHaveLength(1);
    expect(t.submitted).toHaveLength(0);
  });

  it("records ShipLock's rejection and never resubmits or repays it", async () => {
    const t = setup({ responses: [{ httpStatus: 422, body: { error: "paid_review_rejected", reasons: ["report reviewed a different diff"] } }] });
    expect(await runReview(t.deps, ref)).toMatchObject({ kind: "rejected", reasons: ["report reviewed a different diff"] });
    await runReview(t.deps, ref);
    expect(t.inputs).toHaveLength(1);
    expect(t.submitted).toHaveLength(1);
  });

  it("does not buy a review for a job that is not awaiting one", async () => {
    const t = setup({ job: { state: "stale" } });
    expect(await runReview(t.deps, ref)).toMatchObject({ kind: "not_awaiting_review", jobState: "stale" });
    expect(t.inputs).toHaveLength(0);
  });

  it("refuses a second payment record for the same job", () => {
    const ledger = new AgentLedger(":memory:");
    ledger.recordSigned("job_1", TX);
    expect(() => ledger.recordSigned("job_1", "0.0.1@1.2")).toThrow();
  });
});
