/**
 * Analyze one real pull request end to end without the HTTP layer:
 *   pnpm analyze owner/repo#123
 * Prints a sanitized evidence record (no tokens, no diff content beyond redacted findings).
 */
import { createGitHubClient } from "@shiplock/github";
import { PullRefSchema } from "@shiplock/shared";
import { loadConfig } from "../config.ts";
import { openDatabase } from "../db/index.ts";
import { analyzeJob, syncPullRequest } from "../review-service.ts";
import { getJob, listJobsForPullRequest } from "../store.ts";

const arg = process.argv[2] ?? "";
const match = /^([^#]+)#(\d+)$/.exec(arg);
if (!match) {
  console.error("usage: pnpm analyze owner/repo#123");
  process.exit(2);
}
const ref = PullRefSchema.parse({ repository: match[1], pullNumber: Number(match[2]) });

const config = loadConfig();
const db = openDatabase(config.databasePath);
const github = createGitHubClient({ token: config.githubToken, allowlist: config.allowlist });

const synced = await syncPullRequest({ db, github }, ref.repository, ref.pullNumber);
const job = synced.state === "discovered" || synced.state === "review_pending" ? await analyzeJob({ db, github }, synced.id) : synced;
const row = getJob(db, job.id)!;
const report = row.local_report_json ? (JSON.parse(row.local_report_json) as { conclusion: string; findings: unknown[]; stats: unknown }) : null;

console.log(
  JSON.stringify(
    {
      evidenceKind: "live-github-read",
      analyzedAt: new Date().toISOString(),
      repository: row.repository,
      repositoryId: row.repository_id,
      pullNumber: row.pull_number,
      headSha: row.head_sha,
      baseSha: row.base_sha,
      scannerVersion: row.scanner_version,
      diffSha256: row.diff_sha256,
      reportSha256: row.local_report_sha256,
      conclusion: report?.conclusion,
      stats: report?.stats,
      findings: report?.findings,
      jobId: row.id,
      jobState: row.state,
      otherHeads: listJobsForPullRequest(db, row.pull_request_id)
        .filter((j) => j.id !== row.id)
        .map((j) => ({ jobId: j.id, headSha: j.head_sha, state: j.state, reportSha256: j.local_report_sha256 })),
    },
    null,
    2,
  ),
);
