import { randomUUID } from "node:crypto";
import type { ReviewFinding, ReviewReport } from "@shiplock/shared";
import { assertTransition, TERMINAL_STATES, type ReleaseState } from "@shiplock/shared";
import type { PullRequestSnapshot } from "@shiplock/github";
import type { Db } from "./db/index.ts";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const now = () => new Date().toISOString();

export interface ReviewJobRow {
  id: string;
  pull_request_id: string;
  repository_id: number;
  repository: string;
  pull_number: number;
  head_sha: string;
  base_sha: string;
  base_ref: string;
  scanner_version: string;
  state: ReleaseState;
  state_reason: string | null;
  diff_sha256: string | null;
  local_report_sha256: string | null;
  local_report_json: string | null;
  local_conclusion: string | null;
  created_at: string;
  updated_at: string;
}

export interface PullRequestRow {
  id: string;
  repository_id: number;
  repository: string;
  number: number;
  title: string;
  html_url: string;
  author_login: string | null;
  base_ref: string;
  state: "open" | "closed";
  merged: number;
  latest_head_sha: string;
  last_synced_at: string;
}

export class StaleHeadError extends Error {
  constructor(
    readonly jobId: string,
    readonly expectedSha: string,
    readonly currentSha: string,
  ) {
    super(`pull request head moved from ${expectedSha} to ${currentSha}`);
    this.name = "StaleHeadError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export function recordEvent(
  db: Db,
  type: string,
  reviewJobId: string | null,
  detail: Record<string, string | number | boolean | null>,
  correlationId: string | null = null,
): void {
  db.prepare("INSERT INTO audit_events (at, type, review_job_id, correlation_id, detail_json) VALUES (?, ?, ?, ?, ?)").run(
    now(),
    type,
    reviewJobId,
    correlationId,
    JSON.stringify(detail),
  );
}

export function upsertRepository(db: Db, id: number, fullName: string): void {
  const existing = db.prepare("SELECT id FROM repositories WHERE full_name = ? COLLATE NOCASE").get(fullName);
  if (existing && Number(existing.id) !== id) {
    // Same name, different immutable id: the repository was deleted and recreated. Fail closed.
    throw new ConflictError(`repository ${fullName} id changed from ${existing.id} to ${id}`);
  }
  db.prepare(
    "INSERT INTO repositories (id, full_name, first_seen_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name",
  ).run(id, fullName, now());
}

export function upsertPullRequest(db: Db, pr: PullRequestSnapshot): string {
  const existing = db
    .prepare("SELECT id FROM pull_requests WHERE repository_id = ? AND number = ?")
    .get(pr.repositoryId, pr.number);
  const id = existing ? String(existing.id) : newId("pr");
  db.prepare(
    `INSERT INTO pull_requests (id, repository_id, number, title, html_url, author_login, base_ref, state, merged, latest_head_sha, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (repository_id, number) DO UPDATE SET
       title = excluded.title, html_url = excluded.html_url, author_login = excluded.author_login,
       base_ref = excluded.base_ref, state = excluded.state, merged = excluded.merged,
       latest_head_sha = excluded.latest_head_sha, last_synced_at = excluded.last_synced_at`,
  ).run(id, pr.repositoryId, pr.number, pr.title, pr.htmlUrl, pr.authorLogin, pr.baseRef, pr.state, pr.merged ? 1 : 0, pr.headSha, now());
  return id;
}

export function getJob(db: Db, id: string): ReviewJobRow | undefined {
  return db.prepare("SELECT * FROM review_jobs WHERE id = ?").get(id) as ReviewJobRow | undefined;
}

export function findJob(db: Db, repositoryId: number, pullNumber: number, headSha: string, scannerVersion: string) {
  return db
    .prepare("SELECT * FROM review_jobs WHERE repository_id = ? AND pull_number = ? AND head_sha = ? AND scanner_version = ?")
    .get(repositoryId, pullNumber, headSha, scannerVersion) as ReviewJobRow | undefined;
}

export function insertJob(
  db: Db,
  job: Pick<ReviewJobRow, "pull_request_id" | "repository_id" | "repository" | "pull_number" | "head_sha" | "base_sha" | "base_ref" | "scanner_version">,
): ReviewJobRow {
  const id = newId("job");
  const at = now();
  db.prepare(
    `INSERT INTO review_jobs (id, pull_request_id, repository_id, repository, pull_number, head_sha, base_sha, base_ref, scanner_version, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?)`,
  ).run(id, job.pull_request_id, job.repository_id, job.repository, job.pull_number, job.head_sha, job.base_sha, job.base_ref, job.scanner_version, at, at);
  recordEvent(db, "job.discovered", id, { headSha: job.head_sha, baseSha: job.base_sha });
  return getJob(db, id)!;
}

/**
 * Compare-and-set state transition. Validates against the state machine and fails if another
 * writer moved the job first. Callers must hold a transaction.
 */
export function transitionJob(db: Db, jobId: string, to: ReleaseState, reason: string | null = null): ReviewJobRow {
  const job = getJob(db, jobId);
  if (!job) throw new ConflictError(`unknown job ${jobId}`);
  assertTransition(job.state, to);
  const res = db
    .prepare("UPDATE review_jobs SET state = ?, state_reason = ?, updated_at = ? WHERE id = ? AND state = ?")
    .run(to, reason, now(), jobId, job.state);
  if (Number(res.changes) !== 1) throw new ConflictError(`job ${jobId} changed concurrently`);
  recordEvent(db, "job.state", jobId, { from: job.state, to, reason });
  return getJob(db, jobId)!;
}

/** Marks every non-terminal job of a PR whose head is not `currentHeadSha` as stale. */
export function staleOtherHeads(db: Db, pullRequestId: string, currentHeadSha: string): string[] {
  const rows = db
    .prepare("SELECT id, state FROM review_jobs WHERE pull_request_id = ? AND head_sha != ?")
    .all(pullRequestId, currentHeadSha) as Array<{ id: string; state: ReleaseState }>;
  const staled: string[] = [];
  for (const row of rows) {
    if (TERMINAL_STATES.has(row.state)) continue;
    // merge_in_progress / reconcile_required are resolved by reading GitHub, not by sync.
    if (row.state === "merge_in_progress" || row.state === "reconcile_required") continue;
    transitionJob(db, row.id, "stale", `head moved to ${currentHeadSha}`);
    invalidateOpenAuthorizations(db, row.id, "head SHA changed");
    staled.push(row.id);
  }
  return staled;
}

export function invalidateOpenAuthorizations(db: Db, jobId: string, reason: string): number {
  const res = db
    .prepare(
      "UPDATE merge_authorizations SET status = 'invalidated', status_reason = ?, updated_at = ? WHERE review_job_id = ? AND status IN ('pending', 'approved')",
    )
    .run(reason, now(), jobId);
  const n = Number(res.changes);
  if (n > 0) recordEvent(db, "authorization.invalidated", jobId, { count: n, reason });
  return n;
}

export function saveLocalReport(db: Db, jobId: string, report: ReviewReport, reportSha256: string): void {
  db.prepare(
    "UPDATE review_jobs SET diff_sha256 = ?, local_report_sha256 = ?, local_report_json = ?, local_conclusion = ?, updated_at = ? WHERE id = ?",
  ).run(report.diffSha256, reportSha256, JSON.stringify(report), report.conclusion, now(), jobId);
  db.prepare("DELETE FROM review_findings WHERE review_job_id = ? AND source = 'local'").run(jobId);
  const insert = db.prepare(
    "INSERT INTO review_findings (review_job_id, source, rule_id, severity, file, line, description, evidence) VALUES (?, 'local', ?, ?, ?, ?, ?, ?)",
  );
  for (const f of report.findings) insertFinding(insert, jobId, f);
  recordEvent(db, "review.local_analysis", jobId, {
    reportSha256,
    diffSha256: report.diffSha256,
    conclusion: report.conclusion,
    findings: report.findings.length,
  });
}

function insertFinding(stmt: ReturnType<Db["prepare"]>, jobId: string, f: ReviewFinding) {
  stmt.run(jobId, f.ruleId, f.severity, f.file, f.line ?? null, f.description, f.evidence ?? null);
}

export function listPullRequests(db: Db) {
  return db
    .prepare(
      `SELECT p.*, r.full_name AS repository,
         (SELECT j.id FROM review_jobs j WHERE j.pull_request_id = p.id ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1) AS latest_job_id
       FROM pull_requests p JOIN repositories r ON r.id = p.repository_id
       ORDER BY p.last_synced_at DESC`,
    )
    .all() as unknown as Array<PullRequestRow & { latest_job_id: string | null }>;
}

export function listJobsForPullRequest(db: Db, pullRequestId: string): ReviewJobRow[] {
  return db
    .prepare("SELECT * FROM review_jobs WHERE pull_request_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(pullRequestId) as unknown as ReviewJobRow[];
}

export function listFindings(db: Db, jobId: string) {
  return db
    .prepare("SELECT source, rule_id, severity, file, line, description, evidence FROM review_findings WHERE review_job_id = ? ORDER BY id")
    .all(jobId);
}

export function listEvents(db: Db, jobId: string) {
  return db
    .prepare("SELECT id, at, type, detail_json FROM audit_events WHERE review_job_id = ? ORDER BY id")
    .all(jobId)
    .map((e) => ({ id: e.id, at: e.at, type: e.type, detail: JSON.parse(String(e.detail_json)) as unknown }));
}

export function getReceipt(db: Db, jobId: string) {
  return db.prepare("SELECT * FROM payment_receipts WHERE review_job_id = ?").get(jobId);
}
