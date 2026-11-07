import { createHash, timingSafeEqual } from "node:crypto";
import { DiffTooLargeError, GitHubApiError, RepositoryNotAllowedError, type GitHubClient } from "@shiplock/github";
import { SCANNER_VERSION } from "@shiplock/scanner";
import { InvalidTransitionError, PullRefSchema } from "@shiplock/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { registerAuthRoutes, type SessionRow } from "./auth.ts";
import { latestAuthorization, publicAuthorization, registerAuthorizationRoutes, type ReceiptRow } from "./authorizations.ts";
import type { Config } from "./config.ts";
import { registerEnrollmentRoutes } from "./enrollment.ts";
import { ApiError } from "./errors.ts";
import { getMergeAttempt, publicMergeAttempt, registerMergeRoutes } from "./merges.ts";
import { toMirrorTransactionId } from "./mirror-node.ts";
import { registerPaidReviewRoutes } from "./paid-review.ts";
import { analyzeJob, syncPullRequest, type ReviewDeps } from "./review-service.ts";
import {
  ConflictError,
  getJob,
  getReceipt,
  listEvents,
  listFindings,
  listJobsForPullRequest,
  listPullRequests,
  StaleHeadError,
} from "./store.ts";

export type AppConfig = Pick<Config, "appUrl" | "githubOAuth" | "world" | "paidReview" | "minGithubPermission" | "mergeMethod">;

export interface AppDeps extends ReviewDeps {
  github: GitHubClient;
  config: AppConfig;
  agentToken?: string;
  /** Outbound fetch for World verify, GitHub OAuth and the Hedera mirror node. Injected in unit tests only. */
  fetch?: typeof fetch;
}

export type AppEnv = { Variables: { session: SessionRow } };

const SMALL_BODY = bodyLimit({ maxSize: 16 * 1024 });
const PAID_REVIEW_BODY = bodyLimit({ maxSize: 1024 * 1024 });

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(secureHeaders());
  app.use("/api/*", (c, next) => (c.req.path.endsWith("/paid-review") ? PAID_REVIEW_BODY(c, next) : SMALL_BODY(c, next)));

  app.onError((err, c) => toErrorResponse(err, c));

  app.get("/api/health", (c) => {
    deps.db.prepare("SELECT 1").get();
    return c.json({ ok: true, scannerVersion: SCANNER_VERSION });
  });

  app.get("/api/pull-requests", (c) => {
    const prs = listPullRequests(deps.db).map((pr) => {
      const latest = pr.latest_job_id ? getJob(deps.db, pr.latest_job_id) : undefined;
      return {
        id: pr.id,
        repository: pr.repository,
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.html_url,
        authorLogin: pr.author_login,
        state: pr.state,
        merged: pr.merged === 1,
        latestHeadSha: pr.latest_head_sha,
        lastSyncedAt: pr.last_synced_at,
        latestJob: latest ? jobSummary(latest) : null,
      };
    });
    return c.json({ pullRequests: prs });
  });

  app.get("/api/reviews/:jobId", (c) => {
    const job = getJob(deps.db, c.req.param("jobId"));
    if (!job) return c.json({ error: "not_found" }, 404);
    const receipt = getReceipt(deps.db, job.id) as ReceiptRow | undefined;
    const auth = latestAuthorization(deps.db, job.id);
    const attempt = auth ? getMergeAttempt(deps, auth.id) : undefined;
    return c.json({
      job: jobSummary(job),
      localReport: job.local_report_json ? (JSON.parse(job.local_report_json) as unknown) : null,
      findings: listFindings(deps.db, job.id),
      paidReview: receipt ? publicReceipt(receipt) : null,
      authorization: auth ? publicAuthorization(auth) : null,
      mergeAttempt: attempt ? publicMergeAttempt(attempt) : null,
      otherHeads: listJobsForPullRequest(deps.db, job.pull_request_id)
        .filter((j) => j.id !== job.id)
        .map(jobSummary),
      events: listEvents(deps.db, job.id),
    });
  });

  const agent = requireAgent(deps.agentToken);

  /** Agent entry point: bind a review job to the PR's current head SHA and analyze that exact diff. */
  app.post("/api/reviews", agent, async (c) => {
    const body = PullRefSchema.parse(await c.req.json());
    const job = await syncPullRequest(deps, body.repository, body.pullNumber);
    const analyzed = job.state === "discovered" || job.state === "review_pending" ? await analyzeJob(deps, job.id) : job;
    return c.json({ job: jobSummary(analyzed) }, 201);
  });

  registerPaidReviewRoutes(app, deps, agent);
  registerAuthRoutes(app, deps);
  registerEnrollmentRoutes(app, deps);
  registerAuthorizationRoutes(app, deps);
  registerMergeRoutes(app, deps);
  return app;
}

function jobSummary(j: NonNullable<ReturnType<typeof getJob>>) {
  return {
    id: j.id,
    repositoryId: j.repository_id,
    repository: j.repository,
    pullNumber: j.pull_number,
    headSha: j.head_sha,
    baseSha: j.base_sha,
    baseRef: j.base_ref,
    scannerVersion: j.scanner_version,
    state: j.state,
    stateReason: j.state_reason,
    diffSha256: j.diff_sha256,
    localReportSha256: j.local_report_sha256,
    localConclusion: j.local_conclusion,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}

function publicReceipt(r: ReceiptRow) {
  const verified = r.evidence_kind === "live" && r.ledger_verified_at !== null;
  return {
    hederaTransactionId: r.hedera_transaction_id,
    amountTinybar: r.amount_base_units,
    payerAccountId: r.payer_account_id,
    merchantAccountId: r.merchant_account_id,
    evidenceKind: r.evidence_kind,
    reportSha256: r.report_sha256,
    reportConclusion: (JSON.parse(r.report_json) as { conclusion: string }).conclusion,
    ledgerVerifiedAt: r.ledger_verified_at,
    hashscanUrl: verified ? `https://hashscan.io/testnet/transaction/${toMirrorTransactionId(r.hedera_transaction_id)}` : null,
  };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

function requireAgent(token: string | undefined): MiddlewareHandler<AppEnv> {
  const expected = token ? digest(token) : undefined;
  return async (c, next) => {
    if (!expected) return c.json({ error: "agent_endpoint_disabled" }, 503);
    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function toErrorResponse(err: Error, c: Context) {
  if (err instanceof ApiError) return c.json({ error: err.code, ...(err.detail ? { detail: err.detail } : {}) }, err.status);
  if (err instanceof ZodError || err instanceof SyntaxError) return c.json({ error: "invalid_request" }, 400);
  if (err instanceof RepositoryNotAllowedError) return c.json({ error: "repository_not_allowed" }, 403);
  if (err instanceof StaleHeadError) {
    return c.json({ error: "stale_head_sha", expectedSha: err.expectedSha, currentSha: err.currentSha }, 409);
  }
  if (err instanceof ConflictError || err instanceof InvalidTransitionError) {
    return c.json({ error: "conflict", message: err.message }, 409);
  }
  if (err instanceof DiffTooLargeError) return c.json({ error: "diff_too_large" }, 422);
  if (err instanceof GitHubApiError) {
    return c.json({ error: "github_error", status: err.status }, err.status === 404 ? 404 : 502);
  }
  console.error("unhandled error", err.name);
  return c.json({ error: "internal_error" }, 500);
}
