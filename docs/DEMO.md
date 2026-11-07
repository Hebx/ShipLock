# Hackathon demo narrative and evidence

**Opening:** “Coding agents can submit security-sensitive PRs. But when an AI changes the code after a review, who approved what finally shipped?”

**Live sequence**
1. Agent submits or selects PR in disposable test repo. Show current head SHA.
2. The review agent requests paid analysis and receives HTTP 402; x402 transfers HBAR on Hedera testnet **without a human approval prompt**.
3. Show real settled HashScan transaction and report with file/line findings bound to SHA.
4. Maintainer (signed in with GitHub, World ID enrolled) reads the exact operation — repository id, PR, full SHA, review digest, action, expiry — and approves it with World ID. The server verifies the proof with World.
5. App re-fetches exact head SHA and calls GitHub merge with matching `sha`; real PR becomes merged.
6. New PR: approval given, then change the PR head. Attempt merge; blocked. Also show a cancelled or rejected World ID approval (`user_rejected`) that yields no approval and no merge.

**Evidence to include:** real transaction URL, transaction amount/asset/payer/payee, scrubbed HTTP 402/payment response, paid audit digest, PR links, World verify result *without personal identifiers*, labeled staging (simulator) or production, explicit approval, and blocked attempt event.

**World integration debrief:** time to first success, friction, missing docs or capabilities, highest-impact improvement. Use measured, not invented, details.

**Do not say:** “security-certified,” “trustless vendor-independent,” “verified human” or “World Orb verified” for World staging/simulator proofs, “live Hedera transaction” when settlement is mocked, “GitHub prevents all bypasses” when app approval is optional.

**Beyond MVP:** as a required GitHub status check, repeat the same operation-bound approval for package publishing, deployment promotion or contract upgrades. These future actions are not implemented in the MVP.
