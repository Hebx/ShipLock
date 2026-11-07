import { describe, expect, it } from "vitest";
import { getJob } from "../src/store.ts";
import { enrollmentResult, OTHER, SHA3, sessionResult, setup, testConfig, type EnrollStart } from "./harness.ts";

const count = (db: ReturnType<typeof setup>["db"], table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

describe("World ID enrollment (unit, stubbed World verify)", () => {
  it("binds one verified Proof of Human session to the GitHub user", async () => {
    const t = setup();
    const s = t.login();
    const { start, res } = await t.enroll(s);
    expect(res.status).toBe(201);
    expect(start).toMatchObject({ action: "shiplock-enroll", environment: "staging", allow_legacy_proofs: false, require_user_presence: true });
    expect(start.signal).toMatch(/^shiplock-enroll:v1:1001:wpr_/);
    const verify = t.net.calls.filter((c) => c.url.includes("/verify/"));
    expect(verify).toHaveLength(1);
    const row = t.db.prepare("SELECT nullifier, session_id, github_user_id FROM world_enrollments").get()!;
    expect(row.nullifier).toMatch(/^nil_[0-9a-f]{64}$/);
    expect(row.github_user_id).toBe(1001);
    expect((await (await t.call("POST", "/api/world/enrollment/start", { session: s })).json())).toEqual({ error: "already_enrolled" });
  });

  it("refuses one World ID for two GitHub users, even re-encoded as decimal", async () => {
    const t = setup();
    const hex = "0x" + "1".repeat(60);
    expect((await t.enroll(t.login(), hex)).res.status).toBe(201);
    const second = await t.enroll(t.login(OTHER), BigInt(hex).toString(10));
    expect(second.res.status).toBe(409);
    expect(await second.res.json()).toEqual({ error: "world_id_already_enrolled" });
    expect(count(t.db, "world_enrollments")).toBe(1);
  });

  it("concurrent duplicate enrollments for one human: exactly one wins", async () => {
    const t = setup();
    const a = t.login();
    const b = t.login(OTHER);
    const sa = (await (await t.call("POST", "/api/world/enrollment/start", { session: a })).json()) as EnrollStart;
    const sb = (await (await t.call("POST", "/api/world/enrollment/start", { session: b })).json()) as EnrollStart;
    const results = await Promise.all([
      t.call("POST", "/api/world/enrollment/complete", { session: a, body: { requestId: sa.requestId, idkitResult: enrollmentResult(sa) } }),
      t.call("POST", "/api/world/enrollment/complete", { session: b, body: { requestId: sb.requestId, idkitResult: enrollmentResult(sb) } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(count(t.db, "world_enrollments")).toBe(1);
  });

  it("rejects env mismatch, wrong signal, wrong action, missing presence and cross-session nonces before calling World", async () => {
    const t = setup();
    const s = t.login();
    const start = (await (await t.call("POST", "/api/world/enrollment/start", { session: s })).json()) as EnrollStart;
    const complete = (idkitResult: unknown, session = s) => t.call("POST", "/api/world/enrollment/complete", { session, body: { requestId: start.requestId, idkitResult } });
    const err = async (r: Response) => ((await r.json()) as { error: string }).error;
    expect(await err(await complete(enrollmentResult(start, { environment: "production" })))).toBe("environment_mismatch");
    expect(await err(await complete(enrollmentResult(start, { signal: "shiplock-enroll:v1:2002:x" })))).toBe("signal_mismatch");
    expect(await err(await complete({ ...enrollmentResult(start), action: "other-action" }))).toBe("action_mismatch");
    expect(await err(await complete(enrollmentResult(start, { presence: false })))).toBe("user_presence_missing");
    expect(await err(await complete({ ...enrollmentResult(start), nonce: "0x" + "9".repeat(64) }))).toBe("unknown_nonce");
    expect(await err(await complete(enrollmentResult(start), t.login()))).toBe("nonce_not_bound_to_session");
    expect(t.net.calls.filter((c) => c.url.includes("/verify/"))).toHaveLength(0);
  });

  it("does not enroll when World verify fails, and the nonce cannot be reused", async () => {
    const t = setup();
    const s = t.login();
    t.net.verify = () => Response.json({ success: false, code: "invalid_proof", detail: "x" }, { status: 400 });
    const { start, res } = await t.enroll(s);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "world_verification_failed", detail: { reason: "verify_http_400:invalid_proof" } });
    t.net.verify = (b) => Response.json({ success: true, environment: "staging", session_id: b.session_id });
    const retry = await t.call("POST", "/api/world/enrollment/complete", { session: s, body: { requestId: start.requestId, idkitResult: enrollmentResult(start) } });
    expect(await retry.json()).toEqual({ error: "nonce_already_used" });
    expect(count(t.db, "world_enrollments")).toBe(0);
  });

  it("rejects an expired RP nonce", async () => {
    const t = setup();
    const s = t.login();
    const start = (await (await t.call("POST", "/api/world/enrollment/start", { session: s })).json()) as EnrollStart;
    t.db.prepare("UPDATE world_proof_requests SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const res = await t.call("POST", "/api/world/enrollment/complete", { session: s, body: { requestId: start.requestId, idkitResult: enrollmentResult(start) } });
    expect(await res.json()).toEqual({ error: "nonce_expired" });
  });
});

describe("merge authorization (unit)", () => {
  it("builds the operation from server state and asks for a session proof over its hash", async () => {
    const t = setup();
    const { jobId, created, res } = await t.pendingAuthorization();
    expect(res.status).toBe(201);
    const job = getJob(t.db, jobId)!;
    expect(job.state).toBe("approval_pending");
    expect(created.operation).toMatchObject({
      schema: "shiplock.merge-operation/v2", action: "merge_pull_request", repositoryId: 1234, pullNumber: 7, headSha: job.head_sha,
      reportSha256: job.local_report_sha256, approverGithubLogin: "maint", approverGithubUserId: 1001, worldEnvironment: "staging",
      worldRpId: "rp_test", paidReviewEvidenceKind: "live", mergeMethod: "squash",
    });
    expect(created.idkit).toMatchObject({ signal: created.operationHash, environment: "staging", require_user_presence: true });
    expect(Date.parse(created.operation.expiresAt as string) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("refuses without enrollment, without repository permission, or for a non-passing review", async () => {
    const t = setup();
    const s = t.login();
    const jobId = await t.createJob();
    await t.submitPaidReview(jobId);
    const create = () => t.call("POST", "/api/authorizations", { session: s, body: { jobId } });
    expect(await (await create()).json()).toEqual({ error: "world_enrollment_required" });
    await t.enroll(s);
    t.gh.permissions.maint = { userId: 1001, permission: "read", roleName: "triage" };
    expect(await (await create()).json()).toMatchObject({ error: "insufficient_repository_permission" });
    t.gh.permissions.maint = { userId: 9999, permission: "write", roleName: "write" };
    expect(await (await create()).json()).toEqual({ error: "github_identity_mismatch" });

    const blocked = await t.createJob("1".repeat(40));
    expect(await (await t.call("POST", "/api/authorizations", { session: s, body: { jobId: blocked } })).json()).toMatchObject({ error: "job_not_ready_for_approval" });
  });

  it("refuses when the head moved and marks the job stale", async () => {
    const t = setup();
    const s = t.login();
    const jobId = await t.createJob();
    await t.submitPaidReview(jobId);
    await t.enroll(s);
    t.gh.head = SHA3;
    const res = await t.call("POST", "/api/authorizations", { session: s, body: { jobId } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale_head_sha" });
    expect(getJob(t.db, jobId)!.state).toBe("stale");
  });

  it("refuses a simulated paid review unless explicitly enabled", async () => {
    const t = setup(testConfig({ paidReview: { ...testConfig().paidReview!, acceptedEvidence: ["live", "simulated"] } }));
    const s = t.login();
    const jobId = await t.createJob();
    await t.submitPaidReview(jobId, t.paidResult(jobId, { evidenceKind: "simulated" }));
    await t.enroll(s);
    const res = await t.call("POST", "/api/authorizations", { session: s, body: { jobId } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { operation: { paidReviewEvidenceKind: string } }).operation.paidReviewEvidenceKind).toBe("simulated");
  });
});

describe("World ID approval (unit, stubbed World verify)", () => {
  it("approves once with a verified session proof over the operation hash", async () => {
    const t = setup();
    const { jobId, session, created } = await t.pendingAuthorization();
    const res = await t.approve(session, created);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authorization: { status: "approved" } });
    expect(getJob(t.db, jobId)!.state).toBe("approved");
    expect(count(t.db, "world_session_nullifiers")).toBe(1);
    const again = await t.approve(session, created);
    expect(await again.json()).toMatchObject({ error: "authorization_not_pending" });
  });

  it("ignores a client-built success: nothing but a verified proof approves", async () => {
    const t = setup();
    const { jobId, session, created } = await t.pendingAuthorization();
    for (const fake of [{ success: true }, { success: true, verified: true, environment: "staging" }]) {
      const res = await t.approve(session, created, created.idkit, fake);
      expect(res.status).toBe(400);
    }
    t.net.verify = () => Response.json({ success: false, code: "invalid_proof", detail: "x" }, { status: 400 });
    expect((await t.approve(session, created)).status).toBe(422);
    expect(getJob(t.db, jobId)!.state).toBe("approval_pending");
  });

  it("rejects an operation proof for a different SHA (signal mismatch)", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    const otherOp = { ...created.idkit, signal: "f".repeat(64) };
    const res = await t.approve(session, created, created.idkit, sessionResult(otherOp));
    expect(await res.json()).toEqual({ error: "signal_mismatch" });
  });

  it("rejects a proof from a different human's World session", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    const res = await t.approve(session, created, created.idkit, sessionResult(created.idkit, { sessionId: `session_${"cd".repeat(64)}` }));
    expect(await res.json()).toEqual({ error: "world_session_mismatch" });
    expect(t.net.calls.filter((c) => c.url.includes("/verify/"))).toHaveLength(1);
  });

  it("requires user presence when configured", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    expect(await (await t.approve(session, created, created.idkit, sessionResult(created.idkit, { presence: false }))).json()).toEqual({ error: "user_presence_missing" });
    expect(await (await t.approve(session, created, created.idkit, sessionResult(created.idkit, { presence: undefined }))).json()).toEqual({ error: "user_presence_missing" });
  });

  it("rejects environment mismatch in the result and in World's response", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    expect(await (await t.approve(session, created, created.idkit, sessionResult(created.idkit, { environment: "production" }))).json()).toEqual({ error: "environment_mismatch" });
    t.net.verify = (b) => Response.json({ success: true, environment: "production", session_id: b.session_id });
    expect(await (await t.approve(session, created)).json()).toEqual({ error: "world_verification_failed", detail: { reason: "verify_environment_mismatch" } });
  });

  it("treats verify 404, timeout and success:false as failure", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    const fresh = async () =>
      ((await (await t.call("POST", `/api/authorizations/${created.authorization.id}/proof-request`, { session })).json()) as { idkit: typeof created.idkit }).idkit;
    t.net.verify = () => Response.json({ success: false, code: "app_not_found", detail: "x" }, { status: 404 });
    expect(await (await t.approve(session, created)).json()).toMatchObject({ detail: { reason: "verify_http_404:app_not_found" } });
    t.net.verify = () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    let idkit = await fresh();
    expect(await (await t.approve(session, created, idkit)).json()).toMatchObject({ detail: { reason: "verify_unreachable" } });
    t.net.verify = () => Response.json({ success: false });
    idkit = await fresh();
    expect(await (await t.approve(session, created, idkit)).json()).toMatchObject({ detail: { reason: "verify_not_successful" } });
    expect(t.db.prepare("SELECT status FROM merge_authorizations").get()!.status).toBe("pending");
  });

  it("rejects unknown, reused, cross-session and cross-authorization nonces", async () => {
    const t = setup();
    const { session, created } = await t.pendingAuthorization();
    expect(await (await t.approve(session, created, created.idkit, sessionResult(created.idkit, { nonce: "0x" + "9".repeat(64) }))).json()).toEqual({ error: "unknown_nonce" });
    // A nonce issued for enrollment cannot approve a merge.
    const enrollNonce = t.db.prepare("SELECT id, rp_nonce FROM world_proof_requests WHERE purpose = 'enroll'").get()!;
    const crossPurpose = { ...created.idkit, requestId: String(enrollNonce.id), rp_context: { ...created.idkit.rp_context, nonce: String(enrollNonce.rp_nonce) } };
    expect(await (await t.approve(session, created, crossPurpose)).json()).toEqual({ error: "unknown_nonce" });
    // Another browser session of the same GitHub user cannot use this authorization's nonce.
    const other = t.login();
    expect(await (await t.approve(other, created)).json()).toEqual({ error: "authorization_bound_to_other_session" });

    expect((await t.approve(session, created)).status).toBe(200);
  });

  it("rejects a replayed session nullifier, including concurrent duplicates", async () => {
    const t = setup();
    const session = t.login();
    const first = await t.pendingAuthorization(session, 7);
    const second = await t.pendingAuthorization(session, 8);
    const nullifier = "0x" + "4".repeat(60);
    expect((await t.approve(session, first.created, first.created.idkit, sessionResult(first.created.idkit, { nullifier }))).status).toBe(200);

    // Same nullifier (decimal-encoded) presented for another PR's authorization: replay.
    const replay = await t.approve(session, second.created, second.created.idkit, sessionResult(second.created.idkit, { nullifier: BigInt(nullifier).toString(10) }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "world_proof_replayed" });
    expect(getJob(t.db, second.jobId)!.state).toBe("approval_pending");
    expect(t.db.prepare("SELECT status, failure_reason FROM world_proof_requests WHERE id = ?").get(second.created.idkit.requestId)).toMatchObject({
      status: "rejected",
      failure_reason: "session_nullifier_replayed",
    });

    const t3 = setup();
    const p = await t3.pendingAuthorization();
    const r1 = { ...p.created.idkit };
    const r2 = ((await (await t3.call("POST", `/api/authorizations/${p.created.authorization.id}/proof-request`, { session: p.session })).json()) as { idkit: typeof r1 }).idkit;
    const n = "0x" + "5".repeat(60);
    const results = await Promise.all([
      t3.approve(p.session, p.created, r1, sessionResult(r1, { nullifier: n })),
      t3.approve(p.session, p.created, r2, sessionResult(r2, { nullifier: n })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(count(t3.db, "world_session_nullifiers")).toBe(1);
  });

  it("cancel and deny leave the job unapproved and block later approval", async () => {
    for (const kind of ["cancel", "deny"] as const) {
      const t = setup();
      const { jobId, session, created } = await t.pendingAuthorization();
      const res = await t.call("POST", `/api/authorizations/${created.authorization.id}/${kind}`, { session, body: kind === "cancel" ? { errorCode: "user_rejected" } : {} });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ authorization: { status: "denied", statusReason: kind === "cancel" ? "world_cancelled:user_rejected" : "maintainer_denied" } });
      expect(getJob(t.db, jobId)!.state).toBe("denied");
      expect(await (await t.approve(session, created)).json()).toMatchObject({ error: "authorization_not_pending" });
      expect(t.net.calls.filter((c) => c.url.includes("/verify/"))).toHaveLength(1); // enrollment only
    }
  });

  it("an expired authorization cannot be approved", async () => {
    const t = setup();
    const { jobId, session, created } = await t.pendingAuthorization();
    t.db.prepare("UPDATE merge_authorizations SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect(await (await t.approve(session, created)).json()).toMatchObject({ error: "authorization_not_pending", detail: { status: "expired" } });
    expect(getJob(t.db, jobId)!.state).toBe("expired");
  });

  it("another maintainer cannot approve, deny or execute someone else's authorization", async () => {
    const t = setup();
    const { created } = await t.pendingAuthorization();
    const other = t.login(OTHER);
    expect((await t.approve(other, created)).status).toBe(403);
    expect((await t.call("POST", `/api/authorizations/${created.authorization.id}/deny`, { session: other, body: {} })).status).toBe(403);
    expect((await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session: other })).status).toBe(403);
  });
});
