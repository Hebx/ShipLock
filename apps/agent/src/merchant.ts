/**
 * Independent x402 audit merchant (the review vendor the agent pays):
 *   pnpm --filter @shiplock/agent merchant
 * Serves `GET /audit` behind HTTP 402 on hedera:testnet and runs ShipLock's deterministic scanner
 * over the exact compare diff. Holds no ShipLock or payer secrets.
 */
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createGitHubClient } from "@shiplock/github";
import { createAuditMerchant, createMirrorClient, createScannerAuditor, MerchantStore } from "@shiplock/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { z } from "zod";
import { loadRepoEnv, REPO_ROOT } from "./env.ts";

loadRepoEnv();
const env = z
  .object({
    HEDERA_AUDIT_PAYTO_ACCOUNT_ID: z.string(),
    AUDIT_PRICE_TINYBAR: z.string().regex(/^[1-9][0-9]{0,18}$/),
    X402_FACILITATOR_URL: z.url(),
    HEDERA_MIRROR_NODE_URL: z.url(),
    GITHUB_DEMO_REPO: z.string().min(1),
    AUDIT_GITHUB_TOKEN: z.string().optional(),
    MERCHANT_HOST: z.string().default("127.0.0.1"),
    MERCHANT_PORT: z.coerce.number().int().positive().default(4402),
    MERCHANT_PUBLIC_URL: z.url().optional(),
    MERCHANT_DB_PATH: z.string().default("data/merchant.sqlite"),
  })
  .parse(process.env);

const allowlist = env.GITHUB_DEMO_REPO.split(",").map((s) => s.trim()).filter(Boolean);
const github = createGitHubClient({ allowlist, token: env.AUDIT_GITHUB_TOKEN });
const publicBaseUrl = env.MERCHANT_PUBLIC_URL ?? `http://${env.MERCHANT_HOST}:${env.MERCHANT_PORT}`;

const merchant = await createAuditMerchant({
  network: "hedera:testnet",
  payTo: env.HEDERA_AUDIT_PAYTO_ACCOUNT_ID,
  priceTinybar: BigInt(env.AUDIT_PRICE_TINYBAR),
  facilitator: new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL, timeoutMs: 120_000 }),
  mirror: createMirrorClient(env.HEDERA_MIRROR_NODE_URL),
  store: new MerchantStore(resolve(REPO_ROOT, env.MERCHANT_DB_PATH)),
  auditor: createScannerAuditor({ github }),
  github,
  repoAllowlist: allowlist,
  publicBaseUrl,
  log: (event, data) => console.log(JSON.stringify({ event, ...data })),
});

serve({ fetch: merchant.app.fetch, port: env.MERCHANT_PORT, hostname: env.MERCHANT_HOST });
console.log(JSON.stringify({ event: "merchant.listening", publicBaseUrl, feePayer: merchant.capability.feePayer, allowlist }));
