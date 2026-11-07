import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Deterministic JSON: object keys sorted by code unit, no whitespace, `undefined` object
 * members dropped. Only safe integers are allowed so encodings cannot drift across runtimes.
 */
export function canonicalJson(value: unknown): string {
  return encode(value as Json, "$");
}

function encode(value: Json, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`canonicalJson: ${path} must be a safe integer`);
      }
      return String(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => encode(item, `${path}[${i}]`)).join(",")}]`;
      }
      const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(value[k] as Json, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value} at ${path}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
