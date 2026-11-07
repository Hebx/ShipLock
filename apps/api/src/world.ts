import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { Nullifier } from "@worldcoin/idkit-core/nullifier";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { z } from "zod";
import type { WorldConfig } from "./config.ts";

/**
 * World ID 4.0 unique-human credentials ShipLock accepts, with the documented issuer schema ids
 * (Proof of Human 1, Selfie Check 11); World verify binds passport and national ID to theirs.
 * Selfie Check is lower assurance than Orb; the credential used is recorded with the proof.
 */
const HUMAN_CREDENTIALS = new Set(["proof_of_human", "passport", "mnc", "selfie"]);
const KNOWN_SCHEMA_IDS = new Map([["proof_of_human", 1], ["selfie", 11]]);
const VERIFY_TIMEOUT_MS = 10_000;

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** Signs a fresh RP context server-side. Omitting `action` yields a session-proof signature. */
export function issueRpContext(world: WorldConfig, opts: { action?: string; ttlSeconds: number }): { rpContext: RpContext; nonce: string; expiresAt: Date } {
  const sig = signRequest({ signingKeyHex: world.signingKeyHex, action: opts.action, ttl: opts.ttlSeconds });
  return {
    rpContext: { rp_id: world.rpId, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
    nonce: sig.nonce.toLowerCase(),
    expiresAt: new Date(sig.expiresAt * 1000),
  };
}

/**
 * Canonical `nil_<64 hex>` form of a World field element given as 0x-hex or pure decimal.
 * World docs show 0x-hex while the 4.x SDK types say decimal; both must map to one value so a
 * re-encoded nullifier cannot slip past a UNIQUE constraint. Anything else is rejected.
 */
export function canonicalFieldElement(value: string): string | null {
  let n: bigint;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value) || /^[0-9]{1,78}$/.test(value)) n = BigInt(value);
  else return null;
  try {
    return Nullifier.fromHex(n.toString(16)).toCanonicalString();
  } catch {
    return null;
  }
}

export function signalHashFor(signal: string): string {
  return canonicalFieldElement(hashSignal(signal))!;
}

const FieldString = z.string().min(1).max(100);
const ProofSchema = z.array(FieldString).length(5);
const SessionIdSchema = z.string().regex(/^session_[0-9a-fA-F]{32,256}$/);

const EnrollmentResultSchema = z.object({
  protocol_version: z.literal("4.0"),
  nonce: z.string().min(1).max(100),
  action: z.string().min(1).max(100),
  session_id: SessionIdSchema,
  environment: z.string(),
  user_presence_completed: z.boolean().optional(),
  responses: z
    .array(
      z.object({
        identifier: z.string(),
        signal_hash: FieldString.optional(),
        proof: ProofSchema,
        nullifier: FieldString,
        issuer_schema_id: z.number().int(),
        expires_at_min: z.number().int(),
      }),
    )
    .length(1),
});

const SessionResultSchema = z.object({
  protocol_version: z.literal("4.0"),
  nonce: z.string().min(1).max(100),
  action: z.never({ error: "session proofs carry no action" }).optional(),
  session_id: SessionIdSchema,
  environment: z.string(),
  user_presence_completed: z.boolean().optional(),
  responses: z
    .array(
      z.object({
        identifier: z.string(),
        signal_hash: FieldString.optional(),
        proof: ProofSchema,
        session_nullifier: z.array(FieldString).length(2),
        issuer_schema_id: z.number().int(),
        expires_at_min: z.number().int(),
      }),
    )
    .length(1),
});

export interface ProofExpectations {
  environment: string;
  signal: string;
  requireUserPresence: boolean;
}

export type ProofCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

function checkCommon(
  r: { environment: string; user_presence_completed?: boolean; responses: Array<{ identifier: string; issuer_schema_id: number; signal_hash?: string }> },
  expect: ProofExpectations,
): string | null {
  if (r.environment !== expect.environment) return "environment_mismatch";
  const expectedSignal = signalHashFor(expect.signal);
  for (const item of r.responses) {
    if (!HUMAN_CREDENTIALS.has(item.identifier)) return "credential_not_accepted";
    const schemaId = KNOWN_SCHEMA_IDS.get(item.identifier);
    if (schemaId !== undefined && item.issuer_schema_id !== schemaId) return "credential_not_accepted";
    if (!item.signal_hash || canonicalFieldElement(item.signal_hash) !== expectedSignal) return "signal_mismatch";
  }
  if (expect.requireUserPresence && r.user_presence_completed !== true) return "user_presence_missing";
  return null;
}

/** Local checks on an enrollment result (uniqueness proof that also creates a session). No network. */
export function checkEnrollmentResult(
  raw: unknown,
  expect: ProofExpectations & { action: string },
): ProofCheck<{ nonce: string; sessionId: string; nullifier: string }> {
  const parsed = EnrollmentResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed_idkit_result" };
  const r = parsed.data;
  if (r.action !== expect.action) return { ok: false, reason: "action_mismatch" };
  const common = checkCommon(r, expect);
  if (common) return { ok: false, reason: common };
  const nullifier = canonicalFieldElement(r.responses[0]!.nullifier);
  if (!nullifier) return { ok: false, reason: "malformed_nullifier" };
  return { ok: true, value: { nonce: r.nonce.toLowerCase(), sessionId: r.session_id, nullifier } };
}

/** Local checks on a session proof for an approval. No network. */
export function checkSessionResult(raw: unknown, expect: ProofExpectations): ProofCheck<{ nonce: string; sessionId: string; sessionNullifier: string }> {
  const parsed = SessionResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed_idkit_result" };
  const r = parsed.data;
  const common = checkCommon(r, expect);
  if (common) return { ok: false, reason: common };
  const sessionNullifier = canonicalFieldElement(r.responses[0]!.session_nullifier[0]!);
  if (!sessionNullifier) return { ok: false, reason: "malformed_nullifier" };
  return { ok: true, value: { nonce: r.nonce.toLowerCase(), sessionId: r.session_id, sessionNullifier } };
}

const VerifySuccessSchema = z.object({
  success: z.literal(true),
  environment: z.string(),
  session_id: z.string().optional(),
  nullifier: z.string().optional(),
  action: z.string().optional(),
});
const VerifyErrorSchema = z.object({ code: z.string().regex(/^[a-z0-9_]{1,64}$/) });

export type VerifyOutcome = { ok: true; sessionId?: string; nullifier?: string; action?: string } | { ok: false; reason: string };

/**
 * Forwards the IDKit result unmodified to World's verify endpoint. Only HTTP 200 with
 * `success: true` and the expected environment counts; timeouts and every other answer fail.
 */
export async function verifyWithWorld(doFetch: typeof fetch, world: WorldConfig, raw: unknown): Promise<VerifyOutcome> {
  let res: Response;
  try {
    res = await doFetch(`${world.verifyBaseUrl}/api/v4/verify/${encodeURIComponent(world.rpId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "shiplock" },
      body: JSON.stringify(raw),
      redirect: "error",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "verify_unreachable" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status !== 200) {
    const code = VerifyErrorSchema.safeParse(body);
    return { ok: false, reason: `verify_http_${res.status}${code.success ? `:${code.data.code}` : ""}` };
  }
  const ok = VerifySuccessSchema.safeParse(body);
  if (!ok.success) return { ok: false, reason: "verify_not_successful" };
  if (ok.data.environment !== world.environment) return { ok: false, reason: "verify_environment_mismatch" };
  return { ok: true, sessionId: ok.data.session_id, nullifier: ok.data.nullifier, action: ok.data.action };
}
