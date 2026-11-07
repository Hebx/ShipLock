# App foundation + GitHub PR analysis — evidence (Cursor, `cursor/product-gate`)

Proof status labels follow `docs/evidence/README.md`.

## 1. Foundation tests — **local integration / mock fixture**

```text
pnpm install
pnpm typecheck        # 6 projects, TypeScript 7.0.2, 0 errors
pnpm test             # 49 tests, 0 failures
pnpm build:web        # Next.js 16.4.5 production build OK
```

| Package | Tests | Covers |
|---|---|---|
| `packages/shared` | 10 | canonical JSON (float/NaN/bigint rejection), SHA/tinybar/tx-id schemas, state machine (no skipping paid review or approval, terminal states, no retry from `reconcile_required`) |
| `packages/scanner` | 9 | diff parser line numbers, quoted-path files not dropped, secret/eval/CI/dependency/binary rules, secret redaction, determinism, new head SHA ⇒ new digest, oversized/binary ⇒ inconclusive |
| `packages/github` | 6 | allowlist enforced before network, base-repo mismatch, malformed SHAs, compare diff byte cap, error bodies not echoed |
| `packages/policy` | 10 | paid result: wrong price, merchant, asset, spend cap, unsettled, payer = merchant, stale report, tampered report, wrong job/PR/SHA, simulated evidence refused, malformed payload; operation hash binds every field |
| `apps/api` | 14 | migrations, state CHECK = shared states, bearer auth, allowlist 403, SHA binding, re-sync reuses job, **new commit ⇒ new job + old job `stale` + authorization `invalidated`**, analysis refused when head moved, closed/merged PR ⇒ `invalid`, one open authorization per job, one Hedera tx per job, one merge attempt per authorization |

GitHub is replaced by an in-memory double in the API tests. These are unit tests, not live evidence.

## 2. Live GitHub read smoke — **live (read-only), NOT M2 evidence**

The disposable demo repository does not exist yet, so the live path was exercised read-only against a public upstream PR using a temporary allowlist and a throwaway database (`/tmp`). No token was used and nothing was written to GitHub.

```text
GITHUB_DEMO_REPO=x402-foundation/x402 DATABASE_URL=file:/tmp/shiplock-smoke/smoke.sqlite \
  pnpm analyze 'x402-foundation/x402#4030'
```

| Field | Value |
|---|---|
| Repository / id | `x402-foundation/x402` / `936374955` |
| PR | https://github.com/x402-foundation/x402/pull/4030 |
| Head SHA | `2074b8c03eb1a40df6f937e70a32288abb719bcc` |
| Base SHA | `a17c668ac3fd1dd98cc74c4f2914dc0575870dca` |
| Scanner | `shiplock-deterministic/0.1.0` |
| Diff SHA-256 | `029e6ad09dcf7fd78921b47d1107c456209a771c6259b48852bc58fc1194a640` |
| Report SHA-256 | `2d50a115a89da225905e2a5c9f5cae01dc1b1110fbd24a342d24e6a1cc514092` |
| Stats | 97 files, +15263 / −554 — matches GitHub's `changed_files`/`additions`/`deletions` exactly |
| Conclusion | no blocking findings (heuristic); 6 × `SL-SENS-PATH` (medium), 1 × `SL-SENS-EXECUTABLE` (low) |

Analyzed at 2026-11-07T00:43Z. The PR head may have moved since; the digest is bound to the SHA above.

## 3. Not yet evidenced

- **M2 exit** needs the disposable `Hebx/shiplock-demo-target` repo: analyze a real PR, push a new commit, show the new job/digest and the old job `stale`.
- No x402 payment, World Agent Pass or merge has been executed. The UI shows "No evidence yet" for those sections.
