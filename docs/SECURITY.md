# Security invariants and adversarial tests

- **Immutable reviewed bytes.** `owner/repo`, immutable repository ID, PR, head SHA, base ref and scanner/rules version specify the audited input. Never scan a mutable branch name and then claim to have reviewed a stored SHA.
- **Immutable quote.** The paid retry must use original issued x402 network/asset/amount/payee/expiry; client may not reprice. No floats for tinybars, no incorrect Hedera network or fee payer.
- **Real settlement.** Distinguish `/verify` from `/settle` and both from confirmed consensus. Protect replay/idempotency and avoid automatic double settlement on uncertain outcomes. A 200 from a stub is **not** payment proof.
- **World OIDC.** Validate state, nonce, PKCE and code redemption; ID-token signature via JWKS, issuer, audience, expiry, `auth_time`, `acr`, `amr`, `(iss,sub)` linked to initiating actor. Require appropriate assurance/freshness. Event fake identities are not real proof-of-personhood.
- **Authentication != permission.** Only explicit user approval of displayed repo, PR, head SHA, audit digest and operation hash grants a single merge attempt. Denied/cancelled/expired/changed operation = fail closed.
- **GitHub permission.** Repo allowlist; least-privilege credential restricted to disposable target; recheck current PR, SHA, CI and mergeability, use merge `sha` precondition; obey rulesets and required checks.
- **Single use / atomicity.** DB state transitions and unique constraints prevent double fulfillment and double approval. If network result uncertain, reconcile before attempting side effects again.
- **Secrets.** Hedera signing keys, GitHub tokens, World client secret, sessions and PKCE verifier stay server-side. No keys or identity tokens in logs, client JS, Git repo, HashScan memo, or HCS receipts.
- **Scanner limits.** For v1 report heuristic findings, no guarantee code is safe. For changed code after scan or auth, invalidate evidence and demand a new review.
- **Provider integrity.** Show scanner source and version; audit digest should be computed independently from retrieved bytes rather than trusting a provider-supplied header alone.

## Negative test matrix

| Attack or failure | Required result |
|---|---|
| wrong x402 amount, asset, payee, chain | payment rejected, no paid audit |
| expired/modified 402 requirements | reject quote or require new one |
| same receipt reused for another review | reject |
| facilitator returns ambiguous settlement | reconcile, never assume failed and repay |
| client sends World `success:true` | ignored as authorization |
| expired, cancelled, wrong World subject or low assurance | no merge grant |
| valid World auth but no explicit confirmation | no merge |
| World auth to a different user or session | no merge |
| approved SHA then force push | reject as stale, GitHub guard returns conflict |
| audit result says block / inconclusive | no authorized merge by default |
| same approval used twice | second use rejected |
| GitHub checks fail / permissions missing | no merge |
| attempt to merge non-allowlisted repo | reject at API boundary |
| other actor merges outside app | documented limitation; required check recommended |

After any failure, preserve an audit event with correlation ID but without personal identity, OAuth tokens, or private code contents.
