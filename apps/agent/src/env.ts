import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Loads `<repo>/.env.local` without overriding variables already set. Values are never logged. */
export function loadRepoEnv(): void {
  const file = resolve(REPO_ROOT, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}
