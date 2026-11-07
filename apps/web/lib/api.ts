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
  paidReview: null | {
    hedera_transaction_id: string;
    amount_base_units: string;
    merchant_account_id: string;
    payer_account_id: string;
    evidence_kind: "live" | "test" | "simulated";
    report_sha256: string;
    ledger_verified_at: string | null;
  };
  otherHeads: JobSummary[];
  events: Array<{ id: number; at: string; type: string; detail: Record<string, unknown> }>;
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
