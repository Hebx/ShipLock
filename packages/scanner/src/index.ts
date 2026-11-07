import {
  canonicalSha256,
  ReviewJobSchema,
  sha256Hex,
  type FindingSeverity,
  type ReviewFinding,
  type ReviewJob,
  type ReviewReport,
} from "@shiplock/shared";
import { parseUnifiedDiff } from "./diff.ts";
import { applyFileRules } from "./rules.ts";

export { parseUnifiedDiff, type DiffFile } from "./diff.ts";
export { RULE_IDS } from "./rules.ts";

/** Bump on any rule, parser or report-shape change: it is part of every review binding. */
export const SCANNER_VERSION = "shiplock-deterministic/0.1.0";

/** Diffs larger than this are not analyzed (conclusion: inconclusive). */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 500;

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export const STANDARD_LIMITATIONS = [
  "Heuristic pattern scan of added lines and changed paths only; not a security certification.",
  "No code from the pull request was executed.",
  "Removed code, transitive dependencies and runtime behaviour are not analyzed.",
];

export interface ScanOutput {
  report: ReviewReport;
  reportSha256: string;
}

/**
 * Produces the canonical report for the exact diff bytes of `job.baseSha...job.headSha`.
 * Deterministic: identical (job, diff, SCANNER_VERSION) always yield the same digest.
 */
export function scanDiff(job: ReviewJob, diffBytes: Uint8Array): ScanOutput {
  const parsedJob = ReviewJobSchema.parse(job);
  if (parsedJob.scannerVersion !== SCANNER_VERSION) {
    throw new Error(`job requests scanner ${parsedJob.scannerVersion}, this is ${SCANNER_VERSION}`);
  }
  const diffSha256 = sha256Hex(diffBytes);
  const limitations = [...STANDARD_LIMITATIONS];
  const findings: ReviewFinding[] = [];
  const stats = { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0 };
  let inconclusive = false;

  if (diffBytes.byteLength > MAX_DIFF_BYTES) {
    inconclusive = true;
    limitations.push(`Diff exceeds ${MAX_DIFF_BYTES} bytes and was not analyzed.`);
  } else {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(diffBytes);
    const files = parseUnifiedDiff(text);
    for (const file of files) {
      applyFileRules({ file, emit: (f) => findings.push(f) });
      stats.additions += file.added.length;
      stats.deletions += file.deletions;
      if (file.binary) stats.binaryFiles++;
      if (file.binary || file.unparsedPath) inconclusive = true;
    }
    stats.filesChanged = files.length;
    if (files.length === 0 && diffBytes.byteLength > 0) {
      inconclusive = true;
      limitations.push("Diff could not be parsed.");
    }
    if (stats.binaryFiles > 0) limitations.push("Binary files present; their contents were not analyzed.");
  }

  // Code-unit comparison, not localeCompare: ICU collation may differ between runtimes.
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      cmp(a.file, b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      cmp(a.ruleId, b.ruleId),
  );
  if (findings.length > MAX_FINDINGS) {
    findings.length = MAX_FINDINGS;
    inconclusive = true;
    limitations.push(`Findings truncated to ${MAX_FINDINGS}.`);
  }

  const blocking = findings.some((f) => f.severity === "critical" || f.severity === "high");
  const report: ReviewReport = {
    schema: "shiplock.review-report/v1",
    repositoryId: parsedJob.repositoryId,
    repository: parsedJob.repository,
    pullNumber: parsedJob.pullNumber,
    headSha: parsedJob.headSha,
    baseSha: parsedJob.baseSha,
    diffSha256,
    scannerVersion: SCANNER_VERSION,
    conclusion: blocking ? "block" : inconclusive ? "inconclusive" : "pass",
    findings,
    stats,
    limitations,
  };
  return { report, reportSha256: canonicalSha256(report) };
}
