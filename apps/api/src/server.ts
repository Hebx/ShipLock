import { serve } from "@hono/node-server";
import { createGitHubClient } from "@shiplock/github";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const github = createGitHubClient({ token: config.githubToken, allowlist: config.allowlist });
const app = createApp({ db, github, agentToken: config.agentToken, config });

serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`ShipLock API on http://127.0.0.1:${info.port} (allowlist: ${config.allowlist.join(", ")})`);
  console.log(
    `GitHub OAuth: ${config.githubOAuth ? "configured" : "not configured"} | World ID: ${
      config.world ? `${config.world.environment}${config.world.environment === "staging" ? " (simulator, not real human verification)" : ""}` : "not configured"
    } | paid reviews: ${config.paidReview ? `accepting ${config.paidReview.acceptedEvidence.join(",")}` : "not configured"}`,
  );
});
