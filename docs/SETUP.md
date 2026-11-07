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

## World ID Agent Pass (official)

- Developer portal: https://auth.world.org/portal — event/development client registration.
- Register exact HTTPS redirect URI (local callback via tunneling or hosted application).
- Obtain `WORLD_CLIENT_ID` and, if applicable, `WORLD_CLIENT_SECRET`; **do not commit or share them**.
- Implement OIDC authorization-code with PKCE, `state`, `nonce`, and server-side token verification.
- For merge step-up request fresh authentication using `max_age=0`; validate the World-issued result and the stored operation identity, then ask for explicit approval. See https://auth.world.org/docs/guides/step-up .
- Event mock identities may be permitted, but label them as fake/test: a fake identity does **not** establish independent real human uniqueness.

## GitHub

- Create the product source repository `ShipLock` on your `Hebx` GitHub account (or choose `Glorian-Labs` if preferred).
- Create a **separate disposable** `shiplock-demo-target` repo for the merge demonstration.
- Initially use a fine-grained token or GitHub App with contents read/write and pull-requests read/write, **only** for demo target. Read checks/status information as needed; do not grant administrator/bypass authority.
- Do not install the merge bot on Hedron, any production repo, or all repositories. Configure target owner/repo allowlist.
- Set demo branch protection consciously; M4 must not silently bypass CI or branch rules.

## Miscellaneous

- Node 20+ and a package manager; verify package exports installed locally, pin compatible current exact versions.
- Persistent DB (SQLite locally is fine for MVP); session secret; public HTTPS callback; deployment provider if needed.
- Optional LLM key for summaries; deterministic scanner must function without LLM.
- No paid x402 network token required for native HBAR testnet route; use real testnet HBAR.

## `.env.example`

See root `.env.example` for **placeholders only**. Copy to `.env.local`; never commit secrets. On deployment use provider-managed encrypted secret storage, protect logs and avoid leaking OAuth tokens to browser or CI.

## Before demo

Verify the agent is authorized for the disposable repository, API keys are scoped, World OIDC callback works via HTTPS, direct paid audit returns real settlement, approvals expire/are consumed, GitHub merge checks exact SHA. Keep both successful and failure case evidence under `docs/evidence/`.
