# Live World approval, cancellation and SHA-guarded merge — demo PR #1

The owner ran this on the live app (`https://shiplock-gamma.vercel.app`, API commit `aa5b8c1` on `cursor/integration`) with a **production** World ID identity (real World App, not the simulator). Values below come from the ShipLock database (read-only queries) and the GitHub API. No secrets, proofs or nullifiers are recorded here.

## Inputs

| Item | Value |
|---|---|
| Repository | `Hebx/shiplock-demo-target` (id `1448904918`), PR [#1](https://github.com/Hebx/shiplock-demo-target/pull/1), base `main` |
| Reviewed head SHA | `953ab250afc264a1cc26db6dba62ca7f6735a7ed` |
| Review job | `job_e5aee42d2079406cbae54dd48bc4ee3a`, scanner `shiplock-deterministic/0.1.0`, local conclusion `pass`, diff sha256 `e6ec27c0…0023c` |
| Paid review | live, tx `0.0.7162784@1794016014.583132223`, payer `0.0.7304745` → merchant `0.0.9050506`, 1000 tinybar, report sha256 `5ae673b8…f432e68` ([Gate C](gate-c-payment.md)) |
| Maintainer | GitHub `Hebx` (user id `33012322`), World enrollment `wen_26bdb4331d234bc29eb9094c6e1f8214`, environment `production` ([enrollment](../world/production-enrollment.md)) |

## Negative path: cancelled approval, no merge

| Time (UTC) | Event |
|---|---|
| 03:00:26.709 | `authorization.created` — `auth_9d7220d67c3a43228d439783baf7b264` (operation hash `c75d12d9…`) |
| 03:00:33.344 | `authorization.cancelled` — reason `world_cancelled:closed`; World proof request status `cancelled` |

No merge attempt references this authorization, so the cancelled approval never reached GitHub.

## Positive path: approval, then a merge of exactly the reviewed SHA

| Time (UTC) | Event |
|---|---|
| 03:01:53.022 | `authorization.created` — `auth_f0c3bcef83b4430c8c6ef5b37f61af5c` |
| 03:02:28.239 | `authorization.approved` — World production proof verified server-side, signal = operation hash `07e167071f06874e1291e0535856fb631ff47b87cee6ad8c5c30fb00f9c2b0fc` |
| 03:02:32.855 | `merge.started` — attempt `ma_f807c40b04f44dcd81484bb14bc86b77`, `expectedSha` `953ab250…`, `developmentEvidence: false`; authorization `consumed` |
| 03:02:37.465 | `merge.merged` — GitHub HTTP 200, merge commit [`5132381c`](https://github.com/Hebx/shiplock-demo-target/commit/5132381cd54db4a2c392014f75d02cd1a42bef74) |

The approved operation (`shiplock.merge-operation/v2`) binds: repository id and name, PR 1, head SHA `953ab250…`, base `main`, report sha256 `5ae673b8…`, scanner version, paid evidence kind `live`, merge method `squash`, approver GitHub id and login, World environment `production`, rp_id `rp_b1102dd124d31265`, nonce, and expiry `03:11:53.021Z`.

GitHub reports PR #1 `MERGED` at `2026-11-07T03:02:36Z`. Its head is `953ab250…`, the same SHA that was reviewed, paid for and approved. The squash commit `5132381c` has a single parent, `922bb609` (the previous `main`). The demo repository has an active `shiplock-main` ruleset.

## Not covered here

- Changed-SHA rejection (a new commit pushed after approval), expired or reused approval, failing required check, repeated merge, and non-maintainer attempts are not yet run live. Unit tests cover them (`apps/api/test/merge.test.ts`).
- Hermes has not yet re-reviewed the Gate D fixes (`ce01ba7`) or the credential widening (`3210ad3`, `aa5b8c1`).
