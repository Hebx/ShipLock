/**
 * Development only: submit a SIMULATED paid review for a job through the running API, so the
 * World ID approval UI can be exercised before the live x402 payment is wired in:
 *   pnpm --filter @shiplock/api simulate-paid-review <jobId>
 * The API accepts it only when SHIPLOCK_ACCEPTED_EVIDENCE includes "simulated", labels it as
 * simulated everywhere, and never merges a job whose paid review is simulated.
 */
import type { PaidReviewResult, ReviewReport } from "@shiplock/shared";
import { loadConfig } from "../config.ts";
import { openDatabase } from "../db/index.ts";
import { getJob } from "../store.ts";

const jobId = process.argv[2] ?? "";
const config = loadConfig();
const job = jobId ? getJob(openDatabase(config.databasePath), jobId) : undefined;
if (!job?.local_report_json || !job.local_report_sha256) {
  console.error("usage: pnpm --filter @shiplock/api simulate-paid-review <jobId>  (job must be analyzed)");
  process.exit(2);
}
if (!config.paidReview || !config.agentToken) {
  console.error("paid reviews and SHIPLOCK_AGENT_TOKEN must be configured");
  process.exit(2);
}

const now = Date.now();
const result: PaidReviewResult = {
  jobId: job.id,
  repositoryId: job.repository_id,
  pullNumber: job.pull_number,
  headSha: job.head_sha,
  reportSha256: job.local_report_sha256,
  report: JSON.parse(job.local_report_json) as ReviewReport,
  network: config.paidReview.network,
  asset: config.paidReview.asset,
  amountBaseUnits: config.paidReview.quotedTinybar,
  payerAccountId: "0.0.2",
  merchantAccountId: config.paidReview.merchantAccountId,
  // Not a ledger transaction; it only has to be unique and well-formed.
  hederaTransactionId: `0.0.2@${Math.floor(now / 1000)}.${String((now % 1000) * 1_000_000).padStart(9, "0")}`,
  settlementConfirmed: true,
  evidenceKind: "simulated",
  vendorId: "shiplock-simulated-local",
  scannerVersion: job.scanner_version,
};

const res = await fetch(`http://127.0.0.1:${config.port}/api/reviews/${encodeURIComponent(job.id)}/paid-review`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentToken}` },
  body: JSON.stringify({ adapterId: "simulated-local-cli", result }),
});
console.log(res.status, JSON.stringify(await res.json()));
