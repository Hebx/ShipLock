# Build milestones — proof gates, not time estimates

See `docs/IMPLEMENTATION_BRIEF.md` for detailed requirements. Never mark a milestone complete without independently verifiable artifacts.

## M0 — Current implementation research

- [ ] Inspect official `@x402/*` Hedera mechanism, published package exports and exact version matrix.
- [ ] Compare live winner source in Carpool, AutoVoyage and Turnstile, plus Hedera reference and Hedron security learnings.
- [ ] Confirm testnet facilitator `/supported`: `hedera:testnet`, exact scheme, HBAR availability and fee-payer semantics.
- [ ] Check licensing and avoid copying incompatible fragments.
- **Exit:** `docs/RESEARCH_NOTES.md` completed with commit hashes, exact file paths, source URLs, version pinning, confirmed vs uncertain behavior and chosen architecture.

## M1 — Autonomous paid review API

- [ ] Live `GET /api/audits/:id` returns x402 v2 HTTP 402 unpaid.
- [ ] Agent verifies price/chain/payee within cap; signs and retries without human approval.
- [ ] Supported facilitator verifies/settles a REAL Hedera testnet HBAR transfer.
- [ ] Server delivers a consistent paid response with real transaction ID, durable fulfillment record and replay handling.
- **Exit:** `docs/evidence/M1.md` contains scrubbed HTTP flow, actual HashScan URL, account roles, versions and failure cases.

## M2 — SHA-bound audit

- [ ] Fetch exact PR head SHA/diff in **disposable GitHub demo repo**.
- [ ] Analyze deterministic rules for secrets, shell injection patterns, sensitive payment changes etc. with file/line evidence; clearly limit claims.
- [ ] Bind report hash, rules version, repo, PR and SHA; payment fulfillment idempotent.
- **Exit:** real repo PR and report links, test with a changed source SHA.

## M3 — Official World Agent Pass

- [ ] App registered; OIDC authorization-code + PKCE + state + nonce working.
- [ ] Backend validates signature, `iss`, `aud`, `nonce`, expiry, `(iss,sub)`, `acr`, `amr`, `auth_time`, session and requirement.
- [ ] `max_age=0` fresh step-up for exact action; explicit separate approval, one-use with expiry.
- [ ] Cancel/deny/expired/wrong identity blocked, showing protected action did not occur.
- **Exit:** `docs/evidence/M3.md` with sanitized traces and debrief. Event fake identities must be labeled *test*.

## M4 — Exact-SHA merge gate

- [ ] Server checks repo allowlist, approver authority, CI status, report, exact SHA, expiry and one-use approval.
- [ ] Before merge, re-fetch PR SHA and invoke GitHub REST merge endpoint with `sha`.
- [ ] Approved SHA merges; changed SHA, failed CI or unknown permission cannot merge. No production repo access.
- **Exit:** merged disposable PR URL and blocked attempt URL/log; repeated merge prevented.

## M5 — Evidence and presentation

- [ ] `README` setup reproducible; tests cover payment, OIDC, report and merge failure paths.
- [ ] `docs/evidence/` separates real, staged, and simulated outcomes.
- [ ] Submission has real x402 transaction, World validated flow, failed path, GitHub PR URL and source links.
- [ ] Integrations debrief: time to first success, friction, missing documentation/capability, biggest improvement.
- **Exit:** recorded end-to-end demo and source checklist.

## M6 — Optional after core is verified

- [ ] HCS hash-only receipts.
- [ ] GitHub required status check for repo-wide enforcement (app merge button alone can be bypassed by other permitted actors).
- [ ] Multiple audit vendors + signed manifests + deployment/package publication gateways.
