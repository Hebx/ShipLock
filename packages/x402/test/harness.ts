/**
 * Strict test facilitator: the OFFICIAL @x402/hedera exact facilitator scheme (real decode,
 * transfer-semantics, fee-payer and signature checks) wired through the OFFICIAL x402Facilitator.
 * Only the two network edges are replaced:
 *   - payer key lookup  -> in-memory map (real ECDSA public keys, real signature verification)
 *   - sign-and-submit   -> in-memory ledger that records the tx id and dedupes like Hedera
 * Malformed, mis-signed, wrong-amount, wrong-recipient payloads are rejected by SDK code, not by us.
 */
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { ExactHederaScheme as FacilitatorScheme } from "@x402/hedera/exact/facilitator";
import { PrivateKey, Transaction, inspectHederaTransaction, extractTransactionFromPayload } from "@x402/hedera";
import type { MirrorClient, MirrorStatus } from "../src/mirror.ts";
import { sha256Hex, type ReviewJob } from "@shiplock/shared";
import { SCANNER_VERSION } from "@shiplock/scanner";
import { createScannerAuditor } from "../src/merchant/scanner-auditor.ts";
import type { Auditor } from "../src/audit.ts";

export const NETWORK = "hedera:testnet" as const;
export const FEE_PAYER = "0.0.7162784";
export const PAYER = "0.0.7304745";
export const PAY_TO = "0.0.9050506";
export const SHA = "9f02660cc260307226d23b09214d2a474c0a6bbd";
export const BASE_SHA = "8f5096f0000000000000000000000000000000aa";

export const payerKey = PrivateKey.generateECDSA();

export type SettleMode = "ok" | "throw_after_submit" | "throw_before_submit" | "report_failure_after_submit" | "hang";

export class Ledger implements MirrorClient {
  readonly txs = new Map<string, MirrorStatus>();
  submitCount = 0;
  async getTransaction(transactionId: string): Promise<MirrorStatus> {
    return this.txs.get(transactionId) ?? { state: "not_found", transactionId };
  }
  record(b64: string): string {
    const inspected = inspectHederaTransaction(b64);
    if (this.txs.has(inspected.transactionId)) throw new Error("DUPLICATE_TRANSACTION");
    this.submitCount++;
    this.txs.set(inspected.transactionId, {
      state: "success",
      transactionId: inspected.transactionId,
      consensusTimestamp: `${Math.floor(Date.now() / 1000)}.000000001`,
      chargedTxFee: 300000,
      transfers: inspected.hbarTransfers.map((t) => ({ account: t.accountId, amount: Number(t.amount) })),
    });
    return inspected.transactionId;
  }
}

export function createStrictFacilitator(ledger: Ledger, opts: { settleMode?: () => SettleMode; supported?: SupportedResponse } = {}) {
  const keys = new Map<string, PrivateKey>([[PAYER, payerKey]]);
  const calls = { verify: 0, settle: 0, supported: 0 };
  const scheme = new FacilitatorScheme({
    getAddresses: () => [FEE_PAYER],
    async verifyPayerSignature({ payer, transaction }) {
      const k = keys.get(payer);
      if (!k) return { ok: false, reason: "signature_invalid", message: "unknown payer" };
      const tx = Transaction.fromBytes(Buffer.from(transaction, "base64"));
      return k.publicKey.verifyTransaction(tx) ? { ok: true } : { ok: false, reason: "signature_invalid", message: `payer ${payer} did not sign` };
    },
    async preflightTransfer() {
      return { ok: true };
    },
    async signAndSubmitTransaction(b64) {
      const mode = opts.settleMode?.() ?? "ok";
      if (mode === "throw_before_submit") throw new Error("node unreachable");
      if (mode === "hang") await new Promise(() => {});
      const transactionId = ledger.record(b64);
      if (mode === "throw_after_submit") throw new Error("receipt timeout");
      return { transactionId };
    },
  });
  const fac = new x402Facilitator().register(NETWORK, scheme);
  const reportFailure = () => (opts.settleMode?.() ?? "ok") === "report_failure_after_submit";

  const client: FacilitatorClient & { calls: typeof calls } = {
    calls,
    async getSupported() {
      calls.supported++;
      return opts.supported ?? (fac.getSupported() as SupportedResponse);
    },
    async verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> {
      calls.verify++;
      return fac.verify(roundTrip(p), roundTrip(r));
    },
    async settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> {
      calls.settle++;
      if (reportFailure()) {
        ledger.record(extractTransactionFromPayload(p.payload as { transaction: string }));
        return { success: false, errorReason: "transaction_failed", errorMessage: "receipt timeout", transaction: "", network: r.network };
      }
      return fac.settle(roundTrip(p), roundTrip(r));
    },
  };
  return client;
}

/** Force a JSON round-trip like a real HTTP facilitator would see. */
function roundTrip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A small real unified diff; the real @shiplock/scanner produces the canonical report. */
export const FIXTURE_DIFF = new TextEncoder().encode(
  [
    "diff --git a/src/run.ts b/src/run.ts",
    "index 1111111..2222222 100644",
    "--- a/src/run.ts",
    "+++ b/src/run.ts",
    "@@ -1,1 +1,3 @@",
    " export const a = 1;",
    "+import { execSync } from 'node:child_process';",
    "+export const b = (x: string) => execSync(`ls ${x}`);",
    "",
  ].join("\n"),
);

export const JOB: ReviewJob = {
  jobId: "job-1",
  repositoryId: 987654,
  repository: "Hebx/shiplock-demo-target",
  pullNumber: 7,
  headSha: SHA,
  baseSha: BASE_SHA,
  scannerVersion: SCANNER_VERSION,
};

export const DIFF_SHA = sha256Hex(FIXTURE_DIFF);

/** Fake GitHub reader for merchant pre-quote checks (repo id, PR open, head/base, diff bytes). */
export const fakeGithub = {
  head: SHA,
  async getPullRequest(repository: string, number: number) {
    return {
      repositoryId: JOB.repositoryId, repository, number, state: "open" as const, merged: false, draft: false, title: "t",
      htmlUrl: "", authorLogin: "bot", headSha: fakeGithub.head, headRef: "feat", headRepository: repository, baseSha: BASE_SHA, baseRef: "main",
    } as never;
  },
  async getCompareDiff(_r: string, base: string, head: string) {
    if (base !== BASE_SHA || head !== SHA) throw new Error(`no fixture for ${base}...${head}`);
    return FIXTURE_DIFF;
  },
};

export const scannerAuditor: Auditor = createScannerAuditor({
  github: {
    async getCompareDiff(_repo, base, head) {
      if (base !== BASE_SHA || head !== SHA) throw new Error(`no fixture for ${base}...${head}`);
      return FIXTURE_DIFF;
    },
  },
});

export const noopAuditor = scannerAuditor;
