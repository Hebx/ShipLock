# Gate C (payment half) — autonomous agent buys a live x402 review through ShipLock

Branch `cursor/integration` (Cursor `cursor/product-gate` + Hermes PR #2 `hermes/x402-contract-v2`). All processes local on
the EC2 host: ShipLock API `127.0.0.1:4500`, audit merchant `127.0.0.1:4402` (`pnpm --filter @shiplock/agent merchant`),
agent `pnpm --filter @shiplock/agent review Hebx/shiplock-demo-target#N`. Hosted Blocky402 facilitator, `hedera:testnet`, HBAR.

Path per PR: agent → `POST /api/reviews` (ShipLock binds the job to the live head and computes its own diff and report
digests) → x402 `GET /audit` → 402 quote with `extra.shiplock` = job + diff digest → buyer signs within the 10 000 tinybar cap
(ledger entry written before send) → Blocky402 verify/settle → buyer mirror check → `POST /api/reviews/:jobId/paid-review`
→ ShipLock `verifyPaidReviewResult` + its own mirror-node lookup + live PR head re-read.

| Demo PR | Head | Transaction (mirror: SUCCESS, payer −1000, merchant +1000) | Paid report sha256 | ShipLock result |
|---|---|---|---|---|
| [#1](https://github.com/Hebx/shiplock-demo-target/pull/1) | `d0cbdfd3…` | [`0.0.7162784@1794015688.593589740`](https://hashscan.io/testnet/transaction/0.0.7162784-1794015688-593589740) | `ca41051e…a56fc` = ShipLock's own | `paid_review_confirmed` (live, ledger verified) |
| [#2](https://github.com/Hebx/shiplock-demo-target/pull/2) | `67969975…` | [`0.0.7162784@1794015765.601324030`](https://hashscan.io/testnet/transaction/0.0.7162784-1794015765-601324030) | `049efd74…6518a` = ShipLock's own | `review_blocked` (1 critical, 3 high, 2 medium) |

Payer `0.0.7304745`, merchant `0.0.9050506`, fee payer `0.0.7162784` (Blocky402). The paid digests equal ShipLock's
independent M2 digests ([M2](../github/M2.md)).

## New commit after review: old paid review retired, new head paid separately

Hermes's ruleset ([REPO_PROTECTION](../github/REPO_PROTECTION.md)) requires a passing `typecheck`, which the original PR #1
head lacked. `PUT /pulls/1/update-branch` with `expected_head_sha=d0cbdfd3…` moved the head to
`953ab250afc264a1cc26db6dba62ca7f6735a7ed` (base `922bb609…`); `typecheck` passed and `mergeable_state` became `clean`.

The next agent run made ShipLock re-read the PR: job `job_86332ff0…` (head `d0cbdfd3…`, paid with
`0.0.7162784@1794015688.593589740`) went to `stale` ("head moved to 953ab250…") and its paid review no longer counts. A new
job `job_e5aee42d…` was bound to `953ab250…` and paid with
[`0.0.7162784@1794016014.583132223`](https://hashscan.io/testnet/transaction/0.0.7162784-1794016014-583132223)
(mirror: SUCCESS, payer −1000, merchant +1000). Paid report `5ae673b8…2e68` equals ShipLock's own. The diff digest is
unchanged (`e6ec27c0…`) because only the base moved; the report digest differs because it binds head and base.

## Failure found and fixed during the run

The first submission for PR #1 was refused with `400 invalid_request`: ShipLock's `adapterId` pattern did not allow `/`, and
Hermes's adapter id is `hermes-x402-hedera/2.30.0`. The agent had also classed every 4xx as a final rejection. Fixes:
the API accepts `/` and `@` in adapter ids (the test harness now uses the real id), and the agent treats only `409`/`422`
as ShipLock's verdict; other failures keep the paid result for resubmission. The ledger entry for that job was reset from
`rejected` to `paid` by hand (its stored result untouched), and the rerun resubmitted the same result. No second payment.

## Not shown here

World IDKit approval and the GitHub merge (M3/M4) are not part of this run. The merchant is not publicly hosted.
