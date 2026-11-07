import type { Hono } from "hono";
import { z } from "zod";
import { activeEnrollment, requireWorld } from "./access.ts";
import type { AppDeps, AppEnv } from "./app.ts";
import { requireMaintainer } from "./auth.ts";
import { transaction } from "./db/index.ts";
import { ApiError, isUniqueViolation } from "./errors.ts";
import { newId, recordEvent } from "./store.ts";
import { checkEnrollmentResult, issueRpContext, verifyWithWorld } from "./world.ts";

const RP_TTL_SECONDS = 300;

export interface ProofRequestRow {
  id: string;
  purpose: "enroll" | "approve";
  rp_nonce: string;
  session_id_hash: string;
  github_user_id: number;
  authorization_id: string | null;
  action: string | null;
  expected_signal: string;
  status: "issued" | "verified" | "rejected" | "cancelled";
  expires_at: string;
}

/**
 * Loads the issued RP nonce a result claims and checks it was minted for this purpose, this
 * browser session, this GitHub user (and authorization), is unused and unexpired.
 */
export function claimProofRequest(
  deps: AppDeps,
  nonce: string,
  expect: { purpose: "enroll" | "approve"; requestId: string; sessionIdHash: string; githubUserId: number; authorizationId?: string },
): ProofRequestRow {
  const row = deps.db.prepare("SELECT * FROM world_proof_requests WHERE rp_nonce = ?").get(nonce) as ProofRequestRow | undefined;
  if (!row || row.id !== expect.requestId || row.purpose !== expect.purpose) throw new ApiError(400, "unknown_nonce");
  if (row.session_id_hash !== expect.sessionIdHash || row.github_user_id !== expect.githubUserId) throw new ApiError(403, "nonce_not_bound_to_session");
  if ((expect.authorizationId ?? null) !== row.authorization_id) throw new ApiError(403, "nonce_not_bound_to_authorization");
  if (row.status !== "issued") throw new ApiError(409, "nonce_already_used");
  if (row.expires_at <= new Date().toISOString()) throw new ApiError(409, "nonce_expired");
  return row;
}

export function rejectProofRequest(deps: AppDeps, id: string, reason: string): void {
  deps.db
    .prepare("UPDATE world_proof_requests SET status = 'rejected', failure_reason = ?, completed_at = ? WHERE id = ? AND status = 'issued'")
    .run(reason, new Date().toISOString(), id);
}

const CompleteSchema = z.strictObject({ requestId: z.string().min(1).max(100), idkitResult: z.unknown() });

export function registerEnrollmentRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  /** Starts a one-time World ID enrollment: a Proof of Human uniqueness proof that also creates a World session. */
  app.post("/api/world/enrollment/start", requireMaintainer(deps), (c) => {
    const world = requireWorld(deps);
    const session = c.get("session");
    if (activeEnrollment(deps.db, session.github_user_id)) throw new ApiError(409, "already_enrolled");

    const requestId = newId("wpr");
    const signal = `shiplock-enroll:v1:${session.github_user_id}:${requestId}`;
    const rp = issueRpContext(world, { action: world.enrollAction, ttlSeconds: RP_TTL_SECONDS });
    deps.db
      .prepare(
        `INSERT INTO world_proof_requests (id, purpose, rp_nonce, session_id_hash, github_user_id, action, expected_signal, status, created_at, expires_at)
         VALUES (?, 'enroll', ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      )
      .run(requestId, rp.nonce, session.id_hash, session.github_user_id, world.enrollAction, signal, new Date().toISOString(), rp.expiresAt.toISOString());

    return c.json({
      requestId,
      app_id: world.appId,
      action: world.enrollAction,
      environment: world.environment,
      rp_context: rp.rpContext,
      signal,
      require_user_presence: world.requireUserPresence,
      allow_legacy_proofs: false,
    });
  });

  app.post("/api/world/enrollment/complete", requireMaintainer(deps), async (c) => {
    const world = requireWorld(deps);
    const session = c.get("session");
    const body = CompleteSchema.parse(await c.req.json());
    const request = deps.db.prepare("SELECT * FROM world_proof_requests WHERE id = ?").get(body.requestId) as ProofRequestRow | undefined;
    if (!request) throw new ApiError(400, "unknown_nonce");

    const local = checkEnrollmentResult(body.idkitResult, {
      environment: world.environment,
      action: world.enrollAction,
      signal: request.expected_signal,
      requireUserPresence: world.requireUserPresence,
    });
    if (!local.ok) throw new ApiError(400, local.reason);
    claimProofRequest(deps, local.value.nonce, { purpose: "enroll", requestId: body.requestId, sessionIdHash: session.id_hash, githubUserId: session.github_user_id });
    if (activeEnrollment(deps.db, session.github_user_id)) throw new ApiError(409, "already_enrolled");

    const verified = await verifyWithWorld(deps.fetch ?? fetch, world, body.idkitResult);
    if (!verified.ok) {
      rejectProofRequest(deps, request.id, verified.reason);
      recordEvent(deps.db, "world.enrollment_rejected", null, { reason: verified.reason });
      throw new ApiError(422, "world_verification_failed", { reason: verified.reason });
    }
    if (verified.sessionId !== undefined && verified.sessionId !== local.value.sessionId) {
      rejectProofRequest(deps, request.id, "verify_session_mismatch");
      throw new ApiError(422, "world_verification_failed", { reason: "verify_session_mismatch" });
    }

    const enrollmentId = newId("wen");
    try {
      transaction(deps.db, () => {
        const claimed = deps.db
          .prepare("UPDATE world_proof_requests SET status = 'verified', completed_at = ? WHERE id = ? AND status = 'issued'")
          .run(new Date().toISOString(), request.id);
        if (Number(claimed.changes) !== 1) throw new ApiError(409, "nonce_already_used");
        deps.db
          .prepare(
            `INSERT INTO world_enrollments (id, github_user_id, github_login, environment, rp_id, enroll_action, nullifier, session_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(enrollmentId, session.github_user_id, session.github_login, world.environment, world.rpId, world.enrollAction, local.value.nullifier, local.value.sessionId, new Date().toISOString());
        recordEvent(deps.db, "world.enrolled", null, { enrollmentId, environment: world.environment });
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      rejectProofRequest(deps, request.id, "duplicate_enrollment");
      recordEvent(deps.db, "world.enrollment_rejected", null, { reason: "duplicate_enrollment" });
      throw new ApiError(409, "world_id_already_enrolled");
    }
    return c.json({ enrollment: { id: enrollmentId, environment: world.environment } }, 201);
  });
}