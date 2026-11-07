# ShipLock — speaker notes and demo choreography

**One-line pitch**  
AI writes code. Agents autonomously pay for review. A verified maintainer authorizes exactly the revision that gets merged.

**Tone:** practical developer tool, not a claim that GitHub has no review or security safeguards. Distinguish hackathon acceptance targets from deployed live evidence.

## Slide 1 — Cover
"ShipLock connects autonomous code production to accountable release decisions. The agent handles the logistics of buying scrutiny; the person keeps control of the merge."

## Slide 2 — Why now
"GitHub's 2026 Octoverse shows 55% of monthly active Copilot users use agentic features. AI-assisted code review usage has grown over 90% year over year. Generation is accelerating, which makes release authorization a more important handoff."

## Slide 3 — Problem
"A scan is an observation about source at a point in time. An approval is an act by a person. A merge is the actual source revision landing in the repository. Those three need to be bound to one SHA. We are not replacing GitHub's built-in checks."

## Slide 4 — User
"Imagine a wallet SDK maintainer who receives an agent-authored change to signature verification. This is a change they want to ship, but only after external review and exact-version consent."

## Slide 5 — Product flow
"The coding agent requests an x402 audit. Hedera settles the micropayment. The reviewer service returns findings tied to a SHA. The maintainer, signed in with GitHub, reviews the exact action and approves it with a fresh World ID proof of human. GitHub merges only if its HEAD still matches."

## Slide 6 — Trust boundaries
"There is no one magical verified flag. The agent's permission is spending a bounded amount on analysis. The scanner's responsibility is evidence. The human's action is a separate explicit approval. GitHub independently controls the merge; our backend never puts signing secrets in the browser."

## Slide 7 — Demo
"First show a real paid scan and a merge of the approved commit. Then push a new commit after approval and show the same approval cannot merge it. Also demonstrate a cancelled World ID approval. Use live URLs only when those flows are actually completed."

## Slide 8 — Architecture
"We are not building the x402 rail from scratch. Carpool, AutoVoyage and the official Hedera mechanism provide working examples. Hedron contributes quote-validation and replay lessons, but is not treated as the latest complete app."

## Slide 9 — Sponsor proof
"For Hedera, the agent must independently buy and receive a real service over x402, with a settled transaction. For World, IDKit proofs must be verified server-side with World, and cancellation must leave the protected action blocked. Simulator proofs are development proofs, not real human verification."

## Slide 10 — Milestones
"These are evidence gates: research source; settle a payment; prove report integrity; validate human auth; enforce exact-SHA merge; document the success and denial. We will not confuse a green test suite with a live payment."

## Slide 11 — Future
"Once this works for a GitHub merge, the same transaction-specific authorization primitive might extend to publishing packages, deploying to production or modifying infrastructure. That's a roadmap, not a feature we claim to have shipped."

## Slide 12 — Close
"Let agents increase developer throughput without inheriting release authority. Our proof is a paid audit, human approval, and an exact merge—and a failed attempt to merge changed code."

## Demonstration prerequisites

- [ ] Public repo and one disposable PR that is safe to merge
- [ ] x402-paid scanner API returns authentic 402 challenge and non-stub audit output
- [ ] Agent payer funded on Hedera testnet; real transaction ID and HashScan URL preserved
- [ ] World Developer Portal app (staging + production actions) and GitHub OAuth App; simulator vs real-phone proofs clearly labeled
- [ ] Maintainer identity-to-GitHub permission binding and separate explicit approval
- [ ] Merge API call carries expected PR HEAD SHA; branch rules respected
- [ ] Second PR or new commit to show stale approval blocking
- [ ] Evidence file with actual commit hashes, payments, merge result and tests

## Important distinctions in Q&A

**"Isn't this just branch protection?"** Branch protection enforces repository policies; ShipLock orchestrates a purchased review from a service the agent can pay for without account creation, binds that report to the proposed action, and adds fresh human identity verification and explicit consent. For stronger enforcement beyond the demo app, publish a required GitHub status check and configure non-bypass rules.

**"Isn't this just Commitment Issues?"** That earlier project focuses on releasing a commit signature after World verification. ShipLock's proposed wedge is end-to-end audit procurement and paid third-party review evidence before a one-use, SHA-guarded GitHub merge. Both overlap on exact-commit authorization; we should acknowledge the precedent.

**"Is the independent auditor genuinely independent?"** A separate API boundary is not by itself proof of organizational independence. MVP should state the actual provider, scanning engine, rules, versions, and hashes; third-party auditor diversity and signed attestations belong in later milestones.

**"Does a World ID proof prove consent?"** Not on its own. It proves a unique human is present. ShipLock asks for it only after showing the exact action, binds it to that action's hash, and still requires the maintainer's GitHub permission.

**"What if an admin bypasses the system?"** No application-level gate can prevent a sufficiently privileged GitHub admin from bypassing repository rules. Required status checks, protection and app permission scopes can make enforcement substantially stronger.

## Sources
- https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/
- https://docs.github.com/en/rest/pulls/pulls
- https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks
- https://docs.world.org/world-id/idkit/integrate
- https://docs.world.org/world-id/idkit/session-proofs
- https://ethglobal.com/events/mumbai/prizes
- https://ethglobal.com/showcase/commitment-issues-y1t2h
- https://ethglobal.com/showcase/carpool-f4bez
- https://ethglobal.com/showcase/turnstile-ovks1
