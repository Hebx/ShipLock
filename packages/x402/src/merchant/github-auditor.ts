/**
 * Minimal deterministic auditor used by the payment merchant so the paid response is a real
 * analysis of bytes at an exact commit (GitHub tarball API by SHA, never a branch name).
 *
 * Cursor's packages/scanner is the product scanner; this exists so the x402 subsystem can be
 * proven end-to-end without the app. Heuristic findings only — not a security certification.
 */
import type { ReviewFinding } from "../../../shared/src/contracts.ts";
import type { Auditor } from "../audit.ts";

export const VENDOR_ID = "shiplock-x402-reference-auditor";
export const SCANNER_VERSION = "ref-rules-0.1.0";

interface Rule {
  id: string;
  severity: ReviewFinding["severity"];
  re: RegExp;
  description: string;
}

const RULES: Rule[] = [
  { id: "secret.private-key-block", severity: "critical", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, description: "PEM private key committed" },
  { id: "secret.hex-private-key-assignment", severity: "high", re: /(?:PRIVATE_KEY|privateKey|secret)\s*[:=]\s*["'](?:0x)?[0-9a-fA-F]{64}["']/, description: "Hard-coded 32-byte hex secret" },
  { id: "secret.github-token", severity: "critical", re: /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, description: "GitHub token literal" },
  { id: "exec.shell-interpolation", severity: "high", re: /\b(?:exec|execSync|spawn)\s*\(\s*`[^`]*\$\{/, description: "Shell command built with template interpolation" },
  { id: "exec.eval", severity: "medium", re: /\beval\s*\(|new\s+Function\s*\(/, description: "Dynamic code evaluation" },
  { id: "ci.pull-request-target", severity: "high", re: /pull_request_target/, description: "Workflow runs with secrets on untrusted PR code" },
  { id: "tls.reject-unauthorized-off", severity: "medium", re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/, description: "TLS verification disabled" },
];

const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|ya?ml|sol|py|go|rs|sh|md|toml|env|txt)$/i;

export function scanText(path: string, text: string): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) out.push({ ruleId: r.id, severity: r.severity, file: path, line: i + 1, description: r.description });
  });
  return out;
}

export function createGithubAuditor(opts: { token?: string; fetchImpl?: typeof fetch; maxFiles?: number } = {}): Auditor {
  const f = opts.fetchImpl ?? fetch;
  const maxFiles = opts.maxFiles ?? 400;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "shiplock-audit" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  return async (job) => {
    // Tree by exact SHA (immutable), then blobs by sha.
    const treeRes = await f(`https://api.github.com/repos/${job.repository}/git/trees/${job.headSha}?recursive=1`, { headers });
    if (!treeRes.ok) throw new Error(`github tree ${treeRes.status} for ${job.repository}@${job.headSha}`);
    const tree = (await treeRes.json()) as { sha: string; truncated: boolean; tree: Array<{ path: string; type: string; sha: string; size?: number }> };
    const blobs = tree.tree.filter((e) => e.type === "blob" && TEXT_EXT.test(e.path) && (e.size ?? 0) < 512_000).slice(0, maxFiles);
    const findings: ReviewFinding[] = [];
    for (const b of blobs) {
      const r = await f(`https://api.github.com/repos/${job.repository}/git/blobs/${b.sha}`, { headers: { ...headers, accept: "application/vnd.github.raw+json" } });
      if (!r.ok) throw new Error(`github blob ${r.status} for ${b.path}`);
      findings.push(...scanText(b.path, await r.text()));
    }
    const blocking = findings.some((x) => x.severity === "critical" || x.severity === "high");
    return {
      vendorId: VENDOR_ID,
      scannerVersion: SCANNER_VERSION,
      filesScanned: blobs.length,
      findings,
      verdict: tree.truncated ? "inconclusive" : blocking ? "block" : "pass",
      disclaimer: "Heuristic pattern scan of the exact commit tree. Not a security certification.",
    };
  };
}
