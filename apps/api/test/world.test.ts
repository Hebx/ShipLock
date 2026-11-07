import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { describe, expect, it } from "vitest";
import { canonicalFieldElement, checkEnrollmentResult, checkSessionResult, verifyWithWorld } from "../src/world.ts";
import { testConfig, WORLD_SESSION } from "./harness.ts";

const world = testConfig().world!;
const expect_ = { environment: "staging", signal: "op-hash", requireUserPresence: true };

function sessionShape(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0",
    nonce: "0xABC",
    session_id: WORLD_SESSION,
    environment: "staging",
    user_presence_completed: true,
    responses: [{ identifier: "proof_of_human", signal_hash: hashSignal("op-hash"), proof: ["1", "2", "3", "4", "5"], session_nullifier: ["7", "1"], issuer_schema_id: 1, expires_at_min: 1, ...item }],
    ...overrides,
  };
}

describe("canonicalFieldElement (unit)", () => {
  it("maps 0x-hex and decimal encodings of one value to the same canonical string", () => {
    const hex = "0x" + "0".repeat(20) + "ff";
    expect(canonicalFieldElement(hex)).toBe(canonicalFieldElement("255"));
    expect(canonicalFieldElement("0xFF")).toBe(canonicalFieldElement("0xff"));
    expect(canonicalFieldElement("255")).toMatch(/^nil_[0-9a-f]{64}$/);
  });

  it("rejects anything that is not 0x-hex or decimal, and out-of-field values", () => {
    for (const bad of ["ff", "-1", "0x", "1e5", " 1", "0x" + "f".repeat(64), "9".repeat(79)]) expect(canonicalFieldElement(bad)).toBeNull();
  });
});

describe("checkSessionResult (unit)", () => {
  it("accepts a well-formed session proof for the expected signal", () => {
    const r = checkSessionResult(sessionShape(), expect_);
    expect(r).toMatchObject({ ok: true, value: { nonce: "0xabc", sessionId: WORLD_SESSION } });
  });

  it("rejects environment mismatch, wrong signal, missing presence, wrong credential and uniqueness-shaped results", () => {
    expect(checkSessionResult(sessionShape({ environment: "production" }), expect_)).toEqual({ ok: false, reason: "environment_mismatch" });
    expect(checkSessionResult(sessionShape({}, { signal_hash: hashSignal("other-op") }), expect_)).toEqual({ ok: false, reason: "signal_mismatch" });
    expect(checkSessionResult(sessionShape({}, { signal_hash: undefined }), expect_)).toEqual({ ok: false, reason: "signal_mismatch" });
    expect(checkSessionResult(sessionShape({ user_presence_completed: false }), expect_)).toEqual({ ok: false, reason: "user_presence_missing" });
    expect(checkSessionResult(sessionShape({ user_presence_completed: undefined }), expect_)).toEqual({ ok: false, reason: "user_presence_missing" });
    expect(checkSessionResult(sessionShape({ user_presence_completed: undefined }), { ...expect_, requireUserPresence: false }).ok).toBe(true);
    expect(checkSessionResult(sessionShape({}, { identifier: "selfie", issuer_schema_id: 11 }), expect_)).toEqual({ ok: false, reason: "credential_not_accepted" });
    expect(checkSessionResult(sessionShape({}, { identifier: "proof_of_human", issuer_schema_id: 2 }), expect_)).toEqual({ ok: false, reason: "credential_not_accepted" });
    expect(checkSessionResult(sessionShape({}, { identifier: "passport", issuer_schema_id: 9 }), expect_).ok).toBe(true);
    expect(checkSessionResult(sessionShape({ action: "merge" }), expect_)).toEqual({ ok: false, reason: "malformed_idkit_result" });
    expect(checkSessionResult(sessionShape({ protocol_version: "3.0" }), expect_)).toEqual({ ok: false, reason: "malformed_idkit_result" });
    expect(checkSessionResult({ success: true }, expect_)).toEqual({ ok: false, reason: "malformed_idkit_result" });
  });
});

describe("checkEnrollmentResult (unit)", () => {
  const enrollment = (o: Record<string, unknown> = {}) => ({
    ...sessionShape(),
    action: "shiplock-enroll",
    responses: [{ identifier: "proof_of_human", signal_hash: hashSignal("op-hash"), proof: ["1", "2", "3", "4", "5"], nullifier: "0x10", issuer_schema_id: 1, expires_at_min: 1 }],
    ...o,
  });

  it("requires the configured enrollment action and a session id", () => {
    expect(checkEnrollmentResult(enrollment(), { ...expect_, action: "shiplock-enroll" }).ok).toBe(true);
    expect(checkEnrollmentResult(enrollment({ action: "other" }), { ...expect_, action: "shiplock-enroll" })).toEqual({ ok: false, reason: "action_mismatch" });
    expect(checkEnrollmentResult(enrollment({ session_id: undefined }), { ...expect_, action: "shiplock-enroll" })).toEqual({ ok: false, reason: "malformed_idkit_result" });
  });
});

describe("verifyWithWorld (unit, stubbed fetch)", () => {
  const stub = (res: Response | Error) => (async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

  it("forwards the result unmodified to /api/v4/verify/{rp_id}", async () => {
    const raw = sessionShape();
    let seen: { url: string; body: string } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return Response.json({ success: true, environment: "staging" });
    }) as unknown as typeof fetch;
    expect(await verifyWithWorld(f, world, raw)).toEqual({ ok: true, sessionId: undefined, nullifier: undefined, action: undefined });
    expect(seen).toEqual({ url: "https://world.test/api/v4/verify/rp_test", body: JSON.stringify(raw) });
  });

  it("treats 400, 404, timeouts, success:false, non-JSON and environment mismatch as failure", async () => {
    expect(await verifyWithWorld(stub(Response.json({ success: false, code: "app_not_migrated", detail: "x" }, { status: 400 })), world, {})).toEqual({ ok: false, reason: "verify_http_400:app_not_migrated" });
    expect(await verifyWithWorld(stub(Response.json({ success: false, code: "not_found" }, { status: 404 })), world, {})).toEqual({ ok: false, reason: "verify_http_404:not_found" });
    expect(await verifyWithWorld(stub(new DOMException("timed out", "TimeoutError") as unknown as Error), world, {})).toEqual({ ok: false, reason: "verify_unreachable" });
    expect(await verifyWithWorld(stub(Response.json({ success: false, environment: "staging" })), world, {})).toEqual({ ok: false, reason: "verify_not_successful" });
    expect(await verifyWithWorld(stub(new Response("<html>")), world, {})).toEqual({ ok: false, reason: "verify_not_successful" });
    expect(await verifyWithWorld(stub(Response.json({ success: true, environment: "production" })), world, {})).toEqual({ ok: false, reason: "verify_environment_mismatch" });
    expect(await verifyWithWorld(stub(Response.json({ success: true, environment: "staging" }, { status: 201 })), world, {})).toEqual({ ok: false, reason: "verify_http_201" });
  });
});
