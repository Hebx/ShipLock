import { z } from "zod";

export type LedgerCheck = { kind: "confirmed"; consensusTimestamp: string } | { kind: "mismatch"; reason: string } | { kind: "unknown"; reason: string };

const MirrorSchema = z.object({
  transactions: z.array(
    z.object({
      transaction_id: z.string(),
      consensus_timestamp: z.string(),
      result: z.string(),
      name: z.string(),
      nonce: z.number().int().optional(),
      scheduled: z.boolean().optional(),
      transfers: z.array(z.object({ account: z.string(), amount: z.number().int() })),
    }),
  ),
});

/** `0.0.1234@1700000000.123456789` -> `0.0.1234-1700000000-123456789` (mirror node path form). */
export function toMirrorTransactionId(txId: string): string {
  const m = /^(0\.0\.[0-9]{1,12})@([0-9]{1,12})\.([0-9]{1,9})$/.exec(txId);
  if (!m) throw new TypeError("invalid Hedera transaction id");
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Mirror consensus timestamp (`seconds.nanos`) as nanoseconds since the epoch. */
function consensusNanos(ts: string): bigint | null {
  const m = /^([0-9]{1,12})\.([0-9]{1,9})$/.exec(ts);
  return m ? BigInt(m[1]!) * 1_000_000_000n + BigInt(m[2]!.padEnd(9, "0")) : null;
}

/**
 * Independent ledger confirmation of a paid review: the transaction succeeded and moved exactly
 * `amount` tinybar from the payer into the merchant account. The facilitator pays the network fee in
 * the x402 exact scheme, so any other net movement on the payer means extra transfers were bundled in.
 * `notBefore` rejects transfers that reached consensus before the review job existed, so an older
 * payment from the same agent cannot be paired with a new job.
 * Not-yet-indexed or unreachable is `unknown`, never a failure and never a success.
 */
export async function checkHederaTransfer(
  doFetch: typeof fetch,
  mirrorBaseUrl: string,
  expect: { transactionId: string; payer: string; merchant: string; amountTinybar: string; notBefore?: Date },
): Promise<LedgerCheck> {
  const id = toMirrorTransactionId(expect.transactionId);
  let res: Response;
  try {
    res = await doFetch(`${mirrorBaseUrl}/api/v1/transactions/${id}`, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { kind: "unknown", reason: "mirror_unreachable" };
  }
  if (res.status === 404) return { kind: "unknown", reason: "mirror_not_found_yet" };
  if (!res.ok) return { kind: "unknown", reason: `mirror_http_${res.status}` };
  const parsed = MirrorSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { kind: "unknown", reason: "mirror_unparseable" };

  const tx = parsed.data.transactions.find((t) => t.transaction_id === id && (t.nonce ?? 0) === 0 && !t.scheduled);
  if (!tx) return { kind: "unknown", reason: "mirror_transaction_absent" };
  if (tx.result !== "SUCCESS") return { kind: "mismatch", reason: `ledger_result_${tx.result}` };
  if (tx.name !== "CRYPTOTRANSFER") return { kind: "mismatch", reason: "ledger_not_cryptotransfer" };
  const net = (account: string) => tx.transfers.filter((t) => t.account === account).reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const amount = BigInt(expect.amountTinybar);
  if (net(expect.merchant) !== amount) return { kind: "mismatch", reason: "ledger_merchant_amount_mismatch" };
  if (net(expect.payer) !== -amount) return { kind: "mismatch", reason: "ledger_payer_debit_mismatch" };
  if (expect.notBefore) {
    const at = consensusNanos(tx.consensus_timestamp);
    if (at === null) return { kind: "unknown", reason: "mirror_unparseable" };
    if (at < BigInt(expect.notBefore.getTime()) * 1_000_000n) return { kind: "mismatch", reason: "ledger_transfer_before_job" };
  }
  return { kind: "confirmed", consensusTimestamp: tx.consensus_timestamp };
}
