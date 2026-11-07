import type { FindingSeverity, ReviewFinding } from "@shiplock/shared";
import type { DiffFile } from "./diff.ts";

/** Lines longer than this are scanned only up to this length (bounded regex work). */
export const MAX_SCANNED_LINE_CHARS = 4000;

interface LineRule {
  id: string;
  severity: FindingSeverity;
  description: string;
  pattern: RegExp;
  appliesTo?: (path: string) => boolean;
  redact?: boolean;
}

const isWorkflow = (p: string) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
const isCode = (p: string) =>
  /\.(c|cc|cpp|cs|go|java|js|jsx|kt|mjs|cjs|php|py|rb|rs|scala|sh|bash|swift|ts|tsx|zsh)$/.test(p);

/** Credential patterns. Matches are always redacted in evidence. */
const SECRET_RULES: LineRule[] = [
  { id: "SL-SECRET-PRIVATE-KEY", severity: "critical", description: "PEM private key block added", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "SL-SECRET-AWS", severity: "critical", description: "AWS access key ID added", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "SL-SECRET-GITHUB", severity: "critical", description: "GitHub token added", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { id: "SL-SECRET-SLACK", severity: "high", description: "Slack token added", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "SL-SECRET-STRIPE", severity: "critical", description: "Stripe live secret key added", pattern: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { id: "SL-SECRET-HEDERA-DER", severity: "critical", description: "DER-encoded Hedera/ECDSA/ED25519 private key added", pattern: /\b(?:302e020100300506032b657004220420|3030020100300706052b8104000a04220420)[0-9a-fA-F]{64}\b/ },
  { id: "SL-SECRET-HEX-KEY", severity: "high", description: "Raw 32-byte hex value assigned to a key/secret-like name", pattern: /(?:private[_-]?key|secret|mnemonic|seed)["']?\s*[:=]\s*["']?(?:0x)?[0-9a-fA-F]{64}\b/i },
  { id: "SL-SECRET-GENERIC", severity: "high", description: "Credential-like literal assigned to a secret/token/password name", pattern: /(?:api[_-]?key|secret|token|passw(?:or)?d|auth)["']?\s*[:=]\s*["'][^"'\s$<>{}]{16,}["']/i },
];

const EXEC_RULES: LineRule[] = [
  { id: "SL-EXEC-EVAL", severity: "high", description: "Dynamic code evaluation (eval / new Function)", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, appliesTo: isCode },
  { id: "SL-EXEC-CHILD-PROCESS", severity: "medium", description: "Process execution API introduced", pattern: /\bchild_process\b|\bexecSync\s*\(|\bexecFile(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|\bos\.system\s*\(|\bsubprocess\.(?:run|call|Popen|check_output)\s*\(|\bRuntime\.getRuntime\(\)\.exec\s*\(/, appliesTo: isCode },
  { id: "SL-EXEC-SHELL-TRUE", severity: "high", description: "Command executed through a shell (shell=True / shell: true)", pattern: /\bshell\s*[=:]\s*(?:True|true)\b/, appliesTo: isCode },
  { id: "SL-EXEC-PIPE-TO-SHELL", severity: "high", description: "Remote content piped into a shell", pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
];

const WORKFLOW_RULES: LineRule[] = [
  { id: "SL-CI-PR-TARGET", severity: "critical", description: "Workflow uses pull_request_target (runs with base-repo secrets)", pattern: /\bpull_request_target\b/, appliesTo: isWorkflow },
  { id: "SL-CI-WRITE-ALL", severity: "high", description: "Workflow grants write-all token permissions", pattern: /permissions\s*:\s*write-all/, appliesTo: isWorkflow },
  { id: "SL-CI-SCRIPT-INJECTION", severity: "high", description: "Untrusted PR/issue field interpolated into a workflow expression", pattern: /\$\{\{\s*github\.event\.(?:pull_request\.(?:title|body|head\.ref|head\.label)|issue\.(?:title|body)|comment\.body|review\.body|head_commit\.message)/, appliesTo: isWorkflow },
  { id: "SL-CI-SECRETS-INHERIT", severity: "medium", description: "Workflow passes all secrets to a called workflow", pattern: /secrets\s*:\s*inherit/, appliesTo: isWorkflow },
];

const MANIFEST_RULES: LineRule[] = [
  { id: "SL-DEP-INSTALL-SCRIPT", severity: "high", description: "npm lifecycle install script added", pattern: /"(?:pre|post)?install"\s*:/, appliesTo: (p) => /(^|\/)package\.json$/.test(p) },
  { id: "SL-DEP-REMOTE-SOURCE", severity: "medium", description: "Dependency resolved from a git URL or raw tarball", pattern: /"(?:git\+|git:\/\/|github:|https?:\/\/[^"]+\.(?:tgz|tar\.gz))/, appliesTo: (p) => /(^|\/)package\.json$/.test(p) },
];

const LINE_RULES = [...SECRET_RULES, ...EXEC_RULES, ...WORKFLOW_RULES, ...MANIFEST_RULES];

const DEPENDENCY_MANIFEST =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?)$/;
const SENSITIVE_PATH =
  /(^|\/)(\.env[^/]*|Dockerfile|docker-compose[^/]*\.ya?ml|\.npmrc|\.gitmodules)$|(^|[/._-])(auth|crypto|wallet|payment|signer|signing|secret|permission|session|oauth|x402)([/._-]|$)/i;

export interface FileRuleContext {
  file: DiffFile;
  emit: (finding: ReviewFinding) => void;
}

export function applyFileRules({ file, emit }: FileRuleContext): void {
  const path = file.path;
  if (file.unparsedPath) {
    emit({ ruleId: "SL-SCAN-UNPARSED-PATH", severity: "medium", file: path, description: "Diff header path could not be decoded; path-based rules may not apply" });
  }
  if (isWorkflow(path) || (file.oldPath && isWorkflow(file.oldPath))) {
    emit({ ruleId: "SL-CI-WORKFLOW-CHANGED", severity: "high", file: path, description: `CI workflow ${file.status}` });
  } else if (path.startsWith(".github/")) {
    emit({ ruleId: "SL-CI-GITHUB-CONFIG", severity: "medium", file: path, description: "Repository automation/config under .github changed" });
  }
  if (/(^|\/)CODEOWNERS$/.test(path)) {
    emit({ ruleId: "SL-SENS-CODEOWNERS", severity: "high", file: path, description: "CODEOWNERS changed (review routing)" });
  }
  if (DEPENDENCY_MANIFEST.test(path)) {
    emit({ ruleId: "SL-DEP-MANIFEST", severity: "medium", file: path, description: "Dependency manifest or lockfile changed" });
  }
  if (SENSITIVE_PATH.test(path)) {
    emit({ ruleId: "SL-SENS-PATH", severity: "medium", file: path, description: "Security-sensitive file path changed" });
  }
  if (file.modeChange?.to?.endsWith("755")) {
    emit({ ruleId: "SL-SENS-EXECUTABLE", severity: "low", file: path, description: "File made executable" });
  }
  if (file.binary) {
    emit({ ruleId: "SL-SCAN-BINARY", severity: "low", file: path, description: "Binary file not analyzed" });
  }

  for (const added of file.added) {
    const text = added.text.length > MAX_SCANNED_LINE_CHARS ? added.text.slice(0, MAX_SCANNED_LINE_CHARS) : added.text;
    for (const rule of LINE_RULES) {
      if (rule.appliesTo && !rule.appliesTo(path)) continue;
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const secret = SECRET_RULES.includes(rule);
      emit({
        ruleId: rule.id,
        severity: rule.severity,
        file: path,
        line: added.line,
        description: rule.description,
        evidence: secret ? redact(text, match) : excerpt(text),
      });
    }
  }
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/** Replaces the matched credential with a fixed-length marker; never echoes secret bytes. */
function redact(text: string, match: RegExpExecArray): string {
  const before = text.slice(Math.max(0, match.index - 40), match.index).trimStart();
  return `${before}[REDACTED ${match[0].length} chars]`.slice(0, 200);
}

export const RULE_IDS = [
  ...LINE_RULES.map((r) => r.id),
  "SL-CI-WORKFLOW-CHANGED",
  "SL-CI-GITHUB-CONFIG",
  "SL-SENS-CODEOWNERS",
  "SL-DEP-MANIFEST",
  "SL-SENS-PATH",
  "SL-SENS-EXECUTABLE",
  "SL-SCAN-BINARY",
  "SL-SCAN-UNPARSED-PATH",
];
