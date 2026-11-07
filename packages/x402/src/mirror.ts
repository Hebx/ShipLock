/**
 * Hedera Mirror Node confirmation. Independent of the facilitator: we never treat a
 * facilitator `success: true` as final until consensus is visible on the mirror.
 */
import { ENTITY_RE } from "./canonical.ts";

export type MirrorStatus =
  | { state: "success"; consensusTimestamp: string; transactionId: string; transfers: MirrorTransfer[]; chargedTxFee: number }
  | { state: "failed"; result: string; transactionId: string }
  | { state: "not_found"; transactionId: string };

export interface MirrorTransfer {
  account: string;
  amount: number;
}

export interface MirrorClient {
  getTransaction(transactionId: string): Promise<MirrorStatus>;
}

/** "0.0.123@1700000000.000000042" -> "0.0.123-1700000000-000000042" */
export function toMirrorTransactionId(transactionId: string): string {
  const m = /^(0\.0\.[0-9]+)@([0-9]+)\.([0-9]+)$/.exec(transactionId);
  if (!m) throw new Error(`unrecognised Hedera transaction id: ${transactionId}`);
  return `${m[1]}-${m[2]}-${m[3]!.padStart(9, "0")}`;
}

/** Parse the valid-start seconds out of a transaction id (used to know when it can no longer execute). */
export function validStartSeconds(transactionId: string): number {
  const m = /@([0-9]+)\./.exec(transactionId);
  if (!m) throw new Error(`unrecognised Hedera transaction id: ${transactionId}`);
  return Number(m[1]);
}

export function createMirrorClient(baseUrl: string, fetchImpl: typeof fetch = fetch): MirrorClient {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async getTransaction(transactionId) {
      const mirrorId = toMirrorTransactionId(transactionId);
      const res = await fetchImpl(`${base}/api/v1/transactions/${mirrorId}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { state: "not_found", transactionId };
      if (!res.ok) throw new Error(`mirror node ${res.status} for ${mirrorId}`);
      const body = (await res.json()) as {
        transactions?: Array<{
          result: string;
          consensus_timestamp: string;
          transaction_id: string;
          scheduled?: boolean;
          nonce?: number;
          charged_tx_fee?: number;
          transfers?: Array<{ account: string; amount: number }>;
        }>;
      };
      // The parent (non-child, non-scheduled) record is the payment itself.
      const tx = body.transactions?.find((t) => !t.scheduled && (t.nonce ?? 0) === 0);
      if (!tx) return { state: "not_found", transactionId };
      if (tx.result !== "SUCCESS") return { state: "failed", result: tx.result, transactionId };
      return {
        state: "success",
        consensusTimestamp: tx.consensus_timestamp,
        transactionId,
        chargedTxFee: tx.charged_tx_fee ?? 0,
        transfers: (tx.transfers ?? []).map((t) => ({ account: t.account, amount: t.amount })),
      };
    },
  };
}

/** Poll until the mirror reports a final state or the window closes. */
export async function waitForMirror(
  mirror: MirrorClient,
  transactionId: string,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MirrorStatus> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let status: MirrorStatus;
    try {
      status = await mirror.getTransaction(transactionId);
    } catch {
      status = { state: "not_found", transactionId };
    }
    if (status.state !== "not_found" || Date.now() >= deadline) return status;
    await sleep(intervalMs);
  }
}

/**
 * Check the settled transfer list moves exactly `amount` tinybar from payer to payTo.
 * Network fees are paid by the facilitator (fee payer), so the payer's net debit equals the price.
 */
export function assertHbarTransfer(
  status: Extract<MirrorStatus, { state: "success" }>,
  expected: { payer?: string; payTo: string; amount: bigint },
): void {
  if (!ENTITY_RE.test(expected.payTo)) throw new Error("payTo must be a 0.0.x account id");
  const net = new Map<string, bigint>();
  for (const t of status.transfers) net.set(t.account, (net.get(t.account) ?? 0n) + BigInt(t.amount));
  const credited = net.get(expected.payTo) ?? 0n;
  // payTo may also collect staking/node rewards in rare cases; require at least the price.
  if (credited < expected.amount) {
    throw new Error(`payTo ${expected.payTo} credited ${credited}, expected ${expected.amount}`);
  }
  if (expected.payer) {
    const debited = net.get(expected.payer) ?? 0n;
    if (debited !== -expected.amount) {
      throw new Error(`payer ${expected.payer} net ${debited}, expected -${expected.amount}`);
    }
  }
}
