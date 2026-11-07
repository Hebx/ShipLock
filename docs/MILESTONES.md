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

## M3 — World ID (IDKit) proof of human + exact-SHA approval

Policy: **Proof of Human, with a fresh user-presence check where supported.** A proof establishes humanness only; the maintainer must also be GitHub-authenticated with live repository write permission and explicitly approve the exact SHA.

- [ ] World Developer Portal app registered (`app_id`, `rp_id`, server-only RP signing key); enrollment action created in staging (simulator) and production (real World App).
- [ ] GitHub OAuth sign-in with single-use browser-bound state; server sessions with CSRF.
- [ ] Enrollment: `IDKitRequestWidget` with `proof_of_human`, `session_id: "create"`, server-signed `rp_context`, server-generated signal; server verifies with World `/api/v4/verify/{rp_id}` and binds one World ID + World session to one GitHub account.
- [ ] Approval: `IDKitSessionWidget` on the enrolled session, signal = operation hash; server verifies with World, checks nonce/session/signal/presence/environment, rejects replayed session nullifiers; one-use with expiry.
- [ ] Cancel (`user_rejected`), deny, expired and wrong-session/identity paths blocked, showing the protected merge did not occur.
- **Exit:** `docs/evidence/world/` with sanitized World verify responses for a successful enrollment + approval and at least one cancelled/rejected approval, plus the integration debrief. Simulator (staging) proofs must be labeled as development proofs, not real human verification. Unit tests with stubbed World verify do not count.

## M4 — Exact-SHA merge gate

- [ ] Server checks repo allowlist, approver authority, CI status, report, exact SHA, expiry and one-use approval.
- [ ] Before merge, re-fetch PR SHA and invoke GitHub REST merge endpoint with `sha`.
- [ ] Approved SHA merges; changed SHA, failed CI or unknown permission cannot merge. No production repo access.
- **Exit:** merged disposable PR URL and blocked attempt URL/log; repeated merge prevented.

## M5 — Evidence and presentation

- [ ] `README` setup reproducible; tests cover payment, World ID proof, session, report and merge failure paths.
- [ ] `docs/evidence/` separates real, staged, and simulated outcomes.
- [ ] Submission has real x402 transaction, server-verified World ID flow, failed path, GitHub PR URL and source links.
- [ ] Integrations debrief: time to first success, friction, missing documentation/capability, biggest improvement.
- **Exit:** recorded end-to-end demo and source checklist.

## M6 — Optional after core is verified

- [ ] HCS hash-only receipts.
- [ ] GitHub required status check for repo-wide enforcement (app merge button alone can be bypassed by other permitted actors).
- [ ] Multiple audit vendors + signed manifests + deployment/package publication gateways.
