import { MergeOutcomeUnknownError, RepositoryNotAllowedError, type PullRequestSnapshot } from "@shiplock/github";
import type { MergeOperation } from "@shiplock/policy";
import type { ReleaseState } from "@shiplock/shared";
import type { Hono } from "hono";
import { assertRepoPermission } from "./access.ts";
import type { AppDeps, AppEnv } from "./app.ts";
import { requireMaintainer, type SessionRow } from "./auth.ts";
import { expireIfDue, getAuthorization, receiptProblem, storedOperation, type ReceiptRow } from "./authorizations.ts";
import { transaction } from "./db/index.ts";
import { ApiError } from "./errors.ts";
import { syncPullRequest } from "./review-service.ts";
import { getJob, getReceipt, newId, recordEvent, transitionJob } from "./store.ts";

/** A human approval older than this cannot be executed even if the operation has not expired. */
export const APPROVAL_MAX_AGE_MS = 10 * 60 * 1000;
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export interface MergeAttemptRow {
  id: string;
  authorization_id: string;
  review_job_id: string;
  expected_sha: string;
  status: "in_progress" | "merged" | "blocked" | "failed" | "uncertain";
  github_http_status: number | null;
  merge_commit_sha: string | null;
  merge_url: string | null;
  reason: string | null;
  started_at: string;
  completed_at: string | null;
}

const now = () => new Date().toISOString();

class Blocked extends Error {
  constructor(
    readonly reason: string,
    readonly jobState: ReleaseState = "paid_review_confirmed",
  ) {
    super(reason);
  }
}

export function getMergeAttempt(deps: AppDeps, authorizationId: string): MergeAttemptRow | undefined {
  return deps.db.prepare("SELECT * FROM merge_attempts WHERE authorization_id = ?").get(authorizationId) as MergeAttemptRow | undefined;
}

export function publicMergeAttempt(a: MergeAttemptRow) {
  return {
    authorizationId: a.authorization_id,
    expectedSha: a.expected_sha,
    status: a.status,
    githubHttpStatus: a.github_http_status,
    mergeCommitSha: a.merge_commit_sha,
    mergeUrl: a.merge_url,
    reason: a.reason,
    startedAt: a.started_at,
    completedAt: a.completed_at,
  };
}

function finish(deps: AppDeps, attempt: { id: string; jobId: string; authorizationId: string }, status: MergeAttemptRow["status"], jobState: ReleaseState, fields: { reason?: string; httpStatus?: number; mergeCommitSha?: string; mergeUrl?: string }) {
  transaction(deps.db, () => {
    deps.db
      .prepare(
        "UPDATE merge_attempts SET status = ?, reason = ?, github_http_status = ?, merge_commit_sha = ?, merge_url = ?, completed_at = ? WHERE id = ?",
      )
      .run(status, fields.reason ?? null, fields.httpStatus ?? null, fields.mergeCommitSha ?? null, fields.mergeUrl ?? null, status === "uncertain" ? null : now(), attempt.id);
    const job = getJob(deps.db, attempt.jobId)!;
    if (job.state !== jobState) transitionJob(deps.db, attempt.jobId, jobState, fields.reason ?? status);
    if (status === "merged") deps.db.prepare("UPDATE pull_requests SET state = 'closed', merged = 1 WHERE id = ?").run(job.pull_request_id);
    recordEvent(deps.db, `merge.${status}`, attempt.jobId, { authorizationId: attempt.authorizationId, reason: fields.reason ?? null, httpStatus: fields.httpStatus ?? null, mergeCommitSha: fields.mergeCommitSha ?? null }, attempt.authorizationId);
  });
}

/** Every gate re-evaluated against live GitHub after the approval was consumed. Throws `Blocked`. */
async function preMergeChecks(deps: AppDeps, op: MergeOperation, session: SessionRow): Promise<PullRequestSnapshot> {
  let pr: PullRequestSnapshot;
  try {
    await assertRepoPermission(deps, op.repository, { id: session.github_user_id, login: session.github_login });
    pr = await deps.github.getPullRequest(op.repository, op.pullNumber);
  } catch (err) {
    if (err instanceof RepositoryNotAllowedError) throw new Blocked("repository_not_allowed", "failed");
    if (err instanceof ApiError) throw new Blocked(err.code);
    throw new Blocked("github_unavailable");
  }
  if (pr.repositoryId !== op.repositoryId) throw new Blocked("repository_id_changed", "failed");
  if (pr.state !== "open" || pr.merged) throw new Blocked("pull_request_not_open", "failed");
  if (pr.headSha !== op.headSha) throw new Blocked("head_sha_changed", "stale");
  if (pr.baseRef !== op.baseRef) throw new Blocked("base_ref_changed");
  if (pr.mergeable === false || pr.mergeableState === "dirty") throw new Blocked("not_mergeable");

  try {
    const [runs, status, rules] = await Promise.all([
      deps.github.listCheckRuns(op.repository, op.headSha),
      deps.github.getCombinedStatus(op.repository, op.headSha),
      deps.github.getBranchRules(op.repository, op.baseRef),
    ]);
    const failing = runs.filter((r) => r.status !== "completed" || !PASSING_CONCLUSIONS.has(r.conclusion ?? ""));
    if (failing.length > 0) throw new Blocked(`checks_not_green:${failing.map((r) => r.name).join(",").slice(0, 200)}`);
    if (status.totalCount > 0 && status.state !== "success") throw new Blocked(`commit_status_${status.state}`);
    const passed = new Set([
      ...runs.filter((r) => PASSING_CONCLUSIONS.has(r.conclusion ?? "")).map((r) => r.name),
      ...status.statuses.filter((s) => s.state === "success").map((s) => s.context),
    ]);
    for (const rule of rules) {
      if (rule.type !== "required_status_checks") continue;
      const required = (rule.parameters as { required_status_checks?: Array<{ context?: unknown }> } | undefined)?.required_status_checks ?? [];
      const missing = required.map((r) => String(r.context)).filter((ctx) => !passed.has(ctx));
      if (missing.length > 0) throw new Blocked(`required_checks_missing:${missing.join(",").slice(0, 200)}`);
    }
  } catch (err) {
    if (err instanceof Blocked) throw err;
    throw new Blocked("checks_unavailable");
  }
  return pr;
}

/** Resolves an unknown merge outcome by reading the PR. Never re-sends the merge. */
async function reconcile(deps: AppDeps, attempt: MergeAttemptRow, op: MergeOperation) {
  const ids = { id: attempt.id, jobId: attempt.review_job_id, authorizationId: attempt.authorization_id };
  const pr = await deps.github.getPullRequest(op.repository, op.pullNumber).catch(() => null);
  if (!pr) return;
  if (pr.merged) {
    if (pr.headSha === op.headSha && pr.mergeCommitSha) {
      finish(deps, ids, "merged", "merged", { reason: "reconciled", mergeCommitSha: pr.mergeCommitSha, mergeUrl: pr.htmlUrl });
    } else {
      finish(deps, ids, "failed", "failed", { reason: "merged_with_unexpected_head" });
    }
  } else if (pr.state === "closed") {
    finish(deps, ids, "failed", "failed", { reason: "pull_request_closed" });
  } else if (pr.headSha !== op.headSha) {
    finish(deps, ids, "blocked", "stale", { reason: "head_sha_changed" });
  }
  // Open, same head, not merged: still unknown. Stay reconcile_required.
}

export function registerMergeRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  app.post("/api/merges/:authorizationId/execute", requireMaintainer(deps), async (c) => {
    const session = c.get("session");
    const authorizationId = c.req.param("authorizationId");

    // Consume the approval and claim the single merge attempt atomically, before any network call.
    const claimed = transaction(deps.db, () => {
      const found = getAuthorization(deps.db, authorizationId);
      if (!found) throw new ApiError(404, "not_found");
      if (found.github_user_id !== session.github_user_id) throw new ApiError(403, "not_your_authorization");
      const auth = expireIfDue(deps.db, found);
      if (auth.status === "consumed") throw new ApiError(409, "authorization_already_used");
      if (auth.status !== "approved") throw new ApiError(409, "authorization_not_approved", { status: auth.status });
      const op = storedOperation(auth);
      if (!auth.approved_at || Date.now() - Date.parse(auth.approved_at) > APPROVAL_MAX_AGE_MS) throw new ApiError(409, "approval_not_fresh");
      const job = getJob(deps.db, auth.review_job_id)!;
      if (job.state !== "approved" || job.head_sha !== op.headSha) throw new ApiError(409, "job_not_approved", { state: job.state });

      const consumed = deps.db
        .prepare("UPDATE merge_authorizations SET status = 'consumed', consumed_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'")
        .run(now(), now(), auth.id);
      if (Number(consumed.changes) !== 1) throw new ApiError(409, "authorization_already_used");
      const attemptId = newId("ma");
      deps.db
        .prepare("INSERT INTO merge_attempts (id, authorization_id, review_job_id, expected_sha, status, started_at) VALUES (?, ?, ?, ?, 'in_progress', ?)")
        .run(attemptId, auth.id, job.id, op.headSha, now());
      transitionJob(deps.db, job.id, "merge_in_progress", "approval consumed");
      recordEvent(deps.db, "merge.started", job.id, { authorizationId: auth.id, expectedSha: op.headSha }, auth.id);
      return { op, ids: { id: attemptId, jobId: job.id, authorizationId: auth.id } };
    });
    const { op, ids } = claimed;
    const result = () => c.json({ mergeAttempt: publicMergeAttempt(getMergeAttempt(deps, authorizationId)!), jobState: getJob(deps.db, ids.jobId)!.state });

    let pr: PullRequestSnapshot;
    try {
      const receipt = getReceipt(deps.db, ids.jobId) as ReceiptRow | undefined;
      const problem = receiptProblem(receipt, deps.config.paidReview?.acceptedEvidence ?? []);
      if (problem) throw new Blocked(problem, "failed");
      if (receipt!.evidence_kind === "simulated") throw new Blocked("simulated_paid_review_cannot_merge", "failed");
      if (receipt!.report_sha256 !== op.reportSha256) throw new Blocked("paid_review_digest_mismatch", "failed");
      pr = await preMergeChecks(deps, op, session);
    } catch (err) {
      if (!(err instanceof Blocked)) throw err;
      finish(deps, ids, "blocked", err.jobState, { reason: err.reason });
      if (err.jobState === "stale") await syncPullRequest(deps, op.repository, op.pullNumber).catch(() => undefined);
      return result();
    }

    try {
      const outcome = await deps.github.mergePullRequest(op.repository, op.pullNumber, op.headSha, op.mergeMethod);
      if (outcome.kind === "merged") {
        finish(deps, ids, "merged", "merged", { httpStatus: 200, mergeCommitSha: outcome.mergeCommitSha, mergeUrl: pr.htmlUrl });
      } else if (outcome.kind === "head_changed") {
        finish(deps, ids, "blocked", "stale", { reason: "github_rejected_changed_head", httpStatus: 409 });
        await syncPullRequest(deps, op.repository, op.pullNumber).catch(() => undefined);
      } else if (outcome.httpStatus === 405 || outcome.httpStatus === 422) {
        finish(deps, ids, "blocked", "paid_review_confirmed", { reason: `github_refused_merge_${outcome.httpStatus}`, httpStatus: outcome.httpStatus });
      } else {
        finish(deps, ids, "failed", "failed", { reason: `github_http_${outcome.httpStatus}`, httpStatus: outcome.httpStatus });
      }
    } catch (err) {
      if (!(err instanceof MergeOutcomeUnknownError)) throw err;
      finish(deps, ids, "uncertain", "reconcile_required", { reason: err.detail });
      await reconcile(deps, getMergeAttempt(deps, authorizationId)!, op);
    }
    return result();
  });

  app.post("/api/merges/:authorizationId/reconcile", requireMaintainer(deps), async (c) => {
    const session = c.get("session");
    const auth = getAuthorization(deps.db, c.req.param("authorizationId"));
    if (!auth) throw new ApiError(404, "not_found");
    if (auth.github_user_id !== session.github_user_id) throw new ApiError(403, "not_your_authorization");
    const attempt = getMergeAttempt(deps, auth.id);
    if (!attempt || attempt.status !== "uncertain") throw new ApiError(409, "nothing_to_reconcile");
    await reconcile(deps, attempt, storedOperation(auth));
    return c.json({ mergeAttempt: publicMergeAttempt(getMergeAttempt(deps, auth.id)!), jobState: getJob(deps.db, auth.review_job_id)!.state });
  });
}
