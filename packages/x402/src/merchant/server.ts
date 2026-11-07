/**
 * Paid /audit merchant. Standard x402 v2 over HTTP:
 *
 *   GET /audit?jobId&repoId&repo&pr&base&sha&diff&scanner -> 402 + PAYMENT-REQUIRED (fresh immutable quote)
 *   (contract v2: docs/INTEGRATION_CONTRACT.md; quote carries extra.shiplock = ReviewQuoteBinding)
 *   GET /audit?... + PAYMENT-SIGNATURE         -> verify -> settle -> mirror confirm -> 200 + PAYMENT-RESPONSE
 *
 * Invariants (docs/SECURITY.md):
 *  - The paid retry is checked against the STORED quote, never re-derived (no repricing).
 *  - One Hedera transaction id per quote, one fulfillment per quote (UNIQUE constraints).
 *  - Uncertain settlement is reconciled via the mirror node, never re-submitted blindly.
 */
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { extractTransactionFromPayload, inspectHederaTransaction, HBAR_ASSET_ID } from "@x402/hedera";
import { ReviewQuoteBindingSchema, sha256Hex as sha256Bytes, type ReviewJob, type ReviewQuoteBinding } from "@shiplock/shared";
import type { GitHubReader } from "@shiplock/github";
import { canonicalEqual, canonicalJson, sha256Hex, ENTITY_RE } from "../canonical.ts";
import { resolveHederaCapability, type HederaCapability, type HederaNetwork } from "../capabilities.ts";
import { assertHbarTransfer, validStartSeconds, waitForMirror, type MirrorClient } from "../mirror.ts";
import { reportDigest, type Auditor, type PaidAuditBody } from "../audit.ts";
import { MerchantStore, type QuoteRow } from "./store.ts";

/** Hedera rejects a transaction once validStart + validDuration (<=180s) passes. */
const HEDERA_MAX_VALID_SECONDS = 180;

export interface MerchantConfig {
  network: HederaNetwork;
  payTo: string;
  priceTinybar: bigint;
  facilitator: FacilitatorClient | string;
  mirror: MirrorClient;
  auditor: Auditor;
  store?: MerchantStore;
  publicBaseUrl: string;
  quoteTtlSeconds?: number;
  mirrorTimeoutMs?: number;
  repoAllowlist?: string[];
  vendorId?: string;
  /**
   * When set, the merchant verifies the job against GitHub BEFORE quoting: PR head/base and repo id
   * must match, and sha256(compare diff) must equal `diff`. Mismatches are refused before the 402.
   */
  github?: Pick<GitHubReader, "getPullRequest" | "getCompareDiff">;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface Merchant {
  app: Hono;
  store: MerchantStore;
  capability: HederaCapability;
}

export async function createAuditMerchant(cfg: MerchantConfig): Promise<Merchant> {
  if (!ENTITY_RE.test(cfg.payTo)) throw new Error("payTo must be a 0.0.x account id");
  if (cfg.priceTinybar <= 0n) throw new Error("price must be > 0 tinybar");
  const now = cfg.now ?? (() => Date.now());
  const log = cfg.log ?? (() => {});
  const ttl = cfg.quoteTtlSeconds ?? 120;
  const store = cfg.store ?? new MerchantStore();
  const facilitator = typeof cfg.facilitator === "string" ? new HTTPFacilitatorClient({ url: cfg.facilitator, timeoutMs: 120_000 }) : cfg.facilitator;

  // Fail closed at boot if the facilitator can't serve this network.
  const capability = await resolveHederaCapability(facilitator, cfg.network);
  const resourceServer = new x402ResourceServer(facilitator).register(cfg.network, new ExactHederaScheme());
  await resourceServer.initialize();

  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, network: cfg.network, payTo: cfg.payTo, feePayer: capability.feePayer }));

  app.get("/audit", async (c) => {
    const params = parseParams(c);
    if ("error" in params) return c.json({ error: params.error }, 400);
    if (cfg.repoAllowlist && !cfg.repoAllowlist.some((r) => r.toLowerCase() === params.repository.toLowerCase())) {
      return c.json({ error: "repository_not_allowlisted" }, 403);
    }

    const sigHeader = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
    if (!sigHeader) return issueQuote(c, params);

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(sigHeader);
    } catch {
      return issueQuote(c, params, "invalid_payment_header");
    }
    if (payload.x402Version !== 2 || !payload.accepted) return issueQuote(c, params, "unsupported_x402_version");

    const quoteId = payload.accepted.extra?.quoteId;
    const quote = typeof quoteId === "string" ? store.getQuote(quoteId) : undefined;
    if (!quote) return issueQuote(c, params, "unknown_quote");

    // Idempotent replay: same signed transaction for an already-fulfilled quote returns the stored body.
    const txId = safeTxId(payload);
    const fulfilled = store.getFulfillment(quote.quoteId);
    if (fulfilled) {
      if (txId && fulfilled.txId === txId) return respondPaid(c, JSON.parse(fulfilled.bodyJson) as PaidAuditBody, fulfilled.txId);
      return c.json({ error: "quote_already_fulfilled" }, 409);
    }

    if (!sameJob(quote, params)) {
      return c.json({ error: "quote_resource_mismatch" }, 400);
    }

    const stored = JSON.parse(quote.requirementsJson) as PaymentRequirements;
    if (!canonicalEqual(stored, payload.accepted)) return issueQuote(c, params, "quote_modified");
    if (!txId) return issueQuote(c, params, "invalid_exact_hedera_payload_transaction_could_not_be_decoded");

    const existing = store.getPaymentByQuote(quote.quoteId);
    if (existing && existing.txId !== txId) return c.json({ error: "quote_already_used" }, 409);
    if (now() > quote.expiresAt && !existing) return issueQuote(c, params, "quote_expired");

    // Local defense-in-depth before touching the facilitator.
    const local = precheckTransaction(payload, stored, capability.feePayer);
    if (local) return issueQuote(c, params, local);

    const payloadSha256 = sha256Hex(canonicalJson(payload.payload));
    const claim = store.claimPayment({ txId, quoteId: quote.quoteId, payloadSha256, payer: null }, now());
    if (claim.kind === "exists") {
      const row = claim.row;
      if (row.payloadSha256 !== payloadSha256) return c.json({ error: "payment_payload_conflict" }, 409);
      if (row.state === "settling") return pending(c, txId, "settlement_in_progress");
      if (row.state === "settled") return fulfil(c, quote, stored, txId, null);
      if (row.state === "uncertain") return reconcile(c, quote, stored, txId);
      return issueQuote(c, params, "payment_failed");
    }

    // verify
    let verify;
    try {
      verify = await resourceServer.verifyPayment(payload, stored);
    } catch (err) {
      // No submission happened yet; verification transport errors are safe to release.
      store.setPaymentState(txId, "failed", `verify_error:${errMsg(err)}`, now());
      store.deletePayment(txId);
      log("verify_error", { quoteId: quote.quoteId, txId, error: errMsg(err) });
      return c.json({ error: "facilitator_verify_unavailable" }, 503);
    }
    if (!verify.isValid) {
      store.setPaymentState(txId, "failed", `verify:${verify.invalidReason}`, now());
      store.deletePayment(txId);
      log("verify_rejected", { quoteId: quote.quoteId, txId, reason: verify.invalidReason });
      return issueQuote(c, params, verify.invalidReason ?? "payment_invalid");
    }

    // settle. Any non-success after this point may have reached consensus.
    let settle: SettleResponse | undefined;
    try {
      settle = await resourceServer.settlePayment(payload, stored);
    } catch (err) {
      store.setPaymentState(txId, "uncertain", `settle_error:${errMsg(err)}`, now());
      log("settle_uncertain", { quoteId: quote.quoteId, txId, error: errMsg(err) });
      return reconcile(c, quote, stored, txId);
    }
    if (!settle.success) {
      store.setPaymentState(txId, "uncertain", `settle:${settle.errorReason}:${settle.errorMessage ?? ""}`, now());
      log("settle_failed_reported", { quoteId: quote.quoteId, txId, reason: settle.errorReason });
      return reconcile(c, quote, stored, txId);
    }
    if (settle.transaction !== txId || settle.network !== stored.network) {
      store.setPaymentState(txId, "uncertain", `settle_mismatch:${settle.transaction}`, now());
      return reconcile(c, quote, stored, txId);
    }
    return confirmThenFulfil(c, quote, stored, txId, settle);
  });

  async function confirmThenFulfil(c: Context, quote: QuoteRow, stored: PaymentRequirements, txId: string, settle: SettleResponse | null) {
    const status = await waitForMirror(cfg.mirror, txId, { timeoutMs: cfg.mirrorTimeoutMs ?? 30_000 });
    if (status.state === "success") {
      try {
        assertHbarTransfer(status, { payTo: stored.payTo, amount: BigInt(stored.amount) });
      } catch (err) {
        store.setPaymentState(txId, "failed", `mirror_transfer_mismatch:${errMsg(err)}`, now());
        log("mirror_mismatch", { txId, error: errMsg(err) });
        return c.json({ error: "settlement_transfer_mismatch", transactionId: txId }, 502);
      }
      store.setPaymentState(txId, "settled", status.consensusTimestamp, now());
      return fulfil(c, quote, stored, txId, settle);
    }
    if (status.state === "failed") {
      store.setPaymentState(txId, "failed", `mirror:${status.result}`, now());
      store.deletePayment(txId);
      return c.json({ error: "settlement_failed", result: status.result }, 402);
    }
    store.setPaymentState(txId, "uncertain", "mirror_not_found", now());
    return pending(c, txId, "settlement_unconfirmed");
  }

  async function reconcile(c: Context, quote: QuoteRow, stored: PaymentRequirements, txId: string) {
    const status = await waitForMirror(cfg.mirror, txId, { timeoutMs: cfg.mirrorTimeoutMs ?? 30_000 });
    if (status.state !== "not_found") return confirmThenFulfil(c, quote, stored, txId, null);
    // Only declare failure once the transaction can no longer reach consensus.
    const expired = now() / 1000 > validStartSeconds(txId) + HEDERA_MAX_VALID_SECONDS;
    if (expired) {
      store.setPaymentState(txId, "failed", "never_reached_consensus", now());
      store.deletePayment(txId);
      return c.json({ error: "settlement_never_reached_consensus", transactionId: txId }, 402);
    }
    return pending(c, txId, "settlement_unconfirmed");
  }

  async function fulfil(c: Context, quote: QuoteRow, stored: PaymentRequirements, txId: string, settle: SettleResponse | null) {
    const prior = store.getFulfillment(quote.quoteId);
    if (prior) return respondPaid(c, JSON.parse(prior.bodyJson) as PaidAuditBody, prior.txId);
    const job = jobOf(quote);
    let report;
    try {
      report = await cfg.auditor(job);
    } catch (err) {
      // Paid; audit generation failed. Payment stays settled; the same payload can retry fulfilment.
      log("audit_error", { quoteId: quote.quoteId, txId, error: errMsg(err) });
      return c.json({ error: "audit_generation_failed_paid", transactionId: txId, retry: "resend the same PAYMENT-SIGNATURE" }, 503);
    }
    // The auditor may not describe a different revision than the one that was paid for.
    if (
      report.repositoryId !== job.repositoryId ||
      report.repository.toLowerCase() !== job.repository.toLowerCase() ||
      report.pullNumber !== job.pullNumber ||
      report.headSha !== job.headSha ||
      report.baseSha !== job.baseSha ||
      report.scannerVersion !== job.scannerVersion ||
      report.diffSha256 !== quote.diffSha256
    ) {
      log("audit_binding_mismatch", { quoteId: quote.quoteId, txId });
      return c.json({ error: "audit_binding_mismatch_paid", transactionId: txId }, 503);
    }
    const body: PaidAuditBody = {
      jobId: quote.jobId,
      vendorId: cfg.vendorId ?? "shiplock-x402-audit",
      report,
      reportSha256: reportDigest(report),
      payment: { network: stored.network, transactionId: txId, asset: stored.asset, amount: stored.amount, payTo: stored.payTo, quoteId: quote.quoteId },
    };
    try {
      store.insertFulfillment({ quoteId: quote.quoteId, txId, bodyJson: JSON.stringify(body), reportSha256: body.reportSha256 });
    } catch {
      const raced = store.getFulfillment(quote.quoteId);
      if (raced && raced.txId === txId) return respondPaid(c, JSON.parse(raced.bodyJson) as PaidAuditBody, txId);
      return c.json({ error: "quote_already_fulfilled" }, 409);
    }
    log("fulfilled", { quoteId: quote.quoteId, txId, reportSha256: body.reportSha256 });
    return respondPaid(c, body, txId);
  }

  function respondPaid(c: Context, body: PaidAuditBody, txId: string) {
    const settleHeader: SettleResponse = {
      success: true,
      transaction: txId,
      network: body.payment.network as SettleResponse["network"],
      amount: body.payment.amount,
    };
    c.header("PAYMENT-RESPONSE", encodePaymentResponseHeader(settleHeader));
    c.header("Access-Control-Expose-Headers", "PAYMENT-RESPONSE");
    c.header("Cache-Control", "private, no-store");
    return c.json(body, 200);
  }

  function pending(c: Context, txId: string, reason: string) {
    c.header("Retry-After", "3");
    return c.json({ error: reason, transactionId: txId, retry: "resend the same PAYMENT-SIGNATURE; do not create a new payment" }, 503);
  }

  async function issueQuote(c: Context, params: Params, error?: string) {
    if (cfg.github) {
      const problem = await verifyAgainstGithub(cfg.github, params);
      if (problem) {
        log("quote_refused", { jobId: params.jobId, problem });
        return c.json({ error: "job_does_not_match_github", detail: problem }, 409);
      }
    }
    const quoteId = randomUUID();
    const createdAt = now();
    const [requirements] = await resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network: cfg.network,
      payTo: cfg.payTo,
      price: { asset: HBAR_ASSET_ID, amount: cfg.priceTinybar.toString() },
      maxTimeoutSeconds: ttl,
      extra: { quoteId, shiplock: bindingOf(params) },
    });
    if (!requirements) throw new Error("no payment requirements built");
    if (requirements.extra.feePayer !== capability.feePayer) throw new Error("fee payer drifted from /supported capability");
    const resourceUrl = `${cfg.publicBaseUrl.replace(/\/+$/, "")}/audit?${new URL(c.req.url).searchParams.toString()}`;
    store.insertQuote({
      quoteId,
      jobId: params.jobId,
      repositoryId: params.repositoryId,
      repository: params.repository,
      pullNumber: params.pullNumber,
      headSha: params.headSha,
      baseSha: params.baseSha,
      scannerVersion: params.scannerVersion,
      diffSha256: params.diffSha256,
      requirementsJson: JSON.stringify(requirements),
      resourceUrl,
      createdAt,
      expiresAt: createdAt + ttl * 1000,
    });
    const paymentRequired = await resourceServer.createPaymentRequiredResponse(
      [requirements],
      { url: resourceUrl, description: `ShipLock code review of ${params.repository}#${params.pullNumber} ${params.baseSha}...${params.headSha}`, mimeType: "application/json", serviceName: "shiplock-audit" },
      error,
    );
    c.header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequired));
    c.header("Cache-Control", "no-store");
    log("quote_issued", { quoteId, error: error ?? null });
    return c.json(paymentRequired, 402);
  }

  return { app, store, capability };
}

type Params = ReviewQuoteBinding;

/** Query -> ReviewQuoteBinding, validated with the shared strict schema. */
export function parseParams(c: Context): Params | { error: string } {
  const q = (k: string) => c.req.query(k);
  const int = (v: string | undefined) => (v !== undefined && /^[1-9][0-9]{0,15}$/.test(v) ? Number(v) : NaN);
  const parsed = ReviewQuoteBindingSchema.safeParse({
    jobId: q("jobId"),
    repositoryId: int(q("repoId")),
    repository: q("repo"),
    pullNumber: int(q("pr")),
    baseSha: q("base"),
    headSha: q("sha"),
    scannerVersion: q("scanner"),
    diffSha256: q("diff"),
  });
  if (!parsed.success) return { error: `invalid_job:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}` };
  return parsed.data;
}

/** Canonical review URL for a job + ShipLock's diff digest (used by the buyer and by Cursor's API). */
export function auditUrl(baseUrl: string, job: ReviewJob, diffSha256: string): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}/audit`);
  u.searchParams.set("jobId", job.jobId);
  u.searchParams.set("repoId", String(job.repositoryId));
  u.searchParams.set("repo", job.repository);
  u.searchParams.set("pr", String(job.pullNumber));
  u.searchParams.set("base", job.baseSha);
  u.searchParams.set("sha", job.headSha);
  u.searchParams.set("diff", diffSha256);
  u.searchParams.set("scanner", job.scannerVersion);
  return u.toString();
}

function bindingOf(p: ReviewQuoteBinding): ReviewQuoteBinding {
  return {
    jobId: p.jobId,
    repositoryId: p.repositoryId,
    repository: p.repository,
    pullNumber: p.pullNumber,
    headSha: p.headSha,
    baseSha: p.baseSha,
    scannerVersion: p.scannerVersion,
    diffSha256: p.diffSha256,
  };
}

async function verifyAgainstGithub(gh: NonNullable<MerchantConfig["github"]>, p: ReviewQuoteBinding): Promise<string | null> {
  let pr;
  try {
    pr = await gh.getPullRequest(p.repository, p.pullNumber);
  } catch (err) {
    return `github_pr_unavailable:${errMsg(err)}`;
  }
  if (pr.headSha !== p.headSha) return "head_sha_not_current";
  if (pr.baseSha !== p.baseSha) return "base_sha_mismatch";
  if (pr.repositoryId !== p.repositoryId) return "repository_id_mismatch";
  if (pr.state !== "open") return "pull_request_not_open";
  const diff = await gh.getCompareDiff(p.repository, p.baseSha, p.headSha);
  if (sha256Bytes(diff) !== p.diffSha256) return "diff_sha256_mismatch";
  return null;
}

function jobOf(q: QuoteRow): ReviewJob {
  return { jobId: q.jobId, repositoryId: q.repositoryId, repository: q.repository, pullNumber: q.pullNumber, headSha: q.headSha, baseSha: q.baseSha, scannerVersion: q.scannerVersion };
}

function sameJob(q: QuoteRow, p: Params): boolean {
  return (
    q.jobId === p.jobId &&
    q.repositoryId === p.repositoryId &&
    q.repository === p.repository &&
    q.pullNumber === p.pullNumber &&
    q.headSha === p.headSha &&
    q.baseSha === p.baseSha &&
    q.scannerVersion === p.scannerVersion &&
    q.diffSha256 === p.diffSha256
  );
}

function safeTxId(payload: PaymentPayload): string | null {
  try {
    return inspectHederaTransaction(extractTransactionFromPayload(payload.payload as { transaction: string })).transactionId;
  } catch {
    return null;
  }
}

/** Mirrors the facilitator checks we can do without a network: shape, fee payer, exact HBAR movement. */
export function precheckTransaction(payload: PaymentPayload, req: PaymentRequirements, feePayer: string): string | null {
  let inspected;
  try {
    inspected = inspectHederaTransaction(extractTransactionFromPayload(payload.payload as { transaction: string }));
  } catch {
    return "invalid_exact_hedera_payload_transaction_could_not_be_decoded";
  }
  if (inspected.hasNonTransferOperations) return "invalid_exact_hedera_payload_non_transfer_operation";
  if (inspected.transactionIdAccountId !== feePayer) return "invalid_exact_hedera_payload_fee_payer_mismatch";
  if (req.asset !== HBAR_ASSET_ID) return "unsupported_asset";
  if (Object.keys(inspected.tokenTransfers).length > 0) return "invalid_exact_hedera_payload_unexpected_token_transfer";
  const net = new Map<string, bigint>();
  for (const t of inspected.hbarTransfers) net.set(t.accountId, (net.get(t.accountId) ?? 0n) + BigInt(t.amount));
  const amount = BigInt(req.amount);
  if ((net.get(req.payTo) ?? 0n) !== amount) return "invalid_exact_hedera_payload_amount_mismatch";
  for (const [acct, v] of net) {
    if (acct === req.payTo) continue;
    if (v > 0n) return "invalid_exact_hedera_payload_unexpected_recipient";
  }
  if ((net.get(feePayer) ?? 0n) < 0n) return "invalid_exact_hedera_payload_fee_payer_debited";
  return null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
