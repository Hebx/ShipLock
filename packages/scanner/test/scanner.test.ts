import { canonicalSha256, type ReviewJob } from "@shiplock/shared";
import { describe, expect, it } from "vitest";
import { MAX_DIFF_BYTES, parseUnifiedDiff, SCANNER_VERSION, scanDiff } from "../src/index.ts";

const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const job: ReviewJob = {
  jobId: "job_1",
  repositoryId: 42,
  repository: "Hebx/shiplock-demo-target",
  pullNumber: 7,
  headSha: HEAD,
  baseSha: BASE,
  scannerVersion: SCANNER_VERSION,
};
const enc = (s: string) => new TextEncoder().encode(s);

// Assembled at runtime so this test file does not itself contain credential-shaped literals.
const FAKE_GH_TOKEN = ["gh", "p_", "Z".repeat(36)].join("");
const FAKE_PEM = ["-----BEGIN", " PRIVATE KEY-----"].join("");

const DIFF = [
  "diff --git a/src/payment.ts b/src/payment.ts",
  "index 1111111..2222222 100644",
  "--- a/src/payment.ts",
  "+++ b/src/payment.ts",
  "@@ -1,3 +1,5 @@",
  " import x from 'y';",
  `+const token = "${FAKE_GH_TOKEN}";`,
  "-const old = 1;",
  " const keep = 2;",
  "+const r = eval(userInput);",
  "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
  "--- a/.github/workflows/ci.yml",
  "+++ b/.github/workflows/ci.yml",
  "@@ -10,2 +10,3 @@ jobs:",
  " on:",
  "+  pull_request_target:",
  "       run: echo hi",
  "diff --git a/package.json b/package.json",
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -5,1 +5,2 @@",
  '   "scripts": {',
  '+    "postinstall": "node setup.js",',
  "diff --git a/keys/id b/keys/id",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/keys/id",
  "@@ -0,0 +1,1 @@",
  `+${FAKE_PEM}`,
  "diff --git a/logo.png b/logo.png",
  "new file mode 100644",
  "Binary files /dev/null and b/logo.png differ",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("tracks new-file line numbers, statuses and binary files", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => f.path)).toEqual([
      "src/payment.ts",
      ".github/workflows/ci.yml",
      "package.json",
      "keys/id",
      "logo.png",
    ]);
    expect(files[0]!.added.map((a) => a.line)).toEqual([2, 4]);
    expect(files[0]!.deletions).toBe(1);
    expect(files[1]!.added[0]!.line).toBe(11);
    expect(files[3]!.status).toBe("added");
    expect(files[4]!.binary).toBe(true);
  });

  it("does not drop files with undecodable (quoted) header paths", () => {
    const files = parseUnifiedDiff('diff --git "a/sp ace.ts" "b/sp ace.ts"\n@@ -0,0 +1 @@\n+eval(x)\n');
    expect(files).toHaveLength(1);
    expect(files[0]!.unparsedPath).toBe(true);
    expect(files[0]!.added).toHaveLength(1);
  });
});

describe("scanDiff", () => {
  const { report, reportSha256 } = scanDiff(job, enc(DIFF));
  const ids = report.findings.map((f) => `${f.ruleId}@${f.file}:${f.line ?? "-"}`);

  it("finds credentials, eval, CI and dependency risks with file/line evidence", () => {
    expect(ids).toContain("SL-SECRET-GITHUB@src/payment.ts:2");
    expect(ids).toContain("SL-EXEC-EVAL@src/payment.ts:4");
    expect(ids).toContain("SL-CI-PR-TARGET@.github/workflows/ci.yml:11");
    expect(ids).toContain("SL-CI-WORKFLOW-CHANGED@.github/workflows/ci.yml:-");
    expect(ids).toContain("SL-DEP-INSTALL-SCRIPT@package.json:6");
    expect(ids).toContain("SL-DEP-MANIFEST@package.json:-");
    expect(ids).toContain("SL-SECRET-PRIVATE-KEY@keys/id:1");
    expect(ids).toContain("SL-SENS-PATH@src/payment.ts:-");
    expect(ids).toContain("SL-SCAN-BINARY@logo.png:-");
  });

  it("never echoes credential bytes in evidence", () => {
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(FAKE_GH_TOKEN);
    expect(serialized).toContain("[REDACTED");
  });

  it("blocks on high/critical findings and binds the report to the job", () => {
    expect(report.conclusion).toBe("block");
    expect(report.headSha).toBe(HEAD);
    expect(report.baseSha).toBe(BASE);
    expect(report.repositoryId).toBe(42);
    expect(report.scannerVersion).toBe(SCANNER_VERSION);
    expect(report.limitations.join(" ")).toMatch(/not a security certification/);
    expect(reportSha256).toBe(canonicalSha256(report));
  });

  it("is deterministic for identical input", () => {
    expect(scanDiff(job, enc(DIFF)).reportSha256).toBe(reportSha256);
  });

  it("produces a different binding for a new head SHA even with identical diff bytes", () => {
    const next = scanDiff({ ...job, headSha: "3".repeat(40) }, enc(DIFF));
    expect(next.reportSha256).not.toBe(reportSha256);
    expect(next.report.diffSha256).toBe(report.diffSha256);
  });

  it("passes a benign diff and reports inconclusive for binary-only or oversized diffs", () => {
    const benign = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # t\n+hello\n";
    expect(scanDiff(job, enc(benign)).report.conclusion).toBe("pass");
    const binary = "diff --git a/a.bin b/a.bin\nBinary files a/a.bin and b/a.bin differ\n";
    expect(scanDiff(job, enc(binary)).report.conclusion).toBe("inconclusive");
    const huge = new Uint8Array(MAX_DIFF_BYTES + 1);
    const out = scanDiff(job, huge);
    expect(out.report.conclusion).toBe("inconclusive");
    expect(out.report.findings).toHaveLength(0);
  });

  it("rejects malformed jobs and scanner version mismatch", () => {
    expect(() => scanDiff({ ...job, headSha: "abc" }, enc(""))).toThrow();
    expect(() => scanDiff({ ...job, scannerVersion: "other/1" }, enc(""))).toThrow(/scanner/);
  });
});
