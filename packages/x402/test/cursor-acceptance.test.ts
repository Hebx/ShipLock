/**
 * Cross-agent compatibility: the buyer's PaidReviewResult must pass Cursor's own acceptance
 * policy (packages/policy verifyPaidReviewResult) and mirror check (apps/api checkHederaTransfer),
 * using ShipLock's independent local scan digest. Imports Cursor's code unmodified.
 */
import { describe, expect, it } from "vitest";
import { verifyPaidReviewResult } from "../../policy/src/paid-review.ts";
import { checkHederaTransfer } from "../../../apps/api/src/mirror-node.ts";
import { scanDiff } from "@shiplock/scanner";
import { createAuditMerchant, createReviewPurchaser, auditUrl } from "../src/index.ts";
import { createStrictFacilitator, DIFF_SHA, fakeGithub, FEE_PAYER, FIXTURE_DIFF, JOB, Ledger, NETWORK, PAY_TO, PAYER, payerKey, scannerAuditor } from "./harness.ts";

const BASE = "http://merchant.test";

async function purchase() {
  const ledger = new Ledger();
  const merchant = await createAuditMerchant({
    network: NETWORK, payTo: PAY_TO, priceTinybar: 1000n, facilitator: createStrictFacilitator(ledger),
    mirror: ledger, auditor: scannerAuditor, publicBaseUrl: BASE, mirrorTimeoutMs: 0, github: fakeGithub,
  });
  const fetchImpl = ((i: string | URL | Request, init?: RequestInit) => merchant.app.fetch(new Request(i, init))) as typeof fetch;
  const buyer = createReviewPurchaser({
    network: NETWORK, payerAccountId: PAYER, payerPrivateKey: payerKey.toStringRaw(), allowedPayTo: [PAY_TO],
    expectedFeePayer: FEE_PAYER, globalMaxTinybar: 10_000n, mirror: ledger, mirrorTimeoutMs: 0, fetchImpl,
  });
  const r = await buyer.purchaseReview({ job: JOB, expectedDiffSha256: DIFF_SHA, reviewUrl: auditUrl(BASE, JOB, DIFF_SHA), maxTinybar: "10000" });
  return { r, ledger };
}

const expectations = (independentReportSha256: string) => ({
  network: "hedera:testnet" as const,
  asset: "0.0.0",
  merchantAccountId: PAY_TO,
  quotedTinybar: "1000",
  maxTinybar: "10000",
  allowedEvidenceKinds: ["live"] as const,
  independentReportSha256,
  diffSha256: DIFF_SHA,
});

describe("Hermes buyer output vs Cursor acceptance (unmodified Cursor code)", () => {
  it("verifyPaidReviewResult accepts it with ShipLock's independent digest", async () => {
    const { r } = await purchase();
    const { evidence, ...result } = r;
    void evidence;
    const local = scanDiff(JOB, FIXTURE_DIFF);
    const verdict = verifyPaidReviewResult(JOB, result, expectations(local.reportSha256));
    expect(verdict).toEqual({ ok: true, result });
  });

  it("checkHederaTransfer confirms the same tx against mirror-shaped JSON", async () => {
    const { r, ledger } = await purchase();
    const rec = await ledger.getTransaction(r.hederaTransactionId);
    if (rec.state !== "success") throw new Error("ledger");
    const mirrorId = r.hederaTransactionId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
    const fakeMirror = (async () =>
      new Response(JSON.stringify({ transactions: [{ transaction_id: mirrorId, consensus_timestamp: rec.consensusTimestamp, result: "SUCCESS", name: "CRYPTOTRANSFER", nonce: 0, scheduled: false, transfers: rec.transfers }] }), { status: 200 })) as unknown as typeof fetch;
    const check = await checkHederaTransfer(fakeMirror, "http://mirror", { transactionId: r.hederaTransactionId, payer: r.payerAccountId, merchant: r.merchantAccountId, amountTinybar: r.amountBaseUnits });
    expect(check.kind).toBe("confirmed");
  });

  it("Cursor rejects it for a different job head (stale review cannot be reused)", async () => {
    const { r } = await purchase();
    const { evidence, ...result } = r;
    void evidence;
    const moved = { ...JOB, headSha: "f".repeat(40) };
    const verdict = verifyPaidReviewResult(moved, result, expectations(scanDiff(JOB, FIXTURE_DIFF).reportSha256));
    expect(verdict.ok).toBe(false);
  });
});
