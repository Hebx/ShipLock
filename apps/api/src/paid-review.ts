import { verifyPaidReviewResult } from "@shiplock/policy";
import type { PaidReviewResult } from "@shiplock/shared";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppDeps, AppEnv } from "./app.ts";
import type { ReceiptRow } from "./authorizations.ts";
import { transaction } from "./db/index.ts";
import { ApiError, isUniqueViolation } from "./errors.ts";
import { checkHederaTransfer } from "./mirror-node.ts";
import { toReviewJob, syncPullRequest } from "./review-service.ts";
import { getJob, getReceipt, newId, recordEvent, StaleHeadError, transitionJob, type ReviewJobRow } from "./store.ts";

const BodySchema = z.strictObject({ adapterId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/), result: z.unknown() });

const now = () => new Date().toISOString();

function accept(deps: AppDeps, job: ReviewJobRow, r: PaidReviewResult, ledgerVerified: boolean) {
  transaction(deps.db, () => {
    if (ledgerVerified) {
      deps.db.prepare("UPDATE payment_receipts SET ledger_verified_at = ? WHERE review_job_id = ? AND ledger_verified_at IS NULL").run(now(), job.id);
    }
    const insert = deps.db.prepare(
      "INSERT INTO review_findings (review_job_id, source, rule_id, severity, file, line, description, evidence) VALUES (?, 'paid', ?, ?, ?, ?, ?, ?)",
    );
    deps.db.prepare("DELETE FROM review_findings WHERE review_job_id = ? AND source = 'paid'").run(job.id);
    for (const f of r.report.findings) insert.run(job.id, f.ruleId, f.severity, f.file, f.line ?? null, f.description, f.evidence ?? null);
    const blocked = r.report.conclusion === "block";
    transitionJob(deps.db, job.id, blocked ? "review_blocked" : "paid_review_confirmed", blocked ? "paid review found blocking issues" : `paid review accepted (${r.evidenceKind})`);
    recordEvent(deps.db, "paid_review.accepted", job.id, { hederaTransactionId: r.hederaTransactionId, evidenceKind: r.evidenceKind, ledgerVerified, reportSha256: r.reportSha256 });
  });
}

/**
 * Agent-facing: accepts a purchased review only if it binds to this job and ShipLock's own
 * digest, the payment terms match configuration, and (for non-simulated evidence) the Hedera
 * mirror node independently shows the transfer. Retrying with the same result is idempotent.
 */
export function registerPaidReviewRoutes(app: Hono<AppEnv>, deps: AppDeps, requireAgent: MiddlewareHandler<AppEnv>): void {
  app.post("/api/reviews/:jobId/paid-review", requireAgent, async (c) => {
    const cfg = deps.config.paidReview;
    if (!cfg) throw new ApiError(503, "paid_review_not_configured");
    const body = BodySchema.parse(await c.req.json());
    const job = getJob(deps.db, c.req.param("jobId") ?? "");
    if (!job) throw new ApiError(404, "not_found");
    if (!job.local_report_sha256) throw new ApiError(409, "local_analysis_required");

    const verdict = verifyPaidReviewResult(toReviewJob(job), body.result, {
      network: cfg.network,
      asset: cfg.asset,
      merchantAccountId: cfg.merchantAccountId,
      quotedTinybar: cfg.quotedTinybar,
      maxTinybar: cfg.maxTinybar,
      allowedEvidenceKinds: cfg.acceptedEvidence,
      independentReportSha256: job.local_report_sha256,
      diffSha256: job.diff_sha256 ?? undefined,
    });
    if (!verdict.ok) {
      recordEvent(deps.db, "paid_review.rejected", job.id, { reasons: verdict.reasons.join("; ").slice(0, 500) });
      throw new ApiError(422, "paid_review_rejected", { reasons: verdict.reasons });
    }
    const r = verdict.result;

    const existing = getReceipt(deps.db, job.id) as ReceiptRow | undefined;
    if (existing && existing.hedera_transaction_id !== r.hederaTransactionId) throw new ApiError(409, "paid_review_already_recorded");
    const awaitingLedger = existing !== undefined && existing.evidence_kind !== "simulated" && !existing.ledger_verified_at;
    if (existing && !awaitingLedger) return c.json({ status: "accepted", jobState: job.state });
    if (!existing && job.state !== "review_pending") throw new ApiError(409, "job_not_awaiting_review", { state: job.state });

    if (!existing) {
      const live = await deps.github.getPullRequest(job.repository, job.pull_number);
      if (live.headSha !== job.head_sha) {
        await syncPullRequest(deps, job.repository, job.pull_number).catch(() => undefined);
        throw new StaleHeadError(job.id, job.head_sha, live.headSha);
      }
    }

    const ledger =
      r.evidenceKind === "simulated"
        ? null
        : await checkHederaTransfer(deps.fetch ?? fetch, cfg.mirrorNodeUrl, {
            transactionId: r.hederaTransactionId,
            payer: r.payerAccountId,
            merchant: r.merchantAccountId,
            amountTinybar: r.amountBaseUnits,
          });
    if (ledger?.kind === "mismatch") {
      transaction(deps.db, () => {
        if (existing) deps.db.prepare("DELETE FROM payment_receipts WHERE id = ? AND ledger_verified_at IS NULL").run(existing.id);
        recordEvent(deps.db, "paid_review.ledger_mismatch", job.id, { hederaTransactionId: r.hederaTransactionId, reason: ledger.reason });
      });
      throw new ApiError(422, "paid_review_rejected", { reasons: [ledger.reason] });
    }

    if (!existing) {
      try {
        transaction(deps.db, () => {
          deps.db
            .prepare(
              `INSERT INTO payment_receipts (id, review_job_id, hedera_transaction_id, network, asset, amount_base_units, payer_account_id,
                 merchant_account_id, vendor_id, adapter_id, evidence_kind, report_sha256, report_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(newId("rcpt"), job.id, r.hederaTransactionId, r.network, r.asset, r.amountBaseUnits, r.payerAccountId, r.merchantAccountId, r.vendorId, body.adapterId, r.evidenceKind, r.reportSha256, JSON.stringify(r.report), now());
          recordEvent(deps.db, "paid_review.received", job.id, { hederaTransactionId: r.hederaTransactionId, evidenceKind: r.evidenceKind, adapterId: body.adapterId });
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ApiError(409, "transaction_already_used");
        throw err;
      }
    }

    if (ledger?.kind === "unknown") {
      recordEvent(deps.db, "paid_review.ledger_pending", job.id, { hederaTransactionId: r.hederaTransactionId, reason: ledger.reason });
      return c.json({ status: "ledger_pending", reason: ledger.reason, jobState: getJob(deps.db, job.id)!.state }, 202);
    }
    accept(deps, job, r, ledger?.kind === "confirmed");
    return c.json({ status: "accepted", jobState: getJob(deps.db, job.id)!.state });
  });
}
