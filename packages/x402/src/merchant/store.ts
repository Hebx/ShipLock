/**
 * Durable merchant state (node:sqlite). Survives restarts so a crash between
 * settle and response can be reconciled instead of re-charging or re-serving.
 *
 *   quotes:       issued 402 requirements, immutable once written
 *   payments:     one row per Hedera transaction id, UNIQUE per quote (single use)
 *   fulfillments: the paid audit body, written once per quote
 */
import { DatabaseSync } from "node:sqlite";

export type PaymentState = "settling" | "settled" | "failed" | "uncertain";

export interface QuoteRow {
  quoteId: string;
  jobId: string;
  repositoryId: number;
  repository: string;
  pullNumber: number;
  headSha: string;
  baseSha: string;
  scannerVersion: string;
  requirementsJson: string;
  resourceUrl: string;
  createdAt: number;
  expiresAt: number;
}

export interface PaymentRow {
  txId: string;
  quoteId: string;
  payloadSha256: string;
  state: PaymentState;
  payer: string | null;
  detail: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FulfillmentRow {
  quoteId: string;
  txId: string;
  bodyJson: string;
  reportSha256: string;
}

export class MerchantStore {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS quotes (
        quote_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        repository_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        pull_number INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        scanner_version TEXT NOT NULL,
        requirements_json TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        tx_id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(quote_id),
        payload_sha256 TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('settling','settled','failed','uncertain')),
        payer TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fulfillments (
        quote_id TEXT PRIMARY KEY REFERENCES quotes(quote_id),
        tx_id TEXT NOT NULL UNIQUE REFERENCES payments(tx_id),
        body_json TEXT NOT NULL,
        report_sha256 TEXT NOT NULL
      );
    `);
  }

  insertQuote(q: QuoteRow): void {
    this.db
      .prepare(
        `INSERT INTO quotes (quote_id, job_id, repository_id, repository, pull_number, head_sha, base_sha, scanner_version, requirements_json, resource_url, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(q.quoteId, q.jobId, q.repositoryId, q.repository, q.pullNumber, q.headSha, q.baseSha, q.scannerVersion, q.requirementsJson, q.resourceUrl, q.createdAt, q.expiresAt);
  }

  getQuote(quoteId: string): QuoteRow | undefined {
    const r = this.db.prepare(`SELECT * FROM quotes WHERE quote_id = ?`).get(quoteId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      quoteId: String(r.quote_id),
      jobId: String(r.job_id),
      repositoryId: Number(r.repository_id),
      repository: String(r.repository),
      pullNumber: Number(r.pull_number),
      headSha: String(r.head_sha),
      baseSha: String(r.base_sha),
      scannerVersion: String(r.scanner_version),
      requirementsJson: String(r.requirements_json),
      resourceUrl: String(r.resource_url),
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
    };
  }

  /**
   * Atomically claim a quote for a transaction. Returns "claimed" for the first caller,
   * otherwise the existing row so the caller can decide idempotent-replay vs reject.
   */
  claimPayment(p: Omit<PaymentRow, "state" | "detail" | "createdAt" | "updatedAt">, now: number):
    | { kind: "claimed" }
    | { kind: "exists"; row: PaymentRow } {
    try {
      this.db
        .prepare(
          `INSERT INTO payments (tx_id, quote_id, payload_sha256, state, payer, detail, created_at, updated_at)
           VALUES (?, ?, ?, 'settling', ?, NULL, ?, ?)`,
        )
        .run(p.txId, p.quoteId, p.payloadSha256, p.payer, now, now);
      return { kind: "claimed" };
    } catch (err) {
      if (!String((err as Error).message).includes("UNIQUE")) throw err;
      const row = this.getPaymentByTx(p.txId) ?? this.getPaymentByQuote(p.quoteId);
      if (!row) throw err;
      return { kind: "exists", row };
    }
  }

  setPaymentState(txId: string, state: PaymentState, detail: string | null, now: number): void {
    this.db.prepare(`UPDATE payments SET state = ?, detail = ?, updated_at = ? WHERE tx_id = ?`).run(state, detail, now, txId);
  }

  /** A definitively failed payment releases the quote so the buyer can obtain a fresh one. */
  deletePayment(txId: string): void {
    this.db.prepare(`DELETE FROM payments WHERE tx_id = ? AND state = 'failed'`).run(txId);
  }

  getPaymentByTx(txId: string): PaymentRow | undefined {
    return mapPayment(this.db.prepare(`SELECT * FROM payments WHERE tx_id = ?`).get(txId));
  }

  getPaymentByQuote(quoteId: string): PaymentRow | undefined {
    return mapPayment(this.db.prepare(`SELECT * FROM payments WHERE quote_id = ?`).get(quoteId));
  }

  insertFulfillment(f: FulfillmentRow): void {
    this.db
      .prepare(`INSERT INTO fulfillments (quote_id, tx_id, body_json, report_sha256) VALUES (?, ?, ?, ?)`)
      .run(f.quoteId, f.txId, f.bodyJson, f.reportSha256);
  }

  getFulfillment(quoteId: string): FulfillmentRow | undefined {
    const r = this.db.prepare(`SELECT * FROM fulfillments WHERE quote_id = ?`).get(quoteId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return { quoteId: String(r.quote_id), txId: String(r.tx_id), bodyJson: String(r.body_json), reportSha256: String(r.report_sha256) };
  }

  close(): void {
    this.db.close();
  }
}

function mapPayment(r: unknown): PaymentRow | undefined {
  if (!r) return undefined;
  const o = r as Record<string, unknown>;
  return {
    txId: String(o.tx_id),
    quoteId: String(o.quote_id),
    payloadSha256: String(o.payload_sha256),
    state: String(o.state) as PaymentState,
    payer: o.payer == null ? null : String(o.payer),
    detail: o.detail == null ? null : String(o.detail),
    createdAt: Number(o.created_at),
    updatedAt: Number(o.updated_at),
  };
}
