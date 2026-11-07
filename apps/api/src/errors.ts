/** An expected, client-visible refusal. `code` is stable; `detail` must never contain secrets or identities. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503,
    readonly code: string,
    readonly detail?: Record<string, string | number | boolean | string[] | null>,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}
