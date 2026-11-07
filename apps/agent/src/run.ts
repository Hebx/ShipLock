import { HexShaSchema, ReviewJobSchema, Sha256HexSchema, type PaidReviewResult, type ReviewJob, type ReviewPurchaseGateway } from "@shiplock/shared";
import { AuditIntegrityError, AuditShaMismatchError, auditUrl, PaidButNotFulfilledError, PaymentUncertainError } from "@shiplock/x402";
import { z } from "zod";
import type { AgentLedger } from "./ledger.ts";

const JobSummarySchema = z.object({
  id: z.string().min(1),
  repositoryId: z.number().int().positive(),
  repository: z.string(),
  pullNumber: z.number().int().positive(),
  headSha: HexShaSchema,
  baseSha: HexShaSchema,
  scannerVersion: z.string(),
  state: z.string(),
  diffSha256: Sha256HexSchema.nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export interface SubmitResponse {
  httpStatus: number;
  body: { status?: string; jobState?: string; error?: string; reasons?: string[] };
}

export interface ShipLockClient {
  createJob(repository: string, pullNumber: number): Promise<JobSummary>;
  submitPaidReview(jobId: string, adapterId: string, result: PaidReviewResult): Promise<SubmitResponse>;
}

/** ShipLock's agent-facing API, authenticated with the agent bearer token. */
export function createShipLockClient(origin: string, agentToken: string, doFetch: typeof fetch = fetch): ShipLockClient {
  const call = async (path: string, body: unknown) => {
    const res = await doFetch(`${origin.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    return { httpStatus: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  return {
    async createJob(repository, pullNumber) {
      const r = await call("/api/reviews", { repository, pullNumber });
      if (r.httpStatus !== 201) throw new Error(`ShipLock refused the review job: ${r.httpStatus} ${String(r.body.error ?? "")}`);
      return JobSummarySchema.parse(r.body.job);
    },
    async submitPaidReview(jobId, adapterId, result) {
      return (await call(`/api/reviews/${encodeURIComponent(jobId)}/paid-review`, { adapterId, result })) as SubmitResponse;
    },
  };
}

export type OnSigned = (info: { jobId: string; transactionId: string }) => void;

export interface AgentDeps {
  shiplock: ShipLockClient;
  ledger: AgentLedger;
  /** Builds the buyer with the given hook; the hook must run before the signed payment is sent. */
  purchaser: (onSigned: OnSigned) => ReviewPurchaseGateway;
  adapterId: string;
  auditBaseUrl: string;
  maxTinybar: string;
  submitAttempts?: number;
  submitDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type RunOutcome =
  | { kind: "accepted"; jobId: string; transactionId: string; jobState?: string }
  | { kind: "ledger_pending"; jobId: string; transactionId: string }
  | { kind: "rejected"; jobId: string; transactionId: string; httpStatus: number; reasons: string[] }
  | { kind: "not_awaiting_review"; jobId: string; jobState: string }
  | { kind: "needs_reconcile"; jobId: string; transactionId: string; status: string; detail: string | null }
  | { kind: "invalid_review"; jobId: string; transactionId: string; detail: string | null };

/**
 * One autonomous review purchase for the PR's current head: ShipLock binds the job, the agent pays
 * at most once per job within `maxTinybar`, then hands the paid review to ShipLock for acceptance.
 * A payment whose outcome is unknown is never retried with a new payment.
 */
export async function runReview(deps: AgentDeps, ref: { repository: string; pullNumber: number }): Promise<RunOutcome> {
  const job = await deps.shiplock.createJob(ref.repository, ref.pullNumber);

  if (!deps.ledger.get(job.id)) {
    if (job.state !== "review_pending") return { kind: "not_awaiting_review", jobId: job.id, jobState: job.state };
    if (!job.diffSha256) throw new Error(`ShipLock has no diff digest for job ${job.id}`);
    await purchase(deps, job, job.diffSha256);
  }

  const entry = deps.ledger.get(job.id)!;
  switch (entry.status) {
    case "accepted":
      return { kind: "accepted", jobId: job.id, transactionId: entry.transactionId, jobState: job.state };
    case "invalid_review":
      return { kind: "invalid_review", jobId: job.id, transactionId: entry.transactionId, detail: entry.detail };
    case "rejected":
      return { kind: "rejected", jobId: job.id, transactionId: entry.transactionId, httpStatus: 0, reasons: entry.detail ? [entry.detail] : [] };
    case "paid":
      return submit(deps, job.id, entry.transactionId, JSON.parse(entry.resultJson!) as PaidReviewResult);
    default:
      return { kind: "needs_reconcile", jobId: job.id, transactionId: entry.transactionId, status: entry.status, detail: entry.detail };
  }
}

async function purchase(deps: AgentDeps, job: JobSummary, diffSha256: string): Promise<void> {
  const reviewJob: ReviewJob = ReviewJobSchema.parse({
    jobId: job.id,
    repositoryId: job.repositoryId,
    repository: job.repository,
    pullNumber: job.pullNumber,
    headSha: job.headSha,
    baseSha: job.baseSha,
    scannerVersion: job.scannerVersion,
  });
  const buyer = deps.purchaser(({ jobId, transactionId }) => deps.ledger.recordSigned(jobId, transactionId));
  try {
    const paid = await buyer.purchaseReview({
      job: reviewJob,
      expectedDiffSha256: diffSha256,
      reviewUrl: auditUrl(deps.auditBaseUrl, reviewJob, diffSha256),
      maxTinybar: deps.maxTinybar,
    });
    const { evidence: _evidence, ...result } = paid as PaidReviewResult & { evidence?: unknown };
    deps.ledger.update(job.id, "paid", { resultJson: JSON.stringify(result) });
  } catch (err) {
    if (!deps.ledger.get(job.id)) throw err; // nothing was signed, so no money moved
    const detail = err instanceof Error ? err.message.slice(0, 500) : String(err);
    if (err instanceof AuditShaMismatchError || err instanceof AuditIntegrityError) deps.ledger.update(job.id, "invalid_review", { detail });
    else if (err instanceof PaidButNotFulfilledError) deps.ledger.update(job.id, "paid_unfulfilled", { detail });
    else if (err instanceof PaymentUncertainError) deps.ledger.update(job.id, "uncertain", { detail });
    else deps.ledger.update(job.id, "signed", { detail });
  }
}

async function submit(deps: AgentDeps, jobId: string, transactionId: string, result: PaidReviewResult): Promise<RunOutcome> {
  const attempts = deps.submitAttempts ?? 6;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    const res = await deps.shiplock.submitPaidReview(jobId, deps.adapterId, result);
    if (res.httpStatus === 200) {
      deps.ledger.update(jobId, "accepted");
      return { kind: "accepted", jobId, transactionId, jobState: res.body.jobState };
    }
    if (res.httpStatus === 202) {
      if (i < attempts - 1) await sleep(deps.submitDelayMs ?? 5_000);
      continue;
    }
    if (res.httpStatus >= 500) return { kind: "ledger_pending", jobId, transactionId };
    const reasons = res.body.reasons ?? [res.body.error ?? `http_${res.httpStatus}`];
    deps.ledger.update(jobId, "rejected", { detail: reasons.join("; ").slice(0, 500) });
    return { kind: "rejected", jobId, transactionId, httpStatus: res.httpStatus, reasons };
  }
  return { kind: "ledger_pending", jobId, transactionId };
}
