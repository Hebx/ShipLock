# Launch ShipLock with Cursor + Hermes

**One repo, two agents, separate branches.** The repository initially contains documents, branding assets, typed API interfaces, prompts and pitch materials, **not working application code**.

## 1. Make the repository

Create an empty `Hebx/ShipLock` repository at https://github.com/new. Do not add a generated README or .gitignore, because this package includes both.

Unzip `ShipLock_GitHub_Starter.zip`, then in the extracted `ShipLock` directory:

```bash
git init -b main
git add .
git commit -m "chore: bootstrap ShipLock spec, brand, and dual-agent plan"
git remote add origin https://github.com/Hebx/ShipLock.git
git push -u origin main
```

Create a **separate disposable** `Hebx/shiplock-demo-target` repository to test the GitHub merge operation safely.

## 2. Run two agents concurrently

Both read `AGENTS.md` and `packages/shared/src/contracts.ts` first.

- **Hermes**, branch `hermes/hedera-x402`, prompt `prompts/HERMES_START.md`: investigate official SDK + latest Hedera x402 winner code, implement/pay/test live x402 only under `packages/x402/**` and agreed scripts.
- **Cursor**, branch `cursor/product-gate`, prompt `prompts/CURSOR_START.md`: own UI/API, deterministic scanner, GitHub integration, World Agent Pass OIDC, exact-SHA authorization.

Agents must not modify the same branch or each other's owned paths. Hermes is payment integration owner; Cursor is the final app integration owner. Use `docs/WORKSTREAMS.md` and `docs/COORDINATION.md` for handoffs.

**Do not start the agents against independent copies of the repo and later overwrite one with the other.** Either use separate clones/branches or proper Git worktrees. With worktrees:

```bash
git worktree add ../shiplock-hermes -b hermes/hedera-x402
git worktree add ../shiplock-cursor -b cursor/product-gate
```

Each agent opens its own workspace directory and produces a PR into `main`; Cursor integrates Hermes's payment PR through reviewed commits, not by copying untracked files.

## 3. Inputs only you can supply

- One funded **ECDSA** Hedera testnet account controlled by you as the agent payer; another **different** funded account ID as the audit merchant payee. Your third account is optional for HCS. See `docs/SETUP.md`.
- Hedera payer private key locally in `.env.local`, never into chats/prompts or the repository.
- A World **Agent Pass** client registration, exact redirect URI and development/test credentials stored privately.
- A fine-grained GitHub token or GitHub App installation **restricted to the disposable target repo**.
- Valid hosted facilitator advertising Hedera exact/HBAR on testnet; research and probe this before assuming it works.

## 4. Evidence gates, not fixed deadlines

Read `docs/MILESTONES.md`. A green mocked payment or `success:true` callback is not an accepted live integration. Each completed milestone has commands, transaction/explorer links or test records and redacted evidence under `docs/evidence/`.

**Completion definition:** an agent autonomously buys a real x402-protected review via Hedera testnet; a validated World Agent Pass human explicitly authorizes the exact reviewed commit; GitHub merges only that SHA; a changed SHA, cancelled attempt or failed checks blocks merge.
