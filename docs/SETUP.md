# Accounts, credentials and setup

## Hedera: you can reuse funded Hedron testnet accounts

You have indicated **three funded Hedera testnet addresses**. We do **not** know their actual IDs or whether each is ECDSA, still funded, or key-controlled. Do not paste private keys into chat or GitHub. If a reused key was previously leaked, rotate it or generate a new testnet ECDSA key.

| Role | Env variable | Key necessary? | Can reuse? |
|---|---|---|---|
| A. **Agent / x402 buyer** | `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | **Yes; ECDSA** | Yes, the prior Hedron ECDSA payer if owned/funded |
| B. **Review API merchant / payee** | `HEDERA_AUDIT_PAYTO_ACCOUNT_ID` | **No** for receiving HBAR | Yes; separate from payer |
| C. **HCS operator** *(optional)* | `HEDERA_HCS_OPERATOR_ACCOUNT_ID`, `HEDERA_HCS_OPERATOR_PRIVATE_KEY`, `HEDERA_HCS_TOPIC_ID` | Yes if posting messages | Reuse third testnet account; postpone until M6 |

A hosted facilitator (e.g. Blocky402 testnet, **only if currently advertising supported Hedera exact/HBAR**) provides its own fee payer; your three accounts do not have to run a facilitator. **Do not hardcode fee payer**; query its `/supported` capability response. The *address only* is safe to provide to coding agents; keys remain in local `.env` or a secrets manager.

**Check now:** identify each `0.0.x` account, its key type (ECDSA vs ED25519), HBAR balance on [HashScan testnet](https://hashscan.io/testnet), and which account will act as payer/payee. The current reference signer uses ECDSA. If all are ED25519, create/fund an ECDSA testnet account. For basic native HBAR payments, no HTS USDC association is needed. Testnet HBAR is not redeemable money.

**M1 payment prerequisites:** selected facilitator URL (default trial `https://api.testnet.blocky402.com`), testnet mirror node, x402 compatible SDK versions, 1 funded ECDSA payer, different payee, server API.

## World ID (IDKit 4.x)

Policy: **Proof of Human, with a fresh user-presence check where supported.** Docs: https://docs.world.org/world-id/idkit/integrate.

1. In the World **Developer Portal** (https://developer.world.org; the prize page links https://developer.worldcoin.org), create the app and enable World ID 4.0. Keep:
   - `app_id` → `WORLD_APP_ID` (public)
   - `rp_id` → `WORLD_RP_ID` (public)
   - `signing_key` → `WORLD_RP_SIGNING_KEY` (**secret**, server only; never `NEXT_PUBLIC_*`, never in chat, logs or commits)
2. Create the enrollment action (e.g. `shiplock-maintainer-enroll`) → `WORLD_ENROLL_ACTION`. Approvals use session proofs, which carry no action.
3. **Staging (simulator):** set `WORLD_ENVIRONMENT=staging` and create the action in the staging environment. Staging proofs come only from the World ID Simulator (https://simulator.worldcoin.org/id/0x18310f83). They are **development proofs, not real human verification**; the UI and evidence must say so.
4. **Production (real World App on a phone):** set `WORLD_ENVIRONMENT=production` and create the action in production. `WORLD_REQUIRE_USER_PRESENCE` must stay `true` in production (the server refuses to start otherwise).
5. Verification always goes to `POST {WORLD_VERIFY_BASE_URL}/api/v4/verify/{rp_id}` (default `https://developer.world.org`). There is no local fallback: if World is unreachable the proof is rejected.

Open questions to confirm on the first simulator run (see `docs/evidence/world/README.md`): whether the simulator supports the user-presence check, and whether staging verification is served by the default host.

## GitHub

- Create the product source repository `ShipLock` on your `Hebx` GitHub account (or choose `Glorian-Labs` if preferred).
- Create a **separate disposable** `shiplock-demo-target` repo for the merge demonstration.
- Do not install the merge credential on Hedron, any production repo, or all repositories. Configure the target owner/repo allowlist (`GITHUB_DEMO_REPO`).

**Maintainer sign-in — GitHub OAuth App** (Settings → Developer settings → OAuth Apps):

- Homepage URL: `APP_URL` (e.g. `http://localhost:3000`); Authorization callback URL: `${APP_URL}/api/auth/github/callback`.
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` (secret). ShipLock requests no scopes: the token is used once to read the user's id/login and discarded. Authority to merge comes from the live repository permission check (`SHIPLOCK_MIN_GITHUB_PERMISSION`, default `write`).

**Merge credential — fine-grained personal access token**, repository access **only** `shiplock-demo-target` → `GITHUB_FINE_GRAINED_TOKEN`:

- Contents: read and write (merge)
- Pull requests: read and write
- Checks: read
- Commit statuses: read
- Metadata: read (mandatory; also covers collaborator permission and branch rules reads)

No administration or bypass permissions.

**Required status checks / rulesets:** add a ruleset (or branch protection) on the demo repo's default branch that requires your CI check. ShipLock reads required status checks from the branch rules and refuses to merge when any is missing or not green, but GitHub enforcement is what stops other actors from bypassing ShipLock — keep the bypass list empty for the demo.

## Miscellaneous

- Node 20+ and a package manager; verify package exports installed locally, pin compatible current exact versions.
- Persistent DB (SQLite locally is fine for MVP); `APP_URL` must be the exact browser origin (CSRF/Origin checks and cookie `Secure` flag derive from it); deployment provider if needed.
- Optional LLM key for summaries; deterministic scanner must function without LLM.
- No paid x402 network token required for native HBAR testnet route; use real testnet HBAR.

## `.env.example`

See root `.env.example` for **placeholders only**. Copy to `.env.local`; never commit secrets. On deployment use provider-managed encrypted secret storage, protect logs and avoid leaking OAuth tokens to browser or CI.

## Before demo

Verify the agent is authorized for the disposable repository, API keys are scoped, GitHub sign-in and World enrollment work, World verify returns the expected environment, direct paid audit returns real settlement, approvals expire/are consumed, GitHub merge checks exact SHA. Keep both successful and failure case evidence under `docs/evidence/` (World runbook: `docs/evidence/world/README.md`).
