import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace.
 * Used for report digests and quote equality so both sides compute the same bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export const HEX_SHA_RE = /^[0-9a-f]{40}$/;
export const UINT_RE = /^(0|[1-9][0-9]*)$/;
export const ENTITY_RE = /^0\.0\.[0-9]+$/;
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
