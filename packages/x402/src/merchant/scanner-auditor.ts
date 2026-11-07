/**
 * Merchant auditor = ShipLock's deterministic scanner over GitHub's compare diff for the exact
 * base...head SHAs. Same bytes + same SCANNER_VERSION => same digest ShipLock computes locally.
 */
import { createGitHubClient, type GitHubReader } from "@shiplock/github";
import { scanDiff } from "@shiplock/scanner";
import type { Auditor } from "../audit.ts";

export const VENDOR_ID = "shiplock-x402-audit";

export function createScannerAuditor(opts: { github?: Pick<GitHubReader, "getCompareDiff">; allowlist?: string[]; token?: string }): Auditor {
  const github = opts.github ?? createGitHubClient({ allowlist: opts.allowlist ?? [], token: opts.token });
  return async (job) => {
    const diff = await github.getCompareDiff(job.repository, job.baseSha, job.headSha);
    return scanDiff(job, diff).report;
  };
}
