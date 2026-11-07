# Hackathon demo narrative and evidence

**Opening:** “Coding agents can submit security-sensitive PRs. But when an AI changes the code after a review, who approved what finally shipped?”

**Live sequence**
1. Agent submits or selects PR in disposable test repo. Show current head SHA.
2. The review agent requests paid analysis and receives HTTP 402; x402 transfers HBAR on Hedera testnet **without a human approval prompt**.
3. Show real settled HashScan transaction and report with file/line findings bound to SHA.
4. Maintainer initiates official World Agent Pass step-up, completes validated auth, reads exact action, explicitly approves.
5. App re-fetches exact head SHA and calls GitHub merge with matching `sha`; real PR becomes merged.
6. New PR: approval given, then change the PR head. Attempt merge; blocked. Also show World canceled/expired path that yields no approval.

**Evidence to include:** real transaction URL, transaction amount/asset/payer/payee, scrubbed HTTP 402/payment response, paid audit digest, PR links, World OIDC validation result *without tokens or personal identifiers*, explicit approval, and blocked attempt event.

**World integration debrief:** time to first success, friction, missing docs or capabilities, highest-impact improvement. Use measured, not invented, details.

**Do not say:** “security-certified,” “trustless vendor-independent,” “World Orb verified” when using fake event identities, “live Hedera transaction” when settlement is mocked, “GitHub prevents all bypasses” when app approval is optional.

**Beyond MVP:** as a required GitHub status check, repeat the same operation-bound approval for package publishing, deployment promotion or contract upgrades. These future actions are not implemented in the MVP.
