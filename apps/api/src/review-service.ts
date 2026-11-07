import type { GitHubReader } from "@shiplock/github";
import { SCANNER_VERSION, scanDiff } from "@shiplock/scanner";
import { TERMINAL_STATES, type ReviewJob } from "@shiplock/shared";
import { transaction, type Db } from "./db/index.ts";
import {
  ConflictError,
  findJob,
  getJob,
  insertJob,
  invalidateOpenAuthorizations,
  recordEvent,
  saveLocalReport,
  StaleHeadError,
  staleOtherHeads,
  transitionJob,
  upsertPullRequest,
  upsertRepository,
  type ReviewJobRow,
} from "./store.ts";

export interface ReviewDeps {
  db: Db;
  github: GitHubReader;
}

export function toReviewJob(row: ReviewJobRow): ReviewJob {
  return {
    jobId: row.id,
    repositoryId: row.repository_id,
    repository: row.repository,
    pullNumber: row.pull_number,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    scannerVersion: row.scanner_version,
  };
}

/**
 * Reads the live PR and returns the review job bound to its current head SHA, creating it if
 * needed. Jobs for any previous head of the same PR become `stale` and lose their authorizations.
 */
export async function syncPullRequest(deps: ReviewDeps, repository: string, pullNumber: number): Promise<ReviewJobRow> {
  const repo = await deps.github.getRepository(repository);
  const pr = await deps.github.getPullRequest(repo.fullName, pullNumber);
  if (pr.repositoryId !== repo.id) throw new ConflictError("pull request belongs to a different repository id");

  const job = transaction(deps.db, () => {
    upsertRepository(deps.db, repo.id, repo.fullName);
    const prId = upsertPullRequest(deps.db, pr);
    staleOtherHeads(deps.db, prId, pr.headSha);

    const existing = findJob(deps.db, repo.id, pr.number, pr.headSha, SCANNER_VERSION);
    if (pr.state !== "open" || pr.merged) {
      // merge_in_progress / reconcile_required are resolved by the merge executor, not here.
      if (existing && !TERMINAL_STATES.has(existing.state) && existing.state !== "merge_in_progress" && existing.state !== "reconcile_required") {
        transitionJob(deps.db, existing.id, "invalid", pr.merged ? "merged outside ShipLock" : "pull request closed");
        invalidateOpenAuthorizations(deps.db, existing.id, "pull request not open");
      }
      return null;
    }
    if (existing) return existing;
    return insertJob(deps.db, {
      pull_request_id: prId,
      repository_id: repo.id,
      repository: repo.fullName,
      pull_number: pr.number,
      head_sha: pr.headSha,
      base_sha: pr.baseSha,
      base_ref: pr.baseRef,
      scanner_version: SCANNER_VERSION,
    });
  });
  if (!job) throw new ConflictError(pr.merged ? "pull request already merged" : "pull request is closed");
  return job;
}

/**
 * ShipLock's own deterministic analysis of the job's exact `base...head` diff. Used to show
 * findings and to independently cross-check the digest of a purchased review. It is not the
 * paid review and never advances the job past `review_pending`.
 */
export async function analyzeJob(deps: ReviewDeps, jobId: string): Promise<ReviewJobRow> {
  const job = getJob(deps.db, jobId);
  if (!job) throw new ConflictError(`unknown job ${jobId}`);
  if (job.state !== "discovered" && job.state !== "review_pending") {
    throw new ConflictError(`job is ${job.state}; analysis only runs before the paid review is accepted`);
  }

  const live = await deps.github.getPullRequest(job.repository, job.pull_number);
  if (live.headSha !== job.head_sha) {
    await syncPullRequest(deps, job.repository, job.pull_number).catch(() => undefined);
    throw new StaleHeadError(job.id, job.head_sha, live.headSha);
  }

  const diff = await deps.github.getCompareDiff(job.repository, job.base_sha, job.head_sha);
  const { report, reportSha256 } = scanDiff(toReviewJob(job), diff);

  return transaction(deps.db, () => {
    const current = getJob(deps.db, jobId)!;
    if (current.state !== "discovered" && current.state !== "review_pending") {
      throw new ConflictError(`job moved to ${current.state} during analysis`);
    }
    saveLocalReport(deps.db, jobId, report, reportSha256);
    if (current.state === "discovered") transitionJob(deps.db, jobId, "review_pending", "awaiting paid review");
    else recordEvent(deps.db, "review.local_analysis_repeated", jobId, { reportSha256 });
    return getJob(deps.db, jobId)!;
  });
}
