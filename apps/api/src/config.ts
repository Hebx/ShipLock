import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .regex(/^file:.+/, "DATABASE_URL must be file:<path>")
    .default("file:./data/shiplock.sqlite"),
  /** Comma-separated owner/repo allowlist. Only disposable demo repositories belong here. */
  GITHUB_DEMO_REPO: z.string().min(1),
  /** Fine-grained token restricted to the demo repository; optional for public read-only use. */
  GITHUB_FINE_GRAINED_TOKEN: z.string().optional(),
  /** Bearer token the coding agent uses for mutating agent endpoints. Unset = endpoints disabled. */
  SHIPLOCK_AGENT_TOKEN: z.string().min(32).optional(),
});

export interface Config {
  port: number;
  databasePath: string;
  allowlist: string[];
  githubToken?: string;
  agentToken?: string;
}

/** Loads `<repo>/.env.local` if present, then validates. Values are never logged. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envFile = resolve(REPO_ROOT, ".env.local");
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const blankToUndefined = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === "" || v?.startsWith("REPLACE_ME") ? undefined : v]));
  const parsed = EnvSchema.parse(blankToUndefined);
  return {
    port: parsed.API_PORT,
    databasePath: resolve(REPO_ROOT, parsed.DATABASE_URL.slice("file:".length)),
    allowlist: parsed.GITHUB_DEMO_REPO.split(",").map((s) => s.trim()).filter(Boolean),
    githubToken: parsed.GITHUB_FINE_GRAINED_TOKEN,
    agentToken: parsed.SHIPLOCK_AGENT_TOKEN,
  };
}
