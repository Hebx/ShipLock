import { describe, expect, it, beforeEach } from "vitest";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import {
  createAuditMerchant,
  createReviewPurchaser,
  rejectReason,
  resolveHederaCapability,
  reportDigest,
  auditUrl,
  toMirrorTransactionId,
  AuditShaMismatchError,
  CapabilityError,
  PaidButNotFulfilledError,
  PaymentPolicyError,
  PaymentUncertainError,
  type Auditor,
} from "../src/index.ts";
import { createStrictFacilitator, FEE_PAYER, JOB, BASE_SHA, Ledger, NETWORK, noopAuditor, PAY_TO, PAYER, payerKey, SHA, type SettleMode } from "./harness.ts";
import type { ReviewJob } from "@shiplock/shared";

const BASE = "http://merchant.test";

async function setup(opts: { auditor?: Auditor; settleMode?: () => SettleMode; price?: bigint; now?: () => number } = {}) {
  const ledger = new Ledger();
  const facilitator = createStrictFacilitator(ledger, { settleMode: opts.settleMode });
  const merchant = await createAuditMerchant({
    network: NETWORK,
    payTo: PAY_TO,
    priceTinybar: opts.price ?? 1000n,
    facilitator,
    mirror: ledger,
    auditor: opts.auditor ?? noopAuditor,
    publicBaseUrl: BASE,
    mirrorTimeoutMs: 0,
    now: opts.now,
  });
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => merchant.app.fetch(new Request(input, init))) as typeof fetch;
  const buyer = (over: Partial<Parameters<typeof createReviewPurchaser>[0]> = {}) =>
    createReviewPurchaser({
      network: NETWORK,
      payerAccountId: PAYER,
      payerPrivateKey: payerKey.toStringRaw(),
      allowedPayTo: [PAY_TO],
      expectedFeePayer: FEE_PAYER,
      globalMaxTinybar: 10_000n,
      mirror: ledger,
      mirrorTimeoutMs: 0,
      fetchImpl,
      ...over,
    });
  const jobFor = (jobId = "job-1", headSha = SHA): ReviewJob => ({ ...JOB, jobId, headSha });
  const url = (jobId = "job-1", sha = SHA) => auditUrl(BASE, jobFor(jobId, sha));
  return { ledger, facilitator, merchant, fetchImpl, buyer, url, jobFor };
}

async function getQuote(fetchImpl: typeof fetch, url: string) {
  const res = await fetchImpl(url);
  const pr = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
  return { res, pr, req: pr.accepts[0]! };
}

async function signedHeader(pr: ReturnType<typeof decodePaymentRequiredHeader>, req: PaymentRequirements, key: PrivateKey = payerKey, accepted: PaymentRequirements = req) {
  const signer = createClientHederaSigner(PAYER, key, { network: NETWORK });
  const transaction = await signer.createPartiallySignedTransferTransaction(req);
  return encodePaymentSignatureHeader({ x402Version: 2, accepted, resource: pr.resource, payload: { transaction } });
}

describe("402 challenge", () => {
  it("issues a standards-compliant v2 PAYMENT-REQUIRED with integer HBAR price and facilitator fee payer", async () => {
    const { fetchImpl, url } = await setup();
    const { res, pr, req } = await getQuote(fetchImpl, url());
    expect(res.status).toBe(402);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts).toHaveLength(1);
    expect(req).toMatchObject({ scheme: "exact", network: NETWORK, asset: "0.0.0", amount: "1000", payTo: PAY_TO });
    expect(req.extra).toMatchObject({ feePayer: FEE_PAYER, headSha: SHA, baseSha: BASE_SHA, repository: JOB.repository, repositoryId: JOB.repositoryId, pullNumber: JOB.pullNumber, scannerVersion: JOB.scannerVersion });
    expect(typeof req.extra.quoteId).toBe("string");
    expect(await res.json()).toEqual(pr);
  });

  it("rejects malformed resource params before quoting", async () => {
    const { fetchImpl } = await setup();
    const good = new URL(auditUrl(BASE, JOB));
    for (const [k, v] of [["head", "main"], ["base", "A".repeat(40)], ["repo", "bad"], ["repoId", "0"], ["pr", "x"], ["scanner", ""]] as const) {
      const u = new URL(good);
      u.searchParams.set(k, v);
      expect((await fetchImpl(u.toString())).status, k).toBe(400);
    }
  });
});

describe("happy path (strict official facilitator scheme)", () => {
  it("pays, settles once, confirms via mirror, returns a SHA-bound audit with matching digest", async () => {
    const { buyer, url, ledger, facilitator, merchant } = await setup();
    const r = await buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: url(), maxTinybar: "5000" });
    expect(r.settlementConfirmed).toBe(true);
    expect(r.headSha).toBe(SHA);
    expect(r.amountBaseUnits).toBe("1000");
    expect(r.merchantAccountId).toBe(PAY_TO);
    expect(r.hederaTransactionId).toMatch(/^0\.0\.7162784@\d+\.\d+$/);
    expect(r.reportSha256).toBe(reportDigest(r.evidence.body.report));
    expect(ledger.submitCount).toBe(1);
    expect(facilitator.calls.settle).toBe(1);
    const pay = merchant.store.getPaymentByTx(r.hederaTransactionId)!;
    expect(pay.state).toBe("settled");
    expect(merchant.store.getFulfillment(pay.quoteId)!.reportSha256).toBe(r.reportSha256);
  });
});

describe("buyer policy (nothing is signed)", () => {
  const ex = { feePayer: FEE_PAYER, headSha: SHA, baseSha: BASE_SHA, repositoryId: JOB.repositoryId, repository: JOB.repository, pullNumber: JOB.pullNumber, scannerVersion: JOB.scannerVersion };
  const base = { scheme: "exact", network: NETWORK, asset: "0.0.0", amount: "1000", payTo: PAY_TO, maxTimeoutSeconds: 120, extra: ex } as PaymentRequirements;
  const ctx = { network: NETWORK, allowedPayTo: [PAY_TO], feePayer: FEE_PAYER, cap: 5000n, job: JOB };
  it.each([
    ["wrong network", { network: "hedera:mainnet" }, /network/],
    ["wrong asset (USDC)", { asset: "0.0.429274" }, /asset/],
    ["wrong recipient", { payTo: "0.0.1234" }, /not allowlisted/],
    ["over cap", { amount: "5001" }, /exceeds cap/],
    ["float amount", { amount: "10.5" }, /non-integer/],
    ["negative amount", { amount: "-1" }, /non-integer/],
    ["zero amount", { amount: "0" }, /zero/],
    ["foreign fee payer", { extra: { ...ex, feePayer: "0.0.999" } }, /feePayer/],
    ["quote for another head commit", { extra: { ...ex, headSha: "a".repeat(40) } }, /bound to head/],
    ["quote for another base commit", { extra: { ...ex, baseSha: "b".repeat(40) } }, /bound to base/],
    ["quote for another repository id", { extra: { ...ex, repositoryId: 1 } }, /repository id/],
    ["quote for another PR", { extra: { ...ex, pullNumber: 8 } }, /PR/],
    ["quote for another scanner version", { extra: { ...ex, scannerVersion: "other/9" } }, /scanner/],
    ["upto scheme", { scheme: "upto" }, /scheme/],
  ])("%s", (_n, patch, re) => {
    expect(rejectReason({ ...base, ...patch } as PaymentRequirements, ctx)).toMatch(re);
  });
  it("accepts the exact quote", () => expect(rejectReason(base, ctx)).toBeNull());

  it("end-to-end: over-cap and SHA-mismatch purchases throw PaymentPolicyError and never hit settle", async () => {
    const { buyer, url, facilitator, ledger } = await setup({ price: 20_000n });
    await expect(buyer().purchaseReview({ job: { ...JOB, jobId: "j", headSha: SHA }, reviewUrl: url("j"), maxTinybar: "50000" })).rejects.toBeInstanceOf(PaymentPolicyError);
    const s2 = await setup();
    await expect(s2.buyer().purchaseReview({ job: { ...JOB, jobId: "j", headSha: "b".repeat(40) }, reviewUrl: s2.url("j"), maxTinybar: "5000" })).rejects.toBeInstanceOf(PaymentPolicyError);
    expect(facilitator.calls.verify + s2.facilitator.calls.verify).toBe(0);
    expect(ledger.submitCount + s2.ledger.submitCount).toBe(0);
  });
});

describe("merchant rejects bad payments (real SDK verification)", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("invalid signature -> facilitator /verify rejects, no settlement", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, req, PrivateKey.generateECDSA()) } });
    expect(res.status).toBe(402);
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("invalid_exact_hedera_payload_signature_invalid");
    expect(s.facilitator.calls.verify).toBe(1);
    expect(s.ledger.submitCount).toBe(0);
  });

  it("wrong amount inside the signed tx (accepted unchanged) -> rejected before facilitator", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, { ...req, amount: "1" }, payerKey, req) } });
    expect(res.status).toBe(402);
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("invalid_exact_hedera_payload_amount_mismatch");
    expect(s.facilitator.calls.verify).toBe(0);
  });

  it("wrong recipient inside the signed tx -> rejected", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, { ...req, payTo: "0.0.1234" }, payerKey, req) } });
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toMatch(/amount_mismatch|unexpected_recipient/);
    expect(s.ledger.submitCount).toBe(0);
  });

  it("strict facilitator independently rejects wrong amount (defense in depth is not the only check)", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const signer = createClientHederaSigner(PAYER, payerKey, { network: NETWORK });
    const transaction = await signer.createPartiallySignedTransferTransaction({ ...req, amount: "1" });
    const v = await s.facilitator.verify({ x402Version: 2, accepted: req, resource: pr.resource, payload: { transaction } }, req);
    expect(v.isValid).toBe(false);
  });

  it("modified quote (client reprices accepted) -> quote_modified", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const cheap = { ...req, amount: "1" };
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, cheap) } });
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("quote_modified");
    expect(s.facilitator.calls.verify).toBe(0);
  });

  it("unsupported network in accepted -> rejected", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req, payerKey, { ...req, network: "hedera:mainnet" });
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    expect(res.status).toBe(402);
    expect(s.ledger.submitCount).toBe(0);
  });

  it("quote replayed against a different commit -> quote_resource_mismatch", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const res = await s.fetchImpl(s.url("job-1", "c".repeat(40)), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, req) } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "quote_resource_mismatch" });
  });

  it("unknown / forged quoteId -> fresh 402", async () => {
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const forged = { ...req, extra: { ...req.extra, quoteId: "nope" } };
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, forged) } });
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("unknown_quote");
  });

  it("stale quote (expired before payment) -> quote_expired", async () => {
    let t = 1_000_000;
    const s2 = await setup({ now: () => t });
    const { pr, req } = await getQuote(s2.fetchImpl, s2.url());
    t += 121_000;
    const res = await s2.fetchImpl(s2.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, req) } });
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("quote_expired");
    expect(s2.ledger.submitCount).toBe(0);
  });

  it("garbage payment header -> 402 invalid_payment_header", async () => {
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": "!!!" } });
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).error).toBe("invalid_payment_header");
  });
});

describe("replay / duplicate payment", () => {
  it("same signed payment twice -> identical body, ONE settlement", async () => {
    const s = await setup();
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req);
    const a = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    const b = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual(await a.json());
    expect(s.ledger.submitCount).toBe(1);
    expect(s.facilitator.calls.settle).toBe(1);
  });

  it("second, different payment for an already-fulfilled quote -> 409, not settled", async () => {
    const s = await setup();
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    expect((await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, req) } })).status).toBe(200);
    const second = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": await signedHeader(pr, req) } });
    expect(second.status).toBe(409);
    expect(s.ledger.submitCount).toBe(1);
  });

  it("concurrent duplicate submissions settle at most once", async () => {
    const s = await setup();
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req);
    const results = await Promise.all([1, 2, 3].map(() => s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } })));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(s.ledger.submitCount).toBe(1);
  });
});

describe("uncertain settlement", () => {
  it("facilitator throws AFTER submit -> merchant reconciles via mirror and fulfils, no re-settle", async () => {
    const s = await setup({ settleMode: () => "throw_after_submit" });
    const r = await s.buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" });
    expect(r.settlementConfirmed).toBe(true);
    expect(s.ledger.submitCount).toBe(1);
  });

  it("facilitator reports failure but tx actually landed -> reconciled as paid", async () => {
    const s = await setup({ settleMode: () => "report_failure_after_submit" });
    const r = await s.buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" });
    expect(r.settlementConfirmed).toBe(true);
    expect(s.ledger.submitCount).toBe(1);
  });

  it("facilitator throws BEFORE submit and tx still valid -> 503 pending + PaymentUncertainError; state kept 'uncertain'", async () => {
    const s = await setup({ settleMode: () => "throw_before_submit" });
    const err = await s.buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentUncertainError);
    const pay = s.merchant.store.getPaymentByTx((err as PaymentUncertainError).transactionId!)!;
    expect(pay.state).toBe("uncertain");
    expect(s.ledger.submitCount).toBe(0);
  });

  it("retrying the same payload while uncertain never calls /settle again", async () => {
    const s = await setup({ settleMode: () => "throw_before_submit" });
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req);
    expect((await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } })).status).toBe(503);
    expect((await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } })).status).toBe(503);
    expect(s.facilitator.calls.settle).toBe(1);
  });

  it("uncertain tx past Hedera validity window -> released as never_reached_consensus", async () => {
    let t = Date.now();
    const s = await setup({ settleMode: () => "throw_before_submit", now: () => t });
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req);
    expect((await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } })).status).toBe(503);
    t += 200_000;
    const res = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "settlement_never_reached_consensus" });
  });
});

describe("audit integrity", () => {
  it("paid result passes the shared PaidReviewResultSchema and the report equals ShipLock's own scan", async () => {
    const s = await setup();
    const r = await s.buyer().purchaseReview({ job: JOB, reviewUrl: s.url(), maxTinybar: "5000" });
    const { PaidReviewResultSchema, canonicalSha256 } = await import("@shiplock/shared");
    const { scanDiff } = await import("@shiplock/scanner");
    const { FIXTURE_DIFF } = await import("./harness.ts");
    const { evidence, ...plain } = r;
    expect(PaidReviewResultSchema.parse(plain)).toEqual(plain);
    expect(r.evidenceKind).toBe("live");
    expect(r.payerAccountId).toBe(PAYER);
    const local = scanDiff(JOB, FIXTURE_DIFF);
    expect(r.reportSha256).toBe(local.reportSha256);
    expect(canonicalSha256(r.report)).toBe(local.reportSha256);
    expect(r.report.conclusion).toBe(local.report.conclusion);
    void evidence;
  });

  it("merchant refuses to serve an auditor report for a different revision (paid, 503, no re-pay)", async () => {
    const s = await setup({ auditor: async (j) => ({ ...(await noopAuditor(j)), headSha: "e".repeat(40) }) });
    const err = await s.buyer().purchaseReview({ job: JOB, reviewUrl: s.url(), maxTinybar: "5000" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaidButNotFulfilledError);
  });

  it("merchant cannot return an audit for a different commit (report pinned to quote SHA)", async () => {
    const s = await setup();
    const r = await s.buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" });
    expect(r.evidence.body.report.headSha).toBe(SHA);
  });

  it("buyer rejects a paid response whose report references another SHA", async () => {
    const s = await setup();
    const evil = ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(s.merchant.app.fetch(new Request(input, init))).then(async (res: Response) => {
        if (res.status !== 200) return res;
        const body = (await res.json()) as { report: { headSha: string }; reportSha256: string };
        body.report.headSha = "d".repeat(40);
        body.reportSha256 = reportDigest(body.report as never);
        return new Response(JSON.stringify(body), { status: 200, headers: res.headers });
      })) as typeof fetch;
    const err = await s.buyer({ fetchImpl: evil }).purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" }).catch((e) => e);
    expect(err).toBeInstanceOf(AuditShaMismatchError);
    expect(err.transactionId).toMatch(/^0\.0\.7162784@/);
  });

  it("auditor failure after settlement -> 503 paid; resending SAME payment fulfils without re-paying", async () => {
    let fail = true;
    const s = await setup({ auditor: async (j) => { if (fail) throw new Error("github down"); return noopAuditor(j); } });
    const { pr, req } = await getQuote(s.fetchImpl, s.url());
    const header = await signedHeader(pr, req);
    const a = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    expect(a.status).toBe(503);
    expect(await a.json()).toMatchObject({ error: "audit_generation_failed_paid" });
    fail = false;
    const b = await s.fetchImpl(s.url(), { headers: { "PAYMENT-SIGNATURE": header } });
    expect(b.status).toBe(200);
    expect(decodePaymentResponseHeader(b.headers.get("PAYMENT-RESPONSE")!).success).toBe(true);
    expect(s.ledger.submitCount).toBe(1);
  });

  it("buyer surfaces paid-but-unfulfilled distinctly (no blind re-pay)", async () => {
    const s = await setup({ auditor: async () => { throw new Error("down"); } });
    const err = await s.buyer().purchaseReview({ job: { ...JOB, jobId: "job-1", headSha: SHA }, reviewUrl: s.url(), maxTinybar: "5000" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaidButNotFulfilledError);
  });
});

describe("facilitator capability", () => {
  const sup = (kinds: unknown[], signers: Record<string, string[]> = { "hedera:*": [FEE_PAYER] }) => ({ getSupported: async () => ({ kinds, extensions: [], signers }) as never });
  it("accepts v2 exact hedera:testnet with listed fee payer", async () => {
    const c = await resolveHederaCapability(sup([{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { feePayer: FEE_PAYER } }]), NETWORK);
    expect(c.feePayer).toBe(FEE_PAYER);
  });
  it("rejects mainnet-only facilitator (the blocky402 apex-host pitfall)", async () => {
    await expect(resolveHederaCapability(sup([{ x402Version: 2, scheme: "exact", network: "hedera:mainnet", extra: { feePayer: "0.0.10571514" } }]), NETWORK)).rejects.toBeInstanceOf(CapabilityError);
  });
  it("rejects missing fee payer and unlisted fee payer", async () => {
    await expect(resolveHederaCapability(sup([{ x402Version: 2, scheme: "exact", network: NETWORK }]), NETWORK)).rejects.toBeInstanceOf(CapabilityError);
    await expect(resolveHederaCapability(sup([{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { feePayer: "0.0.5" } }]), NETWORK)).rejects.toBeInstanceOf(CapabilityError);
  });
});

describe("mirror ids", () => {
  it("converts SDK tx id to mirror format", () => {
    expect(toMirrorTransactionId("0.0.7162784@1794012935.145851264")).toBe("0.0.7162784-1794012935-145851264");
    expect(toMirrorTransactionId("0.0.1@1.5")).toBe("0.0.1-1-000000005");
  });
});
