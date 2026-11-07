import { describe, expect, it } from "vitest";
import { getJob } from "../src/store.ts";
import { MERCHANT, PAYER, setup, SHA3, testConfig } from "./harness.ts";

describe("paid review acceptance (unit, stubbed mirror node)", () => {
  it("accepts a bound live result after independent mirror-node confirmation, idempotently", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const res = await t.submitPaidReview(jobId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "accepted", jobState: "paid_review_confirmed" });
    expect(t.net.calls.find((c) => c.url.includes("mirror"))!.url).toBe("https://mirror.test/api/v1/transactions/0.0.1001-1762480000-000000001");
    const detail = (await (await t.call("GET", `/api/reviews/${jobId}`)).json()) as { paidReview: Record<string, unknown> };
    expect(detail.paidReview).toMatchObject({ evidenceKind: "live", hashscanUrl: "https://hashscan.io/testnet/transaction/0.0.1001-1762480000-000000001" });
    expect(detail.paidReview.ledgerVerifiedAt).toBeTruthy();
    expect((await t.submitPaidReview(jobId)).status).toBe(200);
    expect(t.db.prepare("SELECT count(*) AS n FROM payment_receipts").get()!.n).toBe(1);
  });

  it("requires the agent bearer token", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const res = await t.call("POST", `/api/reviews/${jobId}/paid-review`, { body: { adapterId: "x", result: t.paidResult(jobId) } });
    expect(res.status).toBe(401);
  });

  it("refuses simulated evidence when live is required", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const res = await t.submitPaidReview(jobId, t.paidResult(jobId, { evidenceKind: "simulated" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "paid_review_rejected", detail: { reasons: ["evidence kind simulated not accepted here"] } });
    expect(getJob(t.db, jobId)!.state).toBe("review_pending");
  });

  it("refuses a report whose digest differs from ShipLock's own analysis", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const r = t.paidResult(jobId);
    const res = await t.submitPaidReview(jobId, { ...r, report: { ...r.report, findings: [] , stats: { ...r.report.stats, additions: 42 } } });
    expect(await res.json()).toMatchObject({ error: "paid_review_rejected" });
  });

  it("rejects a mirror-node mismatch (wrong amount, wrong payee, failed tx) and records nothing", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const tx = (transfers: Array<{ account: string; amount: number }>, result = "SUCCESS") => (id: string) =>
      Response.json({ transactions: [{ transaction_id: id, consensus_timestamp: "1.0", result, name: "CRYPTOTRANSFER", nonce: 0, transfers }] });
    for (const [mirror, reason] of [
      [tx([{ account: PAYER, amount: -999 }, { account: MERCHANT, amount: 999 }]), "ledger_merchant_amount_mismatch"],
      [tx([{ account: PAYER, amount: -1000 }, { account: "0.0.7777", amount: 1000 }]), "ledger_merchant_amount_mismatch"],
      [tx([{ account: "0.0.5555", amount: -1000 }, { account: MERCHANT, amount: 1000 }]), "ledger_payer_debit_mismatch"],
      [tx([{ account: PAYER, amount: -1500 }, { account: MERCHANT, amount: 1000 }, { account: "0.0.7777", amount: 500 }]), "ledger_payer_debit_mismatch"],
      [tx([{ account: PAYER, amount: -1000 }, { account: MERCHANT, amount: 1000 }], "INSUFFICIENT_PAYER_BALANCE"), "ledger_result_INSUFFICIENT_PAYER_BALANCE"],
    ] as const) {
      t.net.mirror = mirror;
      const res = await t.submitPaidReview(jobId);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ detail: { reasons: [reason] } });
    }
    expect(t.db.prepare("SELECT count(*) AS n FROM payment_receipts").get()!.n).toBe(0);
    expect(getJob(t.db, jobId)!.state).toBe("review_pending");
  });

  it("refuses a payment from any account but the configured agent, or one made before the job existed", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const other = (await (await t.submitPaidReview(jobId, t.paidResult(jobId, { payerAccountId: "0.0.5555" }))).json()) as { detail: { reasons: string[] } };
    expect(other.detail.reasons).toContain("payer is not the configured agent account");
    t.net.mirror = (id) =>
      Response.json({
        transactions: [
          {
            transaction_id: id, consensus_timestamp: "1762480001.000000000", result: "SUCCESS", name: "CRYPTOTRANSFER", nonce: 0,
            transfers: [{ account: PAYER, amount: -1000 }, { account: MERCHANT, amount: 1000 }],
          },
        ],
      });
    const old = await t.submitPaidReview(jobId);
    expect(old.status).toBe(422);
    expect(await old.json()).toMatchObject({ detail: { reasons: ["ledger_transfer_before_job"] } });
    expect(t.db.prepare("SELECT count(*) AS n FROM payment_receipts").get()!.n).toBe(0);
    expect(getJob(t.db, jobId)!.state).toBe("review_pending");
  });

  it("keeps an unconfirmed transaction pending (not failed, not accepted) and confirms on retry", async () => {
    const t = setup();
    const jobId = await t.createJob();
    const original = t.net.mirror;
    t.net.mirror = () => new Response("", { status: 404 });
    const pending = await t.submitPaidReview(jobId);
    expect(pending.status).toBe(202);
    expect(await pending.json()).toMatchObject({ status: "ledger_pending", jobState: "review_pending" });
    // The pending claim blocks a different transaction for the same job.
    const other = await t.submitPaidReview(jobId, t.paidResult(jobId, { hederaTransactionId: "0.0.1001@1762480000.000000099" }));
    expect(await other.json()).toEqual({ error: "paid_review_already_recorded" });
    t.net.mirror = original;
    expect(await (await t.submitPaidReview(jobId)).json()).toEqual({ status: "accepted", jobState: "paid_review_confirmed" });
  });

  it("never lets one transaction back two jobs", async () => {
    const t = setup();
    const a = await t.createJob();
    expect((await t.submitPaidReview(a)).status).toBe(200);
    const b = await t.createJob(SHA3, 8);
    const res = await t.submitPaidReview(b);
    expect(await res.json()).toEqual({ error: "transaction_already_used" });
  });

  it("refuses when the PR head moved since the job was bound", async () => {
    const t = setup();
    const jobId = await t.createJob();
    t.gh.head = SHA3;
    const res = await t.submitPaidReview(jobId);
    expect(res.status).toBe(409);
    expect(getJob(t.db, jobId)!.state).toBe("stale");
  });

  it("accepts simulated evidence only when explicitly enabled, without a ledger lookup", async () => {
    const t = setup(testConfig({ paidReview: { ...testConfig().paidReview!, acceptedEvidence: ["live", "simulated"] } }));
    const jobId = await t.createJob();
    const res = await t.submitPaidReview(jobId, t.paidResult(jobId, { evidenceKind: "simulated" }));
    expect(await res.json()).toEqual({ status: "accepted", jobState: "paid_review_confirmed" });
    expect(t.net.calls.filter((c) => c.url.includes("mirror"))).toHaveLength(0);
    const detail = (await (await t.call("GET", `/api/reviews/${jobId}`)).json()) as { paidReview: Record<string, unknown> };
    expect(detail.paidReview).toMatchObject({ evidenceKind: "simulated", hashscanUrl: null, ledgerVerifiedAt: null });
  });
});
