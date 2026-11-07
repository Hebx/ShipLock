/**
 * Autonomous buyer implementing ReviewPurchaseGateway (packages/shared/src/contracts.ts).
 *
 * Uses the official @x402/fetch + @x402/hedera exact client for 402 negotiation and signing.
 * ShipLock policy runs in a PaymentPolicy *before* anything is signed:
 *   scheme exact, network, asset HBAR, payTo allowlist, feePayer == facilitator /supported,
 *   integer amount <= cap, and the quote bound to the exact ReviewJob (repo id, PR, base, head, scanner).
 * After the paid response: Mirror Node confirmation of the exact transfer, digest recomputation,
 * report binding to the job, then PaidReviewResultSchema validation.
 */
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, HBAR_ASSET_ID, inspectHederaTransaction, PrivateKey } from "@x402/hedera";
import {
  PaidReviewResultSchema,
  ReviewJobSchema,
  type PaidReviewResult,
  type PurchaseReviewInput,
  type ReviewJob,
  type ReviewPurchaseGateway,
} from "@shiplock/shared";
import { ENTITY_RE, UINT_RE } from "../canonical.ts";
import { reportDigest, type PaidAuditBody } from "../audit.ts";
import type { HederaNetwork } from "../capabilities.ts";
import { assertHbarTransfer, waitForMirror, type MirrorClient } from "../mirror.ts";
import {
  AuditIntegrityError,
  AuditShaMismatchError,
  PaidButNotFulfilledError,
  PaymentPolicyError,
  PaymentUncertainError,
} from "../errors.ts";

export const ADAPTER_ID = "hermes-x402-hedera/2.30.0";

export interface BuyerConfig {
  network: "hedera:testnet";
  payerAccountId: string;
  /** ECDSA (secp256k1) private key string. Never logged. */
  payerPrivateKey: string;
  /** Merchants this agent may pay. */
  allowedPayTo: string[];
  /** Fee payer advertised by the facilitator's /supported (resolve with resolveHederaCapability). */
  expectedFeePayer: string;
  /** Hard ceiling per payment, applied in addition to each call's maxTinybar. */
  globalMaxTinybar: bigint;
  mirror: MirrorClient;
  mirrorTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Called once a payment is signed, before it is sent. Persist this to make retries safe. */
  onSigned?: (info: { jobId: string; transactionId: string; requirements: PaymentRequirements }) => void | Promise<void>;
}

export interface BuyerEvidence {
  requirements: PaymentRequirements;
  transactionId: string;
  consensusTimestamp: string;
  body: PaidAuditBody;
}

export type PurchaseResult = PaidReviewResult & { evidence: BuyerEvidence };

export interface ReviewPurchaser extends ReviewPurchaseGateway {
  purchaseReview(input: PurchaseReviewInput): Promise<PurchaseResult>;
}

export function createReviewPurchaser(cfg: BuyerConfig): ReviewPurchaser {
  if (!ENTITY_RE.test(cfg.payerAccountId)) throw new Error("payerAccountId must be 0.0.x");
  if (!ENTITY_RE.test(cfg.expectedFeePayer)) throw new Error("expectedFeePayer must be 0.0.x");
  if (cfg.allowedPayTo.length === 0 || !cfg.allowedPayTo.every((a) => ENTITY_RE.test(a))) throw new Error("allowedPayTo must list 0.0.x accounts");
  if (cfg.allowedPayTo.includes(cfg.payerAccountId)) throw new Error("payer and merchant must differ");

  const key = PrivateKey.fromStringECDSA(cfg.payerPrivateKey);
  const signer = createClientHederaSigner(cfg.payerAccountId, key, { network: cfg.network });
  const baseFetch = cfg.fetchImpl ?? fetch;

  return {
    adapterId: ADAPTER_ID,
    async purchaseReview(input: PurchaseReviewInput): Promise<PurchaseResult> {
      const jobParse = ReviewJobSchema.safeParse(input.job);
      if (!jobParse.success) throw new PaymentPolicyError("invalid ReviewJob");
      const job = jobParse.data;
      if (!UINT_RE.test(input.maxTinybar)) throw new PaymentPolicyError("maxTinybar must be an integer string");
      const cap = minBig(BigInt(input.maxTinybar), cfg.globalMaxTinybar);
      if (cap <= 0n) throw new PaymentPolicyError("spend cap is zero");
      const policy: PolicyContext = { network: cfg.network, allowedPayTo: cfg.allowedPayTo, feePayer: cfg.expectedFeePayer, cap, job };

      let accepted: PaymentRequirements | undefined;
      let signedTxId: string | undefined;

      const client = new x402Client();
      client.register(cfg.network, new ExactHederaScheme(signer));
      // Our own integer cap supersedes the SDK's USD default (HBAR has no USD default asset).
      client.setSpendControls({ allowedAssets: [{ network: cfg.network, asset: HBAR_ASSET_ID, maxAmountPerPayment: cap.toString() }] });
      client.registerPolicy((_v, reqs) => reqs.filter((r) => rejectReason(r, policy) === null));
      client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
        // Second, explicit check on the single requirement actually being signed.
        const reason = rejectReason(selectedRequirements, policy);
        if (reason) return { abort: true, reason };
        if (accepted) return { abort: true, reason: "refusing a second payment within one purchase" };
        accepted = structuredClone(selectedRequirements);
      });
      client.onAfterPaymentCreation(async ({ paymentPayload }) => {
        signedTxId = txIdFromPayload(paymentPayload.payload);
        await cfg.onSigned?.({ jobId: job.jobId, transactionId: signedTxId, requirements: paymentPayload.accepted });
      });

      const paidFetch = wrapFetchWithPayment(baseFetch, client);
      let res: Response;
      try {
        res = await paidFetch(input.reviewUrl, { method: "GET", headers: { accept: "application/json" } });
      } catch (err) {
        if (!signedTxId) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/policies|spendControls|aborted|No network\/scheme/.test(msg)) throw new PaymentPolicyError(msg);
          throw err;
        }
        return settleUncertain(signedTxId, `transport error after signing: ${String(err)}`);
      }

      if (!signedTxId || !accepted) {
        if (res.status === 402) throw new PaymentPolicyError("merchant still requires payment and no compliant quote was signed");
        throw new PaymentPolicyError(`resource returned ${res.status} without a payment challenge`);
      }

      if (res.status !== 200) {
        const text = await res.text().catch(() => "");
        if (res.status >= 500) return settleUncertain(signedTxId, `merchant ${res.status}: ${text.slice(0, 200)}`);
        // 402/4xx after a signed payment: rejected before settlement, unless the ledger says otherwise.
        const mirror = await waitForMirror(cfg.mirror, signedTxId, { timeoutMs: 6_000 });
        if (mirror.state === "success") throw new PaidButNotFulfilledError(`paid but merchant returned ${res.status}`, signedTxId);
        throw new PaymentPolicyError(`payment rejected by merchant (${res.status}): ${extractError(text)}`);
      }

      const header = res.headers.get("PAYMENT-RESPONSE");
      const settle = header ? decodePaymentResponseHeader(header) : undefined;
      if (!settle?.success || settle.transaction !== signedTxId) {
        return settleUncertain(signedTxId, "missing or mismatched PAYMENT-RESPONSE");
      }

      const status = await waitForMirror(cfg.mirror, signedTxId, { timeoutMs: cfg.mirrorTimeoutMs ?? 30_000 });
      if (status.state !== "success") {
        if (status.state === "failed") throw new PaymentPolicyError(`mirror reports ${status.result} for ${signedTxId}`);
        return settleUncertain(signedTxId, "merchant claimed settlement; mirror has not confirmed");
      }
      assertHbarTransfer(status, { payer: cfg.payerAccountId, payTo: accepted.payTo, amount: BigInt(accepted.amount) });

      const body = (await res.json()) as PaidAuditBody;
      if (!body?.report || typeof body.reportSha256 !== "string") throw new AuditIntegrityError("paid response has no report", signedTxId);
      const digest = reportDigest(body.report);
      if (digest !== body.reportSha256) throw new AuditIntegrityError(`report digest mismatch: computed ${digest}`, signedTxId);
      if (body.report.headSha !== job.headSha) throw new AuditShaMismatchError(job.headSha, body.report.headSha, signedTxId);
      const bindErr = reportBindingError(body, job);
      if (bindErr) throw new AuditIntegrityError(bindErr, signedTxId);
      if (body.payment?.transactionId !== signedTxId) throw new AuditIntegrityError("report bound to a different payment", signedTxId);

      const result: PaidReviewResult = {
        jobId: job.jobId,
        repositoryId: job.repositoryId,
        pullNumber: job.pullNumber,
        headSha: job.headSha,
        reportSha256: digest,
        report: body.report,
        network: cfg.network,
        asset: accepted.asset,
        amountBaseUnits: accepted.amount,
        payerAccountId: cfg.payerAccountId,
        merchantAccountId: accepted.payTo,
        hederaTransactionId: signedTxId,
        settlementConfirmed: true,
        evidenceKind: "live",
        vendorId: body.vendorId,
        scannerVersion: body.report.scannerVersion,
      };
      // Validate against the shared runtime schema before handing it to ShipLock.
      const validated = PaidReviewResultSchema.safeParse(result);
      if (!validated.success) throw new AuditIntegrityError(`result fails PaidReviewResultSchema: ${validated.error.issues[0]?.message}`, signedTxId);

      return { ...validated.data, evidence: { requirements: accepted, transactionId: signedTxId, consensusTimestamp: status.consensusTimestamp, body } };

      async function settleUncertain(txId: string, why: string): Promise<never> {
        const s = await waitForMirror(cfg.mirror, txId, { timeoutMs: cfg.mirrorTimeoutMs ?? 30_000 });
        if (s.state === "success") throw new PaidButNotFulfilledError(`${why}; payment ${txId} is on-chain — retry fulfilment, do not re-pay`, txId);
        if (s.state === "failed") throw new PaymentPolicyError(`${why}; mirror reports ${s.result}`);
        throw new PaymentUncertainError(`${why}; outcome of ${txId} unknown — reconcile before any new payment`, txId);
      }
    },
  };
}

export interface PolicyContext {
  network: string;
  allowedPayTo: string[];
  feePayer: string;
  cap: bigint;
  job: ReviewJob;
}

/** Pure, unit-tested: why a requirement must not be signed (null = acceptable). */
export function rejectReason(r: PaymentRequirements, p: PolicyContext): string | null {
  if (r.scheme !== "exact") return `unsupported scheme ${r.scheme}`;
  if (r.network !== p.network) return `unsupported network ${r.network}`;
  if (r.asset !== HBAR_ASSET_ID) return `unsupported asset ${r.asset}`;
  if (!p.allowedPayTo.includes(r.payTo)) return `payTo ${r.payTo} not allowlisted`;
  if (r.extra?.feePayer !== p.feePayer) return `feePayer ${String(r.extra?.feePayer)} != facilitator ${p.feePayer}`;
  if (typeof r.amount !== "string" || !UINT_RE.test(r.amount)) return `non-integer amount ${String(r.amount)}`;
  const amt = BigInt(r.amount);
  if (amt <= 0n) return "zero amount";
  if (amt > p.cap) return `amount ${amt} exceeds cap ${p.cap}`;
  if (typeof r.maxTimeoutSeconds !== "number" || r.maxTimeoutSeconds <= 0 || r.maxTimeoutSeconds > 600) return "bad maxTimeoutSeconds";
  const e = r.extra ?? {};
  const j = p.job;
  if (e.headSha !== j.headSha) return `quote bound to head ${String(e.headSha)} not ${j.headSha}`;
  if (e.baseSha !== j.baseSha) return `quote bound to base ${String(e.baseSha)} not ${j.baseSha}`;
  if (e.repositoryId !== j.repositoryId) return `quote bound to repository id ${String(e.repositoryId)} not ${j.repositoryId}`;
  if (String(e.repository ?? "").toLowerCase() !== j.repository.toLowerCase()) return `quote bound to ${String(e.repository)} not ${j.repository}`;
  if (e.pullNumber !== j.pullNumber) return `quote bound to PR ${String(e.pullNumber)} not ${j.pullNumber}`;
  if (e.scannerVersion !== j.scannerVersion) return `quote bound to scanner ${String(e.scannerVersion)} not ${j.scannerVersion}`;
  return null;
}

function reportBindingError(body: PaidAuditBody, job: ReviewJob): string | null {
  const r = body.report;
  if (body.jobId !== job.jobId) return `paid body jobId ${body.jobId} != ${job.jobId}`;
  if (r.repositoryId !== job.repositoryId) return "report repository id mismatch";
  if (r.repository.toLowerCase() !== job.repository.toLowerCase()) return "report repository mismatch";
  if (r.pullNumber !== job.pullNumber) return "report pull request mismatch";
  if (r.baseSha !== job.baseSha) return "report base SHA mismatch";
  if (r.scannerVersion !== job.scannerVersion) return "report scanner version mismatch";
  return null;
}

function txIdFromPayload(payload: Record<string, unknown>): string {
  const tx = payload.transaction;
  if (typeof tx !== "string") throw new Error("payload has no transaction");
  return inspectHederaTransaction(tx).transactionId;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function extractError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: string };
    return j.error ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
