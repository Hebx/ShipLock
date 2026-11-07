import type { SessionInfo } from "./api";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Same-origin call through the Next proxy; the session cookie rides along, mutations carry the CSRF token. */
export async function callApi<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; csrf?: string } = {}): Promise<ClientResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.csrf ? { "x-csrf-token": init.csrf } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: "ShipLock API is unreachable" };
  }
}

export const loadSession = () => callApi<SessionInfo>("/api/session");

/** World ID 4.0 unique-human credentials the API accepts (any one). */
export const HUMAN_CREDENTIALS = ["proof_of_human", "passport", "mnc", "selfie"] as const;

export const WORLD_ENV_LABEL = {
  production: "World ID (production)",
  staging: "World staging simulator — development proof, not real human verification",
} as const;
