import { randomBytes } from "node:crypto";
import { computeOperationHash, MergeOperationSchema, type MergeOperation } from "@shiplock/policy";
import type { EvidenceKind } from "@shiplock/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { assertRepoPermission, requireEnrollment, requireWorld, type EnrollmentRow } from "./access.ts";
import type { AppDeps, AppEnv } from "./app.ts";
import { requireMaintainer, type SessionRow } from "./auth.ts";
import type { WorldConfig } from "./config.ts";
import { transaction, type Db } from "./db/index.ts";
import { claimProofRequest, rejectProofRequest } from "./enrollment.ts";
import { ApiError, isUniqueViolation } from "./errors.ts";
import { syncPullRequest } from "./review-service.ts";
import { getJob, getReceipt, newId, recordEvent, StaleHeadError, transitionJob, type ReviewJobRow } from "./store.ts";
import { checkSessionResult, issueRpContext, verifyWithWorld } from "./world.ts";

export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const RP_TTL_SECONDS = 300;

export interface AuthorizationRow {
  id: string;
  review_job_id: string;
  operation_hash: string;
  operation_json: string;
  status: "pending" | "approved" | "denied" | "expired" | "invalidated" | "consumed";
  status_reason: string | null;
  github_user_id: number | null;
  github_login: string | null;
  world_enrollment_id: string | null;
  world_environment: "production" | "staging" | null;
  session_id_hash: string | null;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptRow {
  id: string;
  review_job_id: string;
  hedera_transaction_id: string;
  amount_base_units: string;
  payer_account_id: string;
  merchant_account_id: string;
  evidence_kind: EvidenceKind;
  report_sha256: string;
  report_json: string;
  ledger_verified_at: string | null;
}

const now = () => new Date().toISOString();

export function getAuthorization(db: Db, id: string): AuthorizationRow | undefined {
  return db.prepare("SELECT * FROM merge_authorizations WHERE id = ?").get(id) as AuthorizationRow | undefined;
}

export function latestAuthorization(db: Db, jobId: string): AuthorizationRow | undefined {
  return db.prepare("SELECT * FROM merge_authorizations WHERE review_job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(jobId) as
    | AuthorizationRow
    | undefined;
}

/** Stored operation, re-validated and re-hashed. Any drift from the stored hash is fatal. */
export function storedOperation(auth: AuthorizationRow): MergeOperation {
  const op = MergeOperationSchema.parse(JSON.parse(auth.operation_json));
  if (computeOperationHash(op) !== auth.operation_hash) throw new ApiError(409, "operation_hash_mismatch");
  return op;
}

/** A paid review is usable for a human approval when its evidence kind is accepted and, unless simulated, ledger-confirmed. */
export function receiptProblem(receipt: ReceiptRow | undefined, accepted: readonly EvidenceKind[]): string | null {
  if (!receipt) return "no_paid_review";
  if (!accepted.includes(receipt.evidence_kind)) return "paid_review_evidence_not_accepted";
  if (receipt.evidence_kind !== "simulated" && !receipt.ledger_verified_at) return "paid_review_not_ledger_verified";
  return null;
}

/** Expires a pending/approved authorization past its deadline (and its job). Caller holds a transaction. */
export function expireIfDue(db: Db, auth: AuthorizationRow): AuthorizationRow {
  if ((auth.status !== "pending" && auth.status !== "approved") || auth.expires_at > now()) return auth;
  db.prepare("UPDATE merge_authorizations SET status = 'expired', status_reason = 'expired', updated_at = ? WHERE id = ? AND status = ?").run(now(), auth.id, auth.status);
  db.prepare("UPDATE world_proof_requests SET status = 'cancelled', failure_reason = 'authorization_expired', completed_at = ? WHERE authorization_id = ? AND status = 'issued'").run(now(), auth.id);
  const job = getJob(db, auth.review_job_id);
  if (job && (job.state === "approval_pending" || job.state === "approved")) transitionJob(db, job.id, "expired", "authorization expired");
  recordEvent(db, "authorization.expired", auth.review_job_id, { authorizationId: auth.id });
  return getAuthorization(db, auth.id)!;
}

function ownAuthorization(deps: AppDeps, id: string, session: SessionRow): AuthorizationRow {
  const auth = getAuthorization(deps.db, id);
  if (!auth) throw new ApiError(404, "not_found");
  if (auth.github_user_id !== session.github_user_id) throw new ApiError(403, "not_your_authorization");
  return auth;
}

function issueApprovalRequest(deps: AppDeps, world: WorldConfig, auth: AuthorizationRow, session: SessionRow, enrollment: EnrollmentRow) {
  const remaining = Math.floor((Date.parse(auth.expires_at) - Date.now()) / 1000);
  if (remaining < 30) throw new ApiError(409, "authorization_expired");
  const rp = issueRpContext(world, { ttlSeconds: Math.min(RP_TTL_SECONDS, remaining) });
  const requestId = newId("wpr");
  deps.db
    .prepare(
      `INSERT INTO world_proof_requests (id, purpose, rp_nonce, session_id_hash, github_user_id, authorization_id, expected_signal, status, created_at, expires_at)
       VALUES (?, 'approve', ?, ?, ?, ?, ?, 'issued', ?, ?)`,
    )
    .run(requestId, rp.nonce, session.id_hash, session.github_user_id, auth.id, auth.operation_hash, now(), rp.expiresAt.toISOString());
  return {
    requestId,
    app_id: world.appId,
    environment: world.environment,
    rp_context: rp.rpContext,
    existing_session_id: enrollment.session_id,
    signal: auth.operation_hash,
    require_user_presence: world.requireUserPresence,
  };
}

export function publicAuthorization(auth: AuthorizationRow) {
  return {
    id: auth.id,
    status: auth.status,
    statusReason: auth.status_reason,
    operationHash: auth.operation_hash,
    operation: JSON.parse(auth.operation_json) as unknown,
    approverGithubLogin: auth.github_login,
    worldEnvironment: auth.world_environment,
    expiresAt: auth.expires_at,
    approvedAt: auth.approved_at,
    consumedAt: auth.consumed_at,
    createdAt: auth.created_at,
  };
}

async function refuseIfHeadMoved(deps: AppDeps, job: ReviewJobRow): Promise<void> {
  const live = await deps.github.getPullRequest(job.repository, job.pull_number);
  if (live.state !== "open" || live.merged) throw new ApiError(409, "pull_request_not_open");
  if (live.headSha !== job.head_sha) {
    await syncPullRequest(deps, job.repository, job.pull_number).catch(() => undefined);
    throw new StaleHeadError(job.id, job.head_sha, live.headSha);
  }
}

const CreateSchema = z.strictObject({ jobId: z.string().min(1).max(100) });
const ApproveSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  operationHash: z.string().regex(/^[0-9a-f]{64}$/),
  idkitResult: z.unknown(),
});
const DenySchema = z.strictObject({ reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional() });
const CancelSchema = z.strictObject({ errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/).optional() });

const AUTHORIZABLE_STATES = new Set(["paid_review_confirmed", "denied", "expired"]);

export function registerAuthorizationRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  /** Builds the exact merge operation from server state only and opens a short-lived human checkpoint. */
  app.post("/api/authorizations", requireMaintainer(deps), async (c) => {
    const world = requireWorld(deps);
    const session = c.get("session");
    const { jobId } = CreateSchema.parse(await c.req.json());
    const job = getJob(deps.db, jobId);
    if (!job) throw new ApiError(404, "not_found");
    const open = latestAuthorization(deps.db, job.id);
    if (open) transaction(deps.db, () => expireIfDue(deps.db, open));

    const current = getJob(deps.db, job.id)!;
    if (!AUTHORIZABLE_STATES.has(current.state)) throw new ApiError(409, "job_not_ready_for_approval", { state: current.state });
    if (current.local_conclusion !== "pass") throw new ApiError(409, "review_not_passing", { conclusion: current.local_conclusion });
    const receipt = getReceipt(deps.db, job.id) as ReceiptRow | undefined;
    const problem = receiptProblem(receipt, deps.config.paidReview?.acceptedEvidence ?? []);
    if (problem) throw new ApiError(409, problem);
    if (receipt!.report_sha256 !== current.local_report_sha256) throw new ApiError(409, "paid_review_digest_mismatch");
    if ((JSON.parse(receipt!.report_json) as { conclusion: string }).conclusion !== "pass") throw new ApiError(409, "review_not_passing");
    const enrollment = requireEnrollment(deps, session, world);

    await assertRepoPermission(deps, job.repository, { id: session.github_user_id, login: session.github_login });
    await refuseIfHeadMoved(deps, current);

    const authorizationId = newId("auth");
    const op: MergeOperation = {
      schema: "shiplock.merge-operation/v2",
      action: "merge_pull_request",
      authorizationId,
      repositoryId: current.repository_id,
      repository: current.repository,
      pullNumber: current.pull_number,
      headSha: current.head_sha,
      baseRef: current.base_ref,
      reportSha256: receipt!.report_sha256,
      scannerVersion: current.scanner_version,
      paidReviewEvidenceKind: receipt!.evidence_kind,
      mergeMethod: deps.config.mergeMethod,
      approverGithubLogin: session.github_login,
      approverGithubUserId: session.github_user_id,
      worldEnvironment: world.environment,
      worldRpId: world.rpId,
      nonce: randomBytes(24).toString("base64url"),
      expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString(),
    };
    const operationHash = computeOperationHash(op);

    try {
      const result = transaction(deps.db, () => {
        const fresh = getJob(deps.db, job.id)!;
        if (!AUTHORIZABLE_STATES.has(fresh.state) || fresh.head_sha !== op.headSha) throw new ApiError(409, "job_changed_concurrently");
        const at = now();
        deps.db
          .prepare(
            `INSERT INTO merge_authorizations (id, review_job_id, operation_hash, operation_json, status, github_user_id, github_login,
               world_enrollment_id, world_environment, session_id_hash, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(authorizationId, job.id, operationHash, JSON.stringify(op), session.github_user_id, session.github_login, enrollment.id, world.environment, session.id_hash, op.expiresAt, at, at);
        transitionJob(deps.db, job.id, "approval_pending", "awaiting World ID approval");
        recordEvent(deps.db, "authorization.created", job.id, { authorizationId, operationHash, expiresAt: op.expiresAt }, authorizationId);
        const auth = getAuthorization(deps.db, authorizationId)!;
        return { auth, idkit: issueApprovalRequest(deps, world, auth, session, enrollment) };
      });
      return c.json({ authorization: publicAuthorization(result.auth), operation: op, operationHash, idkit: result.idkit }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, "authorization_already_open");
      throw err;
    }
  });

  /** Fresh RP signature for another attempt at the same pending authorization. */
  app.post("/api/authorizations/:id/proof-request", requireMaintainer(deps), (c) => {
    const world = requireWorld(deps);
    const session = c.get("session");
    const auth = transaction(deps.db, () => expireIfDue(deps.db, ownAuthorization(deps, c.req.param("id"), session)));
    if (auth.status !== "pending") throw new ApiError(409, "authorization_not_pending", { status: auth.status });
    if (auth.session_id_hash !== session.id_hash) throw new ApiError(403, "authorization_bound_to_other_session");
    const enrollment = requireEnrollment(deps, session, world);
    if (auth.world_enrollment_id !== enrollment.id) throw new ApiError(409, "world_enrollment_mismatch");
    storedOperation(auth);
    return c.json({ idkit: issueApprovalRequest(deps, world, auth, session, enrollment) });
  });

  /**
   * Explicit consent: a World ID session proof whose signal is the stored operation hash, from
   * the maintainer's enrolled World session, verified by World, used once.
   */
  app.post("/api/authorizations/:id/approve", requireMaintainer(deps), async (c) => {
    const world = requireWorld(deps);
    const session = c.get("session");
    const body = ApproveSchema.parse(await c.req.json());
    const auth = transaction(deps.db, () => expireIfDue(deps.db, ownAuthorization(deps, c.req.param("id"), session)));
    if (auth.status !== "pending") throw new ApiError(409, "authorization_not_pending", { status: auth.status });
    if (auth.session_id_hash !== session.id_hash) throw new ApiError(403, "authorization_bound_to_other_session");
    if (body.operationHash !== auth.operation_hash) throw new ApiError(409, "operation_hash_mismatch");
    const op = storedOperation(auth);
    const job = getJob(deps.db, auth.review_job_id)!;
    if (job.state !== "approval_pending" || job.head_sha !== op.headSha) throw new ApiError(409, "job_not_awaiting_approval", { state: job.state });
    const enrollment = requireEnrollment(deps, session, world);
    if (auth.world_enrollment_id !== enrollment.id) throw new ApiError(409, "world_enrollment_mismatch");

    const local = checkSessionResult(body.idkitResult, {
      environment: world.environment,
      signal: auth.operation_hash,
      requireUserPresence: world.requireUserPresence,
    });
    if (!local.ok) throw new ApiError(400, local.reason);
    const request = claimProofRequest(deps, local.value.nonce, {
      purpose: "approve",
      requestId: body.requestId,
      sessionIdHash: session.id_hash,
      githubUserId: session.github_user_id,
      authorizationId: auth.id,
    });
    if (local.value.sessionId !== enrollment.session_id) {
      rejectProofRequest(deps, request.id, "world_session_mismatch");
      throw new ApiError(403, "world_session_mismatch");
    }

    const verified = await verifyWithWorld(deps.fetch ?? fetch, world, body.idkitResult);
    if (!verified.ok || (verified.sessionId !== undefined && verified.sessionId !== enrollment.session_id)) {
      const reason = verified.ok ? "verify_session_mismatch" : verified.reason;
      rejectProofRequest(deps, request.id, reason);
      recordEvent(deps.db, "authorization.world_rejected", auth.review_job_id, { authorizationId: auth.id, reason }, auth.id);
      throw new ApiError(422, "world_verification_failed", { reason });
    }

    try {
      transaction(deps.db, () => {
        const fresh = expireIfDue(deps.db, getAuthorization(deps.db, auth.id)!);
        if (fresh.status !== "pending") throw new ApiError(409, "authorization_not_pending", { status: fresh.status });
        const claimed = deps.db
          .prepare("UPDATE world_proof_requests SET status = 'verified', completed_at = ? WHERE id = ? AND status = 'issued'")
          .run(now(), request.id);
        if (Number(claimed.changes) !== 1) throw new ApiError(409, "nonce_already_used");
        deps.db
          .prepare("INSERT INTO world_session_nullifiers (nullifier, world_enrollment_id, authorization_id, created_at) VALUES (?, ?, ?, ?)")
          .run(local.value.sessionNullifier, enrollment.id, auth.id, now());
        deps.db
          .prepare("UPDATE merge_authorizations SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
          .run(now(), now(), auth.id);
        transitionJob(deps.db, auth.review_job_id, "approved", "approved with World ID");
        recordEvent(deps.db, "authorization.approved", auth.review_job_id, { authorizationId: auth.id, operationHash: auth.operation_hash, worldEnvironment: world.environment }, auth.id);
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      rejectProofRequest(deps, request.id, "session_nullifier_replayed");
      recordEvent(deps.db, "authorization.world_rejected", auth.review_job_id, { authorizationId: auth.id, reason: "session_nullifier_replayed" }, auth.id);
      throw new ApiError(409, "world_proof_replayed");
    }
    return c.json({ authorization: publicAuthorization(getAuthorization(deps.db, auth.id)!) });
  });

  const closeAuthorization = (kind: "deny" | "cancel") =>
    app.post(`/api/authorizations/:id/${kind}`, requireMaintainer(deps), async (c) => {
      const session = c.get("session");
      const body = (kind === "deny" ? DenySchema : CancelSchema).parse(await c.req.json().catch(() => ({})));
      const reason =
        kind === "deny"
          ? `maintainer_denied${"reason" in body && body.reason ? `:${body.reason}` : ""}`
          : `world_cancelled${"errorCode" in body && body.errorCode ? `:${body.errorCode}` : ""}`;
      const auth = transaction(deps.db, () => {
        const a = expireIfDue(deps.db, ownAuthorization(deps, c.req.param("id"), session));
        if (a.status !== "pending") throw new ApiError(409, "authorization_not_pending", { status: a.status });
        deps.db.prepare("UPDATE merge_authorizations SET status = 'denied', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(reason, now(), a.id);
        deps.db
          .prepare("UPDATE world_proof_requests SET status = 'cancelled', failure_reason = ?, completed_at = ? WHERE authorization_id = ? AND status = 'issued'")
          .run(reason, now(), a.id);
        transitionJob(deps.db, a.review_job_id, "denied", reason);
        recordEvent(deps.db, kind === "deny" ? "authorization.denied" : "authorization.cancelled", a.review_job_id, { authorizationId: a.id, reason }, a.id);
        return getAuthorization(deps.db, a.id)!;
      });
      return c.json({ authorization: publicAuthorization(auth) });
    });
  closeAuthorization("deny");
  closeAuthorization("cancel");
}
