# Research: Turnstile, hedera-dev x402 PoC, Hedron PR #11/#12

Date: 2026-11-07. Method: shallow clones in `~/.hermes/profiles/dev/cache/scratch/research2/`, code read only (nothing run that needs keys). Mirror-node and `/supported` checks run with curl. Package versions read from `package.json` and `package-lock.json`. Published tarballs pulled with `npm pack`.

## npm baseline (checked 2026-11-07)

- `@x402/hedera`, `@x402/core`, `@x402/fetch` latest = **2.30.0** (published 2026-11-04). Previous: 2.29.0 (10-28), 2.28.0 (09-29).
- `@x402/hedera@2.30.0` deps: `@x402/core ~2.30.0`, `@hiero-ledger/sdk 2.90.1`, `@hiero-ledger/proto 2.32.0`. Versions 2.18.0 and 2.25.0 pinned sdk `2.85.0` / proto `2.31.0`.
- Subpath exports haven't changed between 2.18 and 2.30: `.`, `./exact/client`, `./exact/server`, `./exact/facilitator`. Root still exports `createClientHederaSigner`, `ExactHederaScheme`, `toFacilitatorHederaSigner`, and so on. 2.25+ adds `DEFAULT_ASSETS` / `getDefaultAsset` / `findDefaultAsset`. `@x402/core@2.30.0` exports `./client ./facilitator ./http ./schemas ./server ./types ./types/v1 ./utils`.
- The reference client in 2.30.0 freezes with `tx.freezeWith(client)` and then `tx.sign(key)` (`dist/esm/index.mjs:167-171`). That matches Hedron's fix.

## Live facilitators (`GET /supported`, 2026-11-07)

| Host | Hedera kind |
|---|---|
| `https://api.testnet.blocky402.com` | `hedera:testnet`, feePayer `0.0.7162784` |
| `https://x402.org/facilitator` | `hedera:testnet`, feePayer `0.0.9185802` |
| `https://api.blocky402.com` | per Hedron docs: `hedera:mainnet`, feePayer `0.0.10571514`, API key required (**not re-checked today**) |

The two testnet facilitators use different fee payers. Read `extra.feePayer` from `/supported` at challenge time. Never hardcode it.

---

## 1. Turnstile (github.com/IpastorSan/turnstile)

- HEAD `8f6249a84107698028d095da6d8f55a52a2b76a8` (2026-11-04).
- License: **MIT, declared in `package.json` only** (`package.json:6`, also in `uniswap-mcp` and `seller/cre/analyst-verdict`). There is no LICENSE file in the repo.
- Versions, all resolved in the root `package-lock.json`:

  | Package | Declared | Resolved |
  |---|---|---|
  | `@x402/core` | `^2.25.0` | 2.25.0 |
  | `@x402/fetch` | `^2.25.0` | 2.25.0 |
  | `@x402/hedera` | `^2.25.0` | 2.25.0 |
  | `@x402/evm` | `^2.25.0` | 2.25.0 |
  | `@hiero-ledger/sdk` | `2.85.0` (exact pin) | 2.85.0 |

  `mcp-turnstile/package.json` uses the same pins. There is no `@hashgraph/sdk`. Turnstile is 5 minors behind latest.
- Facilitator: Blocky402 testnet, `FACILITATOR_URL = 'https://api.testnet.blocky402.com'` (`rails/hedera-x402/config.ts:23`). Network is `hedera:testnet`. The asset is native HBAR `0.0.0`, priced from the live mirror-node exchange rate. There is also a second rail on Arc/Circle Gateway (EVM USDC, EIP-3009).

### Live settlement evidence

`docs/EVIDENCE.md:68-69,74` and `rails/hedera-x402/README.md:12` list:

- `0.0.7162784@1788791855.758948636`
- `0.0.7162784@1788800327.098234984`
- HCS receipt topic `0.0.10408013`

The mirror node confirms all three (curl run today):

- `0.0.7162784-1788791855-758948636`: `CRYPTOTRANSFER`, `SUCCESS`, consensus `1788791864.361892104`. `0.0.10408012` sent −84,367,844 tinybar to `0.0.10403961` (+84,367,844). Fee payer `0.0.7162784` paid −241,050, credited to node `0.0.802`. The buyer paid no fee, and the amounts match EVIDENCE.md.
- `0.0.7162784-1788800327-098234984`: `SUCCESS`, 84,770,051 tinybar, same accounts.
- Topic `0.0.10408013`: seq 1 at `1788791339.578776104` is `{"v":1,"kind":"turnstile.settlement","railId":"hedera-x402","network":"hedera:testnet","transaction":"0.0.7162784@1788791330.918068236","payer":"0.0.10408012","payTo":"0.0.10403961","amount":"84367844","asset":"0.0.0","priceUsd":0.07,"resource":"http://127.0.0.1:38267/analyze/…"}`. The resource is a localhost URL, so this receipt came from a local test run.
- The public deployment `turnstile.moveseventyeight.com` was shut down on 2026-11-04 (`docs/EVIDENCE.md:6`).

### Turnstile surfaces

- **Agent discovery** (`seller/service/discovery.ts`): a three-way join.
  1. The ERC-8004 registry, read via Substreams, says who exists (197 registrations).
  2. The ENSv2 `turnstile:price` record says what Turnstile sellers charge. It uses ENSIP-25/26 keys, and the hot key's roles are scoped on chain.
  3. A live 402 probe of other sellers (`graph/sink/probe-x402.ts`).

  The MCP server `mcp-turnstile` exposes 4 tools: `find-sellers`, `get-offer`, `purchase`, `receipts`.
- **Paid analytics API** (`seller/service/app.ts:135,151,186`): `GET /analyze/:pool` and `/analyze/:pool/attested` are Uniswap pool analysis behind x402. `GET /receipts/:transaction` returns receipts.
- **Agent payment handling**:
  - The buyer uses `wrapFetchWithPaymentFromConfig` from `@x402/fetch` (`buyer/watchdog/pay.ts:29,215`) and enforces its own mandate cap.
  - The signer is the reference `createClientHederaSigner` (`buyer/watchdog/hedera-signer.ts:43,85`). The buyer reads the HBAR rate itself and ignores the seller's `extra.usdPerUnit` (`hedera-signer.ts:24-35`). This stops a seller from moving the buyer's cap with its own rate.
  - The seller does **not** use the SDK middleware. It has a custom ~120-line `paidRoute` that uses `@x402/core/http` codecs (`seller/service/x402.ts:22-31,50-54`). The reason is that it accepts `amount >= quoted` because the HBAR rate moves, while the SDK requires an exact match.
- **HCS receipts** (`rails/hedera-x402/hcs.ts`):
  - `TopicMessageSubmitTransaction` followed by `getReceipt` (`hcs.ts:128-134`).
  - Best effort: it returns `null` or `{error}` and never throws (`hcs.ts:123`).
  - It stores no sold content.
  - Reads go back through the mirror node with a `kind` filter (`hcs.ts:154-173`).
- **Ordering**: verify → work → settle. If settlement fails, the answer is withheld and a 402 is returned (`seller/service/x402.ts:43-47`).

### Patterns we can reuse

- Discover the fee payer from `/supported` at each challenge, and fail with 503 if it's missing (`rails/hedera-x402/index.ts:189-207`).
- Replay guard keyed on the signed tx bytes, checked before `/verify` (`index.ts:247-254`). Why this matters: the network does reject duplicates, but only after the seller has already delivered the work.
- Convert tx ids from `@` form to the mirror's dashed form. The `@` form returns 400 (`config.ts:96-104`):
  ```ts
  return transactionId.replace('@', '-').replace(/\.(\d+)$/, '-$1');
  ```
- Fall back to the mirror node for receipts, so a restarted seller can still answer (`index.ts:355-390`).
- The HCS receipt schema `{v, kind, railId, network, transaction, payer, payTo, amount, asset, priceUsd, resource, settledAt}` (`hcs.ts:40-58`).
- `no-chain-code.test.ts` fails the build if chain names leak into the payment path.

### Incompatibilities

- Pinned to `@x402/*` 2.25 and sdk 2.85. Moving to 2.30 means sdk 2.90.1 (a nested copy under `@x402/hedera` is likely; unverified).
- The custom seller middleware is not `x402ResourceServer`. Its `>=` amount rule diverges from the SDK's exact match.
- Node ≥22.18 type-stripping with no build step, plus `node:sqlite`.
- The multi-chain scope (ENS, Sepolia, Arc, CRE, Privy) is much larger than a Hedera-only rail.

### Security concerns

- The resource binding is advisory only. The Hedera tx doesn't commit to the URL, and Blocky402's parity check skips `extra.resource`. The code documents this itself (`index.ts:49-65`).
- The replay set is in-memory and lasts one process (`index.ts:121-140`). After a restart, only the network's duplicate check is left, and that happens after delivery.
- HCS writes are best effort. Comments allow for a topic with no submit key (`hcs.ts:165-166`). That is unverified for `0.0.10408013`, but if true, anyone can post `kind:"turnstile.settlement"` spoofs.
- Operator custody is not cold: the deployer key in `.env` holds the root roles (`EVIDENCE.md:84`).
- The gateway bypass header `x-turnstile-gateway-key` skips the 402. It uses `timingSafeEqual` (`seller/service/gateway.ts:19,64`), which is reasonable.

---

## 2. hedera-dev/x402-inference-pay-per-request-poc

- HEAD `a56ad6051bb69a5f6f9ef8dafbcdf2f97c69b236` (2026-07-15).
- License: **none**. There is no LICENSE file and no `license` field. Treat it as all rights reserved: copy patterns, not code.
- Versions:

  | Package | Declared | Resolved in lockfile |
  |---|---|---|
  | `@x402/core` | `^2.18.0` | 2.18.0 |
  | `@x402/express` | `^2.18.0` | 2.18.0 |
  | `@x402/fetch` | `^2.18.0` | 2.18.0 |
  | `@x402/hedera` | `^2.18.0` | 2.18.0 |
  | `@x402/extensions` | (transitive) | 2.18.0 |
  | `@hiero-ledger/sdk` | `^2.85.0` | 2.85.0 |

  The lockfile has a nested `@x402/hedera/node_modules/protobufjs@8.0.1` and `@hiero-ledger/proto@2.31.0`. There is no `@hashgraph/sdk`.
- Facilitators (`packages/service/src/x402.ts:5-9`): testnet defaults to `https://x402.org/facilitator` and mainnet to `https://api.blocky402.com`. Both can be overridden with `X402_{TESTNET,MAINNET}_FACILITATOR_URL`. No API key is passed to `HTTPFacilitatorClient` (`x402.ts:11`), so the mainnet default probably fails without one (unverified).
- Live settlement evidence: **none in the repo**. No tx ids are committed. The UI links to the service *account* on HashScan, not to a transaction (README:215). There is nothing to verify on the mirror node, so live settlement is unverified.

### Server-side reference pattern

`packages/service/src/x402.ts:1-16`:

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
return new x402ResourceServer(facilitatorClient).register('hedera:*', new ExactHederaScheme({}));
```

It is wired with `paymentMiddleware(routes, rs)` from `@x402/express` (`server.ts:46-76`). Prices are `'$0.001'` for USDC and `{asset:'0.0.0', amount:'100000'}` for HBAR (`server.ts:22-23`).

### Client-side reference pattern

`packages/agent/src/x402-client.ts:1-4,28-42,80`:

```ts
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { createClientHederaSigner } from '@x402/hedera';
const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network: 'hedera:testnet' });
new x402Client().register('hedera:testnet', new ExactHederaScheme(signer))
return wrapFetchWithPayment(statusFetch, sharedClient);
```

The header names are `PAYMENT-SIGNATURE` (v2) and `X-PAYMENT` (v1) (`x402-client.ts:49`).

### Import drift against 2.30.0

Every subpath and symbol used here still exists in 2.30.0's export maps: `@x402/core/server`, `@x402/hedera/exact/{client,server}`, root `createClientHederaSigner`. That is checked against the tarball type declarations. Whether `x402Client`, `wrapFetchWithPayment`, `HTTPFacilitatorClient`, and `x402ResourceServer` kept the same signatures is **unverified** (not compiled). One known change: 2.30 pulls in `@hiero-ledger/sdk 2.90.1`, while the app pins `^2.85.0`. Expect two SDK copies unless the app bumps its own pin. `PrivateKey` from the app's SDK must then be accepted by the nested copy (instanceof risk, unverified).

### Reusable

- The canonical `x402ResourceServer` with `register('hedera:*')` and `@x402/express`.
- The client wiring above.
- The per-route network×asset matrix.
- `scripts/associate-token.ts`: USDC `0.0.429274` on testnet, `0.0.456858` on mainnet.

### Security concerns

- The agent server holds payer keys, uses `cors()` with any origin, and `express.json()` (`packages/agent/src/server.ts:34-35`). Any web page can make the local agent spend. There's no auth.
- Mainnet credentials silently fall back to the testnet `HEDERA_AGENT_*` (`x402-client.ts:18-19`). The service does the same for its payout account (`server.ts:14`).
- No seller-side replay or idempotency beyond what the SDK and facilitator do.
- The proxy forwards any request body to LM Studio.
- The key is parsed as ECDSA only.

---

## 3. Hedron PR #11 / #12 (Glorian-Labs/Hedron)

- **#11** "feat: x402 Hedera rail proven on-chain, quote trust boundary, HAK v4 plugin, 0 critical CVEs". **MERGED**, merge commit `894d5b9af7b155d44c36dd6c8ac85219279b2d8b`. This is the current `origin/main` HEAD. 39 files, +6100/−330, built against `@x402/hedera`/`core` 2.20.0.
- **#12** "docs: align public status with proven surface". **OPEN**, head `76a34b6a574395ce6cae690af5dea8f6f4b073ff`, +53/−66, docs only (README, QUICKSTART, ROADMAP, X402_ADAPTER, CHANGELOG, `demo/testnet.ts` placeholder). The local checkout is on this branch.

### Lessons

1. **Freezing.** A bare `tx.freeze()` throws `transaction must have been frozen before calculating the hash`, even when `transactionId` is set, because node account ids are missing. The fix is `freezeWith(client)`. It supplies the address book and submits nothing. None of the 31 unit tests caught this; only the live e2e run did.
   `src/settlement/x402/client.ts:110-112,136-142`:
   ```ts
   const txId = TransactionId.generate(feePayerId)
   let tx = new TransferTransaction().setTransactionId(txId)
   const client = this.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet()
   const frozen = tx.freezeWith(client)
   const signed = await frozen.sign(this.key)
   ```
2. **TransactionId with the facilitator as payer.** The tx-id account *is* the fee payer. The facilitator rejects a tx whose id names anyone else. Tier B in the e2e asserts that the tx-id account equals the fee payer.
3. **Fee-payer config from `/supported`.** `facilitator.feePayerFor(caip2)` (`facilitator.ts:143`) and `supportsHederaNetwork()` (`facilitator.ts:132`) are used by the adapter (`adapter.ts:85`). `extra.feePayer` is mandatory and validated as an entity id (`mapping.ts:163-168`).
4. **Quote consistency.** There are six ordered checks:

   | Check | What it proves |
   |---|---|
   | `agentKnown` | the agent is registered |
   | `signature` | the quote is signed |
   | `quoteHashBinding` | the quote's identity. The core hash excludes `paymentRequirement`, so it can't catch a price mismatch. |
   | `requirementConsistent` | `pricing` and `paymentRequirement` agree. This closes the gap left by the hash. |
   | `quoteExpiry` | the quote hasn't expired |
   | `paymentRequirementExpiry` | the payment requirement hasn't expired |

   `BrokerDeps.quoteVerifier` is required. Always sign `adapter.toWireRequirements()` (`adapter.ts:146`). A hardcoded `maxTimeoutSeconds` drifts and fails with `accepted_payment_requirements_mismatch`, because it is derived from expiry relative to now (`mapping.ts:185`).
5. **Receipt verification.** `verifySettlementReceipt` runs `railMatches`, `recordShape`, `known`, `recordMatches`, `networkMatches`, and fails closed on an unknown id (`docs/X402_ADAPTER.md:122`). `settlementHash` and `receipt.record` are deliberately different hashes, so passing one for the other must fail `recordMatches`.
6. **Replay protection.** A local `seenPaymentIds` set is checked before `/settle`, so a replay never reaches the wire (`adapter.ts:73,255,266`). `/settle` is never retried, to avoid double submission (`facilitator.ts:64-66`, `adapter.ts:246-248`). Broker idempotency uses `canonicalHash({correlationId, quoteId})` (`broker/index.ts:270`). The set is in-memory only, like Turnstile's.
7. **Mainnet vs testnet host.** `https://api.blocky402.com` returns 200 on `/supported` but advertises `hedera:mainnet` with fee payer `0.0.10571514`, and it needs an API key. Only the CAIP-2 value in the body tells the hosts apart (`docs/X402_ADAPTER.md:85`, `.env.example:64-68`). Note that the hedera-dev PoC uses that exact host as its mainnet default.
8. **Other traps.**
   - The canonical spec repo is `x402-foundation/x402`, not `coinbase/x402`.
   - The unscoped `x402` npm package is a stale v1 line.
   - Self-payment nets to zero and fails with `amount_mismatch`.
   - `addTokenTransfer` takes `bigint`; `Long` is a UMD global and fails with TS2686.
   - vitest does not typecheck, so keep `npm run build` in the loop.
   - `@hashgraph/sdk` was dead weight. Removing it cleared the critical protobufjs advisories.

### Stated limitations

From the #11 body, `docs/X402_ADAPTER.md:127-129`, and #12:

- The adapter has no mirror-node read-back of its own. `mirrorHints` is empty, which blocks the "explorer-verifiable" claim.
- HTS settlement is not proven live.
- No refund or dispute hooks.
- The MCP adapter is thin.
- No mainnet.
- #12 adds: x402 is **not wired through `Broker.runFlow` + HCS**, `src/hcs` is still a mock emitter, and `demo:testnet` is a placeholder until v0.2.0-alpha.2.
- 8 high/moderate advisories remain, with no fix available.

### Live evidence

The #11 body and `docs/X402_ADAPTER.md:102` show a mirror read-back: payer `0.0.9050506` −100 tinybar → `0.0.98` +100, fee payer `0.0.7162784` −292,737, `SUCCESS`. **The tx id is not recorded anywhere in the PR or repo.** A mirror query of the latest 100 txs for `0.0.9050506` found no matching 100-tinybar transfer. So Hedron's live settlement is **unverified by tx id** (the claim is plausible, but there's no id to check). Action: commit the tx id from the next e2e run.

---

## Takeaways for shiplock

- Target `@x402/*` 2.30.0 with its bundled `@hiero-ledger/sdk` 2.90.1. Align our direct SDK pin to 2.90.1 to avoid a duplicate copy.
- Use the reference `createClientHederaSigner` instead of hand-building transactions. It already does `freezeWith` and sets the fee-payer tx id.
- The seller side can be the canonical `x402ResourceServer` with `ExactHederaScheme`. Add on top: a fee payer read live from `/supported`, a persistent replay guard (not in-memory), mirror read-back of the settled tx, and an HCS receipt topic **with a submit key**.
- Assert the network in the `/supported` body, not reachability alone.
- Record tx ids for evidence, in both `@` and dashed forms.
- License: Turnstile is MIT (declared in package.json, no LICENSE file); hedera-dev has no license, so reuse its patterns only.
