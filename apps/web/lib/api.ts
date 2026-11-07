import "server-only";

const API_ORIGIN = process.env.SHIPLOCK_API_ORIGIN ?? "http://127.0.0.1:4000";

export type ReleaseState =
  | "discovered"
  | "review_pending"
  | "paid_review_confirmed"
  | "approval_pending"
  | "approved"
  | "merge_in_progress"
  | "merged"
  | "review_blocked"
  | "denied"
  | "expired"
  | "stale"
  | "invalid"
  | "failed"
  | "reconcile_required";

export interface JobSummary {
  id: string;
  repositoryId: number;
  repository: string;
  pullNumber: number;
  headSha: string;
  baseSha: string;
  baseRef: string;
  scannerVersion: string;
  state: ReleaseState;
  stateReason: string | null;
  diffSha256: string | null;
  localReportSha256: string | null;
  localConclusion: "pass" | "block" | "inconclusive" | null;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestItem {
  id: string;
  repository: string;
  number: number;
  title: string;
  htmlUrl: string;
  authorLogin: string | null;
  state: "open" | "closed";
  merged: boolean;
  latestHeadSha: string;
  lastSyncedAt: string;
  latestJob: JobSummary | null;
}

export interface Finding {
  source: "local" | "paid";
  rule_id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  file: string;
  line: number | null;
  description: string;
  evidence: string | null;
}

export interface ReviewDetail {
  job: JobSummary;
  localReport: { stats: { filesChanged: number; additions: number; deletions: number; binaryFiles: number }; limitations: string[] } | null;
  findings: Finding[];
  paidReview: PaidReview | null;
  authorization: Authorization | null;
  mergeAttempt: MergeAttempt | null;
  otherHeads: JobSummary[];
  events: Array<{ id: number; at: string; type: string; detail: Record<string, unknown> }>;
}

export interface PaidReview {
  hederaTransactionId: string;
  amountTinybar: string;
  payerAccountId: string;
  merchantAccountId: string;
  evidenceKind: "live" | "test" | "simulated";
  reportSha256: string;
  reportConclusion: "pass" | "block" | "inconclusive";
  ledgerVerifiedAt: string | null;
  /** Only set for live evidence confirmed on the mirror node. */
  hashscanUrl: string | null;
}

export type WorldEnvironment = "production" | "staging";

export interface MergeOperation {
  schema: string;
  action: "merge_pull_request";
  authorizationId: string;
  repositoryId: number;
  repository: string;
  pullNumber: number;
  headSha: string;
  baseRef: string;
  reportSha256: string;
  scannerVersion: string;
  paidReviewEvidenceKind: PaidReview["evidenceKind"];
  mergeMethod: "merge" | "squash" | "rebase";
  approverGithubLogin: string;
  approverGithubUserId: number;
  worldEnvironment: WorldEnvironment;
  worldRpId: string;
  nonce: string;
  expiresAt: string;
}

export interface Authorization {
  id: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed" | "invalidated";
  statusReason: string | null;
  operationHash: string;
  operation: MergeOperation;
  approverGithubLogin: string | null;
  worldEnvironment: WorldEnvironment | null;
  expiresAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
}

export interface MergeAttempt {
  authorizationId: string;
  expectedSha: string;
  status: "in_progress" | "merged" | "blocked" | "failed" | "uncertain";
  githubHttpStatus: number | null;
  mergeCommitSha: string | null;
  mergeUrl: string | null;
  reason: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SessionInfo {
  authenticated: boolean;
  githubOAuthConfigured: boolean;
  world: { configured: false } | { configured: true; environment: WorldEnvironment; appId: `app_${string}`; requireUserPresence: boolean };
  github?: { login: string; id: number };
  csrfToken?: string;
  worldEnrollment?: { id: string; environment: WorldEnvironment; enrolledAt: string } | null;
}

/** Server-issued World request parameters. The RP signature is created server-side only. */
export interface WorldRequest {
  requestId: string;
  app_id: `app_${string}`;
  environment: WorldEnvironment;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  signal: string;
  require_user_presence: boolean;
}

export interface EnrollmentRequest extends WorldRequest {
  action: string;
  allow_legacy_proofs: false;
}

export interface ApprovalRequest extends WorldRequest {
  existing_session_id: `session_${string}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function get<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, { cache: "no-store" });
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (!res.ok) return { ok: false, error: `API responded ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "ShipLock API is unreachable" };
  }
}

export const getPullRequests = () => get<{ pullRequests: PullRequestItem[] }>("/api/pull-requests");
export const getReview = (jobId: string) => get<ReviewDetail>(`/api/reviews/${encodeURIComponent(jobId)}`);
