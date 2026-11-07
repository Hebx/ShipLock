# Demo repo protection: `Hebx/shiplock-demo-target` (live, 2026-11-07)

Approved by the repo owner; applied by Hermes. Raw ruleset: [`demo-target-ruleset.json`](demo-target-ruleset.json).

## What is configured

Ruleset `shiplock-main` (id `26739663`), **enforcement `active`**, target = default branch (`main`), **bypass actors: none**.

| Rule | Effect |
|---|---|
| `pull_request` (0 approvals, dismiss stale reviews on push) | No direct pushes to `main`; every change goes through a PR |
| `required_status_checks`: `typecheck` from GitHub Actions (integration id 15368) | GitHub refuses to merge unless the head commit has a passing `typecheck` from Actions (other apps can't spoof it) |
| `non_fast_forward` | No force-push to `main` |
| `deletion` | `main` cannot be deleted |

The check comes from `.github/workflows/ci.yml` (merged via demo PR #3 → `main` `922bb60`): `tsc --noEmit`, actions pinned by commit SHA, `contents: read`, `persist-credentials: false`.

## Verified live

| Probe | Result |
|---|---|
| `git push origin main` (direct commit) | rejected: `GH013: Repository rule violations found for refs/heads/main` |
| `PUT /pulls/1/merge` with correct `sha`, PR #1 head has no `typecheck` run | rejected `405`: `Required status check "typecheck" is expected.`; PR stays open, not merged |
| `GET /rules/branches/main` | `["deletion","non_fast_forward","pull_request","required_status_checks"]` (ShipLock's `getBranchRules` reads this) |
| PR #3 `typecheck` | pass (Actions run 42325184522) |

## What this does and does not prove

- It does prove that GitHub itself, independent of ShipLock, blocks direct pushes, force-pushes and merges without a passing `typecheck`, for every actor including admins, because there are no bypass actors.
- It does not mean only ShipLock can merge. Any collaborator with write access can still merge a PR through the GitHub UI or API once `typecheck` passes (0 required approvals). ShipLock's World ID approval is enforced only on merges that go through ShipLock.
- Making ShipLock the only merge path would need one of these:
  - a required approving review from a ShipLock-only account, or
  - a required status check that only ShipLock's GitHub App can post (e.g. `shiplock/human-approval`, pinned by `integration_id`), set after World approval.

  Neither is configured. Treat it as a follow-up, not a current claim.
- A repo admin can edit or delete the ruleset. Rulesets constrain merges, not repo administration.

## Impact on the demo PRs

Demo PRs #1 and #2 were opened before the workflow existed. Their heads (`d0cbdfd3…`, `67969975…`) have no `typecheck` run, so GitHub blocks merging them (`mergeable_state: blocked`). To demo:
- **Success:** update `demo/clean-change` with `main` (merge or rebase). This produces a **new head SHA**, so ShipLock must re-review and re-pay for that SHA, and CI runs on it.
- **Required-check failure:** push a commit with a type error to a demo branch; `typecheck` fails and both GitHub and ShipLock (`checks_not_green`) block.

## Product repo: `Hebx/ShipLock` default branch (live, re-checked 2026-11-07)

Ruleset `shiplock-main` (id `26742382`), **active**, **no bypass actors**. Target: `~DEFAULT_BRANCH`. It moved with the
rename from `cursor/integration`, so it now protects **`release/v0.1`**.

| Rule | Effect |
|---|---|
| `pull_request` (0 approvals) | No direct pushes to `release/v0.1` |
| `required_status_checks`: `verify` from GitHub Actions (`integration_id` 15368) | `.github/workflows/ci.yml` (typecheck + all tests) must pass on the PR head |
| `non_fast_forward`, `deletion` | No force-push or deletion of `release/v0.1` |

Raw: [`shiplock-ruleset.json`](shiplock-ruleset.json). `GET /repos/Hebx/ShipLock/rules/branches/release%2Fv0.1` →
`deletion, non_fast_forward, pull_request, required_status_checks:verify`. When the ruleset was created (default
branch was `main`) a direct push to `main` was rejected with `GH013`.

**`main` is not protected now** (`GET /rules/branches/main` → `[]`). It is the pre-release seed branch. If it must stay
frozen, add `refs/heads/main` to the ruleset's `include` list (owner decision; not done).
