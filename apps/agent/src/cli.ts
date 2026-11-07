/**
 * Autonomous coding agent's review purchase:
 *   pnpm --filter @shiplock/agent review owner/repo#123
 * Asks ShipLock to bind a job to the PR's current head, buys the x402 review within the spend cap
 * and submits it to ShipLock. Prints the outcome; the payer key never leaves this process.
 */
import { resolve } from "node:path";
import { PullRefSchema } from "@shiplock/shared";
import { ADAPTER_ID, createMirrorClient, createReviewPurchaser, resolveHederaCapability } from "@shiplock/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { z } from "zod";
import { loadRepoEnv, REPO_ROOT } from "./env.ts";
import { AgentLedger } from "./ledger.ts";
import { createShipLockClient, runReview } from "./run.ts";

const match = /^([^#]+)#(\d+)$/.exec(process.argv[2] ?? "");
if (!match) {
  console.error("usage: pnpm --filter @shiplock/agent review owner/repo#123");
  process.exit(2);
}
const ref = PullRefSchema.parse({ repository: match[1], pullNumber: Number(match[2]) });

loadRepoEnv();
const env = z
  .object({
    SHIPLOCK_API_ORIGIN: z.url().default("http://127.0.0.1:4000"),
    SHIPLOCK_AGENT_TOKEN: z.string().min(32),
    SHIPLOCK_AUDIT_URL: z.url().default("http://127.0.0.1:4402"),
    HEDERA_AGENT_ACCOUNT_ID: z.string(),
    HEDERA_AGENT_PRIVATE_KEY: z.string(),
    HEDERA_AUDIT_PAYTO_ACCOUNT_ID: z.string(),
    HEDERA_MIRROR_NODE_URL: z.url(),
    X402_FACILITATOR_URL: z.url(),
    AGENT_MAX_PAYMENT_TINYBAR: z.string().regex(/^[1-9][0-9]{0,18}$/),
    AGENT_LEDGER_PATH: z.string().default("data/agent-ledger.sqlite"),
  })
  .parse(process.env);

const capability = await resolveHederaCapability(new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL, timeoutMs: 120_000 }), "hedera:testnet");
const mirror = createMirrorClient(env.HEDERA_MIRROR_NODE_URL);

const outcome = await runReview(
  {
    shiplock: createShipLockClient(env.SHIPLOCK_API_ORIGIN, env.SHIPLOCK_AGENT_TOKEN),
    ledger: new AgentLedger(resolve(REPO_ROOT, env.AGENT_LEDGER_PATH)),
    purchaser: (onSigned) =>
      createReviewPurchaser({
        network: "hedera:testnet",
        payerAccountId: env.HEDERA_AGENT_ACCOUNT_ID,
        payerPrivateKey: env.HEDERA_AGENT_PRIVATE_KEY,
        allowedPayTo: [env.HEDERA_AUDIT_PAYTO_ACCOUNT_ID],
        expectedFeePayer: capability.feePayer,
        globalMaxTinybar: BigInt(env.AGENT_MAX_PAYMENT_TINYBAR),
        mirror,
        onSigned,
      }),
    adapterId: ADAPTER_ID,
    auditBaseUrl: env.SHIPLOCK_AUDIT_URL,
    maxTinybar: env.AGENT_MAX_PAYMENT_TINYBAR,
  },
  ref,
);

console.log(JSON.stringify({ evidenceKind: "live", ...outcome }, null, 2));
process.exit(outcome.kind === "accepted" ? 0 : 1);
