/** Single canonical-JSON implementation lives in @shiplock/shared; re-exported for local use. */
import { canonicalJson, sha256Hex } from "@shiplock/shared";

export { canonicalJson, sha256Hex };

export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export const HEX_SHA_RE = /^[0-9a-f]{40}$/;
export const UINT_RE = /^(0|[1-9][0-9]*)$/;
export const ENTITY_RE = /^0\.0\.[0-9]+$/;
