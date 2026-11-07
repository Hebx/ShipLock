# Hermes handoff: ShipLock

Use `AGENTS.md` as the canonical contract. This file does not assume a particular Hermes plugin API or CLI command.

**Initial assignment:** M0 research and M1 payment spike. Fetch actual source at the commits and files listed in `docs/RESEARCH_SOURCES.md`; inspect licenses, installed SDK exports, live testnet capabilities and payment-facilitator behavior. Write `docs/RESEARCH_NOTES.md`. Implement client/server payment only after selecting a verified SDK combination.

**Do not** replace or quietly downgrade payment checks with a fake facilitator. Show a live transaction and its paid response for M1. Store an evidence summary excluding keys and private payment payload secrets.

**When handing off to Cursor:** supply commit SHA, branch name, changed paths, exact exports, request/response schema, environmental requirements, test commands, unresolved risks and relevant screenshots/HashScan links. Use the log format in `docs/COORDINATION.md`.

**Second assignment:** adversarial review of World/GitHub merge authorization. Look for changed SHA, wrong identity, replay, approval expiry, server restarts, status-check failures and authority bypasses. Do not sign off without negative-path evidence.
