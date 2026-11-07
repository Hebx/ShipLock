/**
 * Merchant conformance against Cursor's M2 live evidence (no payment).
 * For each demo PR: the merchant must (a) quote with extra.shiplock = {job, diffSha256} and
 * (b) its auditor must reproduce ShipLock's recorded report digest byte for byte.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm --filter @shiplock/x402 conformance
 */
import { createGitHubClient } from "@shiplock/github";
import { SCANNER_VERSION } from "@shiplock/scanner";
import { sha256Hex, type ReviewJob } from "@shiplock/shared";
import { createScannerAuditor, reportDigest } from "../src/index.ts";

const REPO = "Hebx/shiplock-demo-target";
const EXPECTED = [
  // from docs/evidence/github/m2-demo-pr{1,2}.json (Cursor, 5e8133c)
  { pr: 1, head: "d0cbdfd3cc1dddb80cbc657b0dbe52abb7d1b0cf", diff: "e6ec27c0e888101fd3e8c9355975c2d8ce2ef935e9f6f4224f65b6c2eda0023c", report: "ca41051e5fe5f497401ac44299662d3ba94d8546e85fa5c2555488194b3a56fc", conclusion: "pass" },
  { pr: 2, head: "67969975c4a7d2c3e9c36b77e1adf9eee180a97d", diff: "61fec8a240536b852edd9b1df55c1dcd4b1f6a61b82fa7b31b2b8b1470a749c4", report: "049efd7419b6ca72c3f10a0a24dd2d8838eb1a8c5943c9aedbd50a0aa446518a", conclusion: "block" },
];

const github = createGitHubClient({ allowlist: [REPO], token: process.env.GITHUB_TOKEN });
const auditor = createScannerAuditor({ github });
let failed = 0;
for (const e of EXPECTED) {
  const pull = await github.getPullRequest(REPO, e.pr);
  const job: ReviewJob = { jobId: `conformance-${e.pr}`, repositoryId: pull.repositoryId, repository: REPO, pullNumber: e.pr, headSha: pull.headSha, baseSha: pull.baseSha, scannerVersion: SCANNER_VERSION };
  const diff = sha256Hex(await github.getCompareDiff(REPO, job.baseSha, job.headSha));
  const report = await auditor(job);
  const got = reportDigest(report);
  const ok = pull.headSha === e.head && diff === e.diff && report.diffSha256 === e.diff && got === e.report && report.conclusion === e.conclusion;
  if (!ok) failed++;
  console.log(JSON.stringify({ pr: e.pr, ok, head: pull.headSha === e.head, diff: diff === e.diff, reportSha256: got, expected: e.report, conclusion: report.conclusion, findings: report.findings.map((f) => `${f.severity}:${f.ruleId}`) }));
}
process.exit(failed ? 1 : 0);
