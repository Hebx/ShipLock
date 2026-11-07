import { createHash, timingSafeEqual } from "node:crypto";
import { DiffTooLargeError, GitHubApiError, RepositoryNotAllowedError } from "@shiplock/github";
import { SCANNER_VERSION } from "@shiplock/scanner";
import { InvalidTransitionError, PullRefSchema } from "@shiplock/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
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

export interface AppDeps extends ReviewDeps {
  agentToken?: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use(secureHeaders());
  app.use("/api/*", bodyLimit({ maxSize: 16 * 1024 }));

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
    const receipt = getReceipt(deps.db, job.id);
    return c.json({
      job: jobSummary(job),
      localReport: job.local_report_json ? (JSON.parse(job.local_report_json) as unknown) : null,
      findings: listFindings(deps.db, job.id),
      paidReview: receipt ?? null,
      otherHeads: listJobsForPullRequest(deps.db, job.pull_request_id)
        .filter((j) => j.id !== job.id)
        .map(jobSummary),
      events: listEvents(deps.db, job.id),
    });
  });

  /** Agent entry point: bind a review job to the PR's current head SHA and analyze that exact diff. */
  app.post("/api/reviews", requireAgent(deps.agentToken), async (c) => {
    const body = PullRefSchema.parse(await c.req.json());
    const job = await syncPullRequest(deps, body.repository, body.pullNumber);
    const analyzed = job.state === "discovered" || job.state === "review_pending" ? await analyzeJob(deps, job.id) : job;
    return c.json({ job: jobSummary(analyzed) }, 201);
  });

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

const digest = (s: string) => createHash("sha256").update(s).digest();

function requireAgent(token: string | undefined): MiddlewareHandler {
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
