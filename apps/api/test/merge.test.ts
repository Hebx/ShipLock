import { MergeOutcomeUnknownError, type GitHubClient } from "@shiplock/github";
import { describe, expect, it, vi } from "vitest";
import { getJob } from "../src/store.ts";
import { MERGE_SHA, REPO, SHA2, SHA3, setup, testConfig } from "./harness.ts";

type Attempt = { mergeAttempt: { status: string; reason: string | null; mergeCommitSha: string | null; githubHttpStatus: number | null; mergeUrl: string | null }; jobState: string };

describe("merge executor (unit, in-memory GitHub)", () => {
  it("merges the approved SHA with the sha precondition, exactly once", async () => {
    const t = setup();
    const { jobId, session, created } = await t.approvedAuthorization();
    const res = await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Attempt;
    expect(body).toMatchObject({ jobState: "merged", mergeAttempt: { status: "merged", mergeCommitSha: MERGE_SHA, githubHttpStatus: 200, mergeUrl: `https://github.com/${REPO}/pull/7` } });
    expect(t.gh.mergeCalls).toEqual([{ sha: SHA2, method: "squash" }]);
    expect(getJob(t.db, jobId)!.state).toBe("merged");

    const again = await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session });
    expect(await again.json()).toEqual({ error: "authorization_already_used" });
    expect(t.gh.mergeCalls).toHaveLength(1);
  });

  it("concurrent executes: exactly one reaches GitHub", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    const results = await Promise.all([1, 2, 3].map(() => t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(t.gh.mergeCalls).toHaveLength(1);
  });

  it("requires CSRF and an approved, fresh authorization", async () => {
    const t = setup();
    const p = await t.pendingAuthorization();
    expect((await t.call("POST", `/api/merges/${p.created.authorization.id}/execute`, { session: p.session, csrf: null })).status).toBe(403);
    expect(await (await t.call("POST", `/api/merges/${p.created.authorization.id}/execute`, { session: p.session })).json()).toMatchObject({ error: "authorization_not_approved" });
    expect((await t.approve(p.session, p.created)).status).toBe(200);
    t.db.prepare("UPDATE merge_authorizations SET approved_at = '2000-01-01T00:00:00.000Z'").run();
    expect(await (await t.call("POST", `/api/merges/${p.created.authorization.id}/execute`, { session: p.session })).json()).toEqual({ error: "approval_not_fresh" });
    t.db.prepare("UPDATE merge_authorizations SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect(await (await t.call("POST", `/api/merges/${p.created.authorization.id}/execute`, { session: p.session })).json()).toMatchObject({ error: "authorization_not_approved", detail: { status: "expired" } });
    expect(t.gh.mergeCalls).toHaveLength(0);
  });

  it("head SHA changed after approval: pre-check refuses and the job goes stale", async () => {
    const t = setup();
    const { jobId, session, created } = await t.approvedAuthorization();
    t.gh.head = SHA3;
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body).toMatchObject({ jobState: "stale", mergeAttempt: { status: "blocked", reason: "head_sha_changed" } });
    expect(t.gh.mergeCalls).toHaveLength(0);
    expect(getJob(t.db, jobId)!.state).toBe("stale");
    expect(t.db.prepare("SELECT count(*) AS n FROM review_jobs WHERE head_sha = ?").get(SHA3)!.n).toBe(1);
  });

  it("head SHA changed between pre-check and merge: GitHub 409 => stale, no retry", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    t.gh.onMerge = async () => {
      t.gh.head = SHA3;
      return { kind: "head_changed", httpStatus: 409 };
    };
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body).toMatchObject({ jobState: "stale", mergeAttempt: { status: "blocked", githubHttpStatus: 409, reason: "github_rejected_changed_head" } });
    expect(t.gh.mergeCalls).toHaveLength(1);
  });

  it("failed or pending check runs, failing statuses and missing required checks block the merge", async () => {
    const cases: Array<[(gh: ReturnType<typeof setup>["gh"]) => void, RegExp]> = [
      [(gh) => (gh.checkRuns = [{ name: "ci", status: "completed", conclusion: "failure", appSlug: null, appId: null }]), /^checks_not_green:ci/],
      [(gh) => (gh.checkRuns = [{ name: "ci", status: "in_progress", conclusion: null, appSlug: null, appId: null }]), /^checks_not_green:ci/],
      [(gh) => (gh.combined = { state: "failure", totalCount: 1, statuses: [{ context: "lint", state: "failure" }] }), /^commit_status_failure$/],
      [(gh) => (gh.checkRuns = []), /^required_checks_missing:ci$/],
      [(gh) => (gh.checkRuns = [{ name: "ci", status: "completed", conclusion: "success", appSlug: "impostor", appId: 999 }]), /^required_checks_missing:ci$/],
      [(gh) => (gh.mergeable = false), /^not_mergeable$/],
    ];
    for (const [mutate, reason] of cases) {
      const t = setup();
      const { jobId, session, created } = await t.approvedAuthorization();
      mutate(t.gh);
      const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
      expect(body.mergeAttempt.status).toBe("blocked");
      expect(body.mergeAttempt.reason).toMatch(reason);
      expect(t.gh.mergeCalls).toHaveLength(0);
      // The approval is consumed; a fresh human approval is required.
      expect(getJob(t.db, jobId)!.state).toBe("paid_review_confirmed");
      expect(t.db.prepare("SELECT status FROM merge_authorizations").get()!.status).toBe("consumed");
    }
  });

  it("permission revoked after approval blocks the merge", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    t.gh.permissions.maint = { userId: 1001, permission: "read", roleName: "read" };
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body.mergeAttempt).toMatchObject({ status: "blocked", reason: "insufficient_repository_permission" });
    expect(t.gh.mergeCalls).toHaveLength(0);
  });

  it("a repository removed from the allowlist cannot be merged", async () => {
    const t = setup();
    const { jobId, session, created } = await t.approvedAuthorization();
    t.gh.allowed = "Hebx/other-demo";
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body.mergeAttempt).toMatchObject({ status: "blocked", reason: "repository_not_allowed" });
    expect(getJob(t.db, jobId)!.state).toBe("failed");
    expect(t.gh.mergeCalls).toHaveLength(0);
  });

  it("a tampered stored operation fails its hash check before anything is consumed", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    t.db.prepare("UPDATE merge_authorizations SET operation_json = replace(operation_json, ?, ?)").run(REPO, "Hebx/ShipLock");
    const tampered = await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session });
    expect(await tampered.json()).toEqual({ error: "operation_hash_mismatch" });
    expect(t.gh.mergeCalls).toHaveLength(0);
  });

  it("a simulated paid review never reaches the merge call", async () => {
    const t = setup(testConfig({ paidReview: { ...testConfig().paidReview!, acceptedEvidence: ["live", "simulated"] } }));
    const session = t.login();
    const jobId = await t.createJob();
    await t.submitPaidReview(jobId, t.paidResult(jobId, { evidenceKind: "simulated" }));
    await t.enroll(session);
    const created = (await (await t.call("POST", "/api/authorizations", { session, body: { jobId } })).json()) as Parameters<typeof t.approve>[1];
    expect((await t.approve(session, created)).status).toBe(200);
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body.mergeAttempt).toMatchObject({ status: "blocked", reason: "simulated_paid_review_cannot_merge" });
    expect(t.gh.mergeCalls).toHaveLength(0);
  });

  it("staging World proofs cannot merge unless development merges are enabled; nothing is consumed", async () => {
    const t = setup(testConfig({ allowDevelopmentMerge: false }));
    const { jobId, session, created } = await t.approvedAuthorization();
    const res = await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "development_evidence_cannot_merge", detail: { worldEnvironment: "staging", paidReviewEvidenceKind: "live" } });
    expect(t.gh.mergeCalls).toHaveLength(0);
    expect(getJob(t.db, jobId)!.state).toBe("approved");
    expect(t.db.prepare("SELECT status FROM merge_authorizations").get()!.status).toBe("approved");
  });

  it("405/422 from GitHub are recorded as blocked with the status", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    t.gh.onMerge = async () => ({ kind: "rejected", httpStatus: 405 });
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body).toMatchObject({ jobState: "paid_review_confirmed", mergeAttempt: { status: "blocked", githubHttpStatus: 405, reason: "github_refused_merge_405" } });
  });

  it("an unknown outcome is reconciled by reading the PR, never by retrying the merge", async () => {
    const t = setup();
    const { jobId, session, created } = await t.approvedAuthorization();
    t.gh.onMerge = async () => {
      throw new MergeOutcomeUnknownError("TimeoutError");
    };
    const pending = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(pending).toMatchObject({ jobState: "reconcile_required", mergeAttempt: { status: "uncertain" } });

    // GitHub actually merged it.
    t.gh.merged = true;
    t.gh.state = "closed";
    t.gh.mergeCommitSha = MERGE_SHA;
    const done = (await (await t.call("POST", `/api/merges/${created.authorization.id}/reconcile`, { session })).json()) as Attempt;
    expect(done).toMatchObject({ jobState: "merged", mergeAttempt: { status: "merged", mergeCommitSha: MERGE_SHA, reason: "reconciled" } });
    expect(t.gh.mergeCalls).toHaveLength(1);
    expect(getJob(t.db, jobId)!.state).toBe("merged");
  });

  it("an error after GitHub merged is recorded as uncertain and reconciled to merged", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    t.gh.onMerge = async () => {
      t.gh.merged = true;
      t.gh.state = "closed";
      t.gh.mergeCommitSha = MERGE_SHA;
      throw new Error("post-merge failure");
    };
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body).toMatchObject({ jobState: "merged", mergeAttempt: { status: "merged", reason: "reconciled" } });
    expect(t.gh.mergeCalls).toHaveLength(1);
  });

  it("an attempt interrupted mid-merge is reconcilable only once stale, and never re-sent", async () => {
    for (const githubMerged of [true, false]) {
      const t = setup();
      const { jobId, session, created } = await t.approvedAuthorization();
      t.gh.onMerge = () => new Promise(() => {});
      void t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session });
      await vi.waitFor(() => expect(t.gh.mergeCalls).toHaveLength(1));
      const reconcile = () => t.call("POST", `/api/merges/${created.authorization.id}/reconcile`, { session });
      expect(await (await reconcile()).json()).toEqual({ error: "nothing_to_reconcile" });

      t.db.prepare("UPDATE merge_attempts SET started_at = '2000-01-01T00:00:00.000Z'").run();
      if (githubMerged) {
        t.gh.merged = true;
        t.gh.state = "closed";
        t.gh.mergeCommitSha = MERGE_SHA;
      }
      const body = (await (await reconcile()).json()) as Attempt;
      expect(body).toMatchObject(
        githubMerged
          ? { jobState: "merged", mergeAttempt: { status: "merged", reason: "reconciled" } }
          : { jobState: "paid_review_confirmed", mergeAttempt: { status: "blocked", reason: "merge_not_performed" } },
      );
      expect(getJob(t.db, jobId)!.state).toBe(body.jobState);
      expect(t.gh.mergeCalls).toHaveLength(1);
    }
  });

  it("an unknown outcome where the head moved resolves to stale", async () => {
    const t = setup();
    const { session, created } = await t.approvedAuthorization();
    const gh = t.gh as GitHubClient & typeof t.gh;
    gh.onMerge = async () => {
      gh.head = SHA3;
      throw new MergeOutcomeUnknownError("GitHub 502");
    };
    const body = (await (await t.call("POST", `/api/merges/${created.authorization.id}/execute`, { session })).json()) as Attempt;
    expect(body).toMatchObject({ jobState: "stale", mergeAttempt: { status: "blocked", reason: "head_sha_changed" } });
  });
});
