import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { EvidenceKind, WorldEnvironment } from "@shiplock/shared";
import { EvidenceKindSchema, HederaAccountIdSchema, TinybarSchema } from "@shiplock/shared";
import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Browser-facing origin (the Next.js app). Cookies, OAuth redirects and Origin checks use it. */
  APP_URL: z.url().default("http://localhost:3000"),
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

  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  /** Minimum repository role a maintainer needs to approve and merge. */
  SHIPLOCK_MIN_GITHUB_PERMISSION: z.enum(["write", "maintain", "admin"]).default("write"),
  SHIPLOCK_MERGE_METHOD: z.enum(["merge", "squash", "rebase"]).default("squash"),
  /** Lets staging World proofs or non-live paid evidence drive a merge. Demo repositories only. */
  SHIPLOCK_ALLOW_DEVELOPMENT_MERGE: bool.default(false),

  WORLD_APP_ID: z.string().regex(/^app_[A-Za-z0-9_]+$/).optional(),
  WORLD_RP_ID: z.string().regex(/^rp_[A-Za-z0-9_-]+$/).optional(),
  WORLD_RP_SIGNING_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "expected 32-byte hex").optional(),
  WORLD_ENVIRONMENT: z.enum(["production", "staging"]).optional(),
  WORLD_ENROLL_ACTION: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  WORLD_REQUIRE_USER_PRESENCE: bool.default(true),
  WORLD_VERIFY_BASE_URL: z.url().default("https://developer.world.org"),

  HEDERA_NETWORK: z.literal("hedera:testnet").default("hedera:testnet"),
  HEDERA_MIRROR_NODE_URL: z.url().default("https://testnet.mirrornode.hedera.com"),
  HEDERA_AUDIT_PAYTO_ACCOUNT_ID: HederaAccountIdSchema.optional(),
  /** The only account allowed to pay for reviews (the agent's x402 signer). */
  HEDERA_AGENT_ACCOUNT_ID: HederaAccountIdSchema.optional(),
  /** x402 asset id for native HBAR. Must match what the merchant quotes (Hermes contract). */
  X402_HBAR_ASSET: z.string().min(1).max(64).default("0.0.0"),
  AUDIT_PRICE_TINYBAR: TinybarSchema.optional(),
  AGENT_MAX_PAYMENT_TINYBAR: TinybarSchema.optional(),
  /** Comma-separated evidence kinds accepted for paid reviews. `simulated` is for local UI work only. */
  SHIPLOCK_ACCEPTED_EVIDENCE: z.string().default("live"),
});

export interface WorldConfig {
  appId: string;
  rpId: string;
  signingKeyHex: string;
  environment: WorldEnvironment;
  enrollAction: string;
  requireUserPresence: boolean;
  verifyBaseUrl: string;
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface PaidReviewConfig {
  network: "hedera:testnet";
  asset: string;
  merchantAccountId: string;
  payerAccountId: string;
  quotedTinybar: string;
  maxTinybar: string;
  acceptedEvidence: EvidenceKind[];
  mirrorNodeUrl: string;
}

export interface Config {
  port: number;
  appUrl: string;
  databasePath: string;
  allowlist: string[];
  githubToken?: string;
  agentToken?: string;
  githubOAuth?: GitHubOAuthConfig;
  minGithubPermission: "write" | "maintain" | "admin";
  mergeMethod: "merge" | "squash" | "rebase";
  allowDevelopmentMerge: boolean;
  world?: WorldConfig;
  paidReview?: PaidReviewConfig;
}

/** Loads `<repo>/.env.local` if present, then validates. Values are never logged. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envFile = resolve(REPO_ROOT, ".env.local");
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const placeholder = (v: string | undefined) => v === undefined || v === "" || /REPLACE_ME|CHANGE_ME/.test(v);
  const cleaned = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, placeholder(v) ? undefined : v]));
  const p = EnvSchema.parse(cleaned);

  if (p.WORLD_ENVIRONMENT === "production" && !p.WORLD_REQUIRE_USER_PRESENCE) {
    // The presence opt-out exists only for simulator runs that cannot complete the check.
    throw new Error("WORLD_REQUIRE_USER_PRESENCE=false is not allowed with WORLD_ENVIRONMENT=production");
  }
  const worldVars = [p.WORLD_APP_ID, p.WORLD_RP_ID, p.WORLD_RP_SIGNING_KEY, p.WORLD_ENVIRONMENT, p.WORLD_ENROLL_ACTION];
  const world =
    worldVars.every((v) => v !== undefined)
      ? {
          appId: p.WORLD_APP_ID!,
          rpId: p.WORLD_RP_ID!,
          signingKeyHex: p.WORLD_RP_SIGNING_KEY!,
          environment: p.WORLD_ENVIRONMENT!,
          enrollAction: p.WORLD_ENROLL_ACTION!,
          requireUserPresence: p.WORLD_REQUIRE_USER_PRESENCE,
          verifyBaseUrl: p.WORLD_VERIFY_BASE_URL.replace(/\/+$/, ""),
        }
      : undefined;

  const acceptedEvidence = p.SHIPLOCK_ACCEPTED_EVIDENCE.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => EvidenceKindSchema.parse(s));
  const paidReview =
    p.HEDERA_AUDIT_PAYTO_ACCOUNT_ID && p.HEDERA_AGENT_ACCOUNT_ID && p.AUDIT_PRICE_TINYBAR && p.AGENT_MAX_PAYMENT_TINYBAR
      ? {
          network: p.HEDERA_NETWORK,
          asset: p.X402_HBAR_ASSET,
          merchantAccountId: p.HEDERA_AUDIT_PAYTO_ACCOUNT_ID,
          payerAccountId: p.HEDERA_AGENT_ACCOUNT_ID,
          quotedTinybar: p.AUDIT_PRICE_TINYBAR,
          maxTinybar: p.AGENT_MAX_PAYMENT_TINYBAR,
          acceptedEvidence,
          mirrorNodeUrl: p.HEDERA_MIRROR_NODE_URL.replace(/\/+$/, ""),
        }
      : undefined;

  return {
    port: p.API_PORT,
    appUrl: new URL(p.APP_URL).origin,
    databasePath: resolve(REPO_ROOT, p.DATABASE_URL.slice("file:".length)),
    allowlist: p.GITHUB_DEMO_REPO.split(",").map((s) => s.trim()).filter(Boolean),
    githubToken: p.GITHUB_FINE_GRAINED_TOKEN,
    agentToken: p.SHIPLOCK_AGENT_TOKEN,
    githubOAuth:
      p.GITHUB_OAUTH_CLIENT_ID && p.GITHUB_OAUTH_CLIENT_SECRET
        ? { clientId: p.GITHUB_OAUTH_CLIENT_ID, clientSecret: p.GITHUB_OAUTH_CLIENT_SECRET }
        : undefined,
    minGithubPermission: p.SHIPLOCK_MIN_GITHUB_PERMISSION,
    mergeMethod: p.SHIPLOCK_MERGE_METHOD,
    allowDevelopmentMerge: p.SHIPLOCK_ALLOW_DEVELOPMENT_MERGE,
    world,
    paidReview,
  };
}
