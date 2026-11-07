import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * - signed: payment signed and about to be sent; outcome unknown until the purchase returns
 * - paid: settled and confirmed by the buyer; result stored, not yet accepted by ShipLock
 * - accepted: ShipLock accepted the paid review
 * - uncertain / paid_unfulfilled: money may have moved; reconcile, never pay again
 * - invalid_review: paid, but the review did not bind to the job
 * - rejected: ShipLock refused the paid review
 */
export type PaymentStatus = "signed" | "paid" | "accepted" | "uncertain" | "paid_unfulfilled" | "invalid_review" | "rejected";

export interface PaymentEntry {
  jobId: string;
  transactionId: string;
  status: PaymentStatus;
  resultJson: string | null;
  detail: string | null;
  updatedAt: string;
}

interface Row {
  job_id: string;
  transaction_id: string;
  status: PaymentStatus;
  result_json: string | null;
  detail: string | null;
  updated_at: string;
}

/** The agent's durable record of every signed payment, one per ShipLock job. */
export class AgentLedger {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS payments (
        job_id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('signed','paid','accepted','uncertain','paid_unfulfilled','invalid_review','rejected')),
        result_json TEXT,
        detail TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(jobId: string): PaymentEntry | undefined {
    const row = this.db.prepare("SELECT * FROM payments WHERE job_id = ?").get(jobId) as Row | undefined;
    return row && { jobId: row.job_id, transactionId: row.transaction_id, status: row.status, resultJson: row.result_json, detail: row.detail, updatedAt: row.updated_at };
  }

  /** Throws if the job already has a payment: a job is paid for at most once. */
  recordSigned(jobId: string, transactionId: string): void {
    this.db.prepare("INSERT INTO payments (job_id, transaction_id, status, updated_at) VALUES (?, ?, 'signed', ?)").run(jobId, transactionId, new Date().toISOString());
  }

  update(jobId: string, status: PaymentStatus, fields: { resultJson?: string; detail?: string } = {}): void {
    this.db
      .prepare("UPDATE payments SET status = ?, result_json = COALESCE(?, result_json), detail = COALESCE(?, detail), updated_at = ? WHERE job_id = ?")
      .run(status, fields.resultJson ?? null, fields.detail ?? null, new Date().toISOString(), jobId);
  }
}
