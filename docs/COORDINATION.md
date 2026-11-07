# Multi-agent coordination — Hermes + Cursor

## Suggested lanes (change as needed)

| Owner | Focus | Branch prefix | Deliverable |
|---|---|---|---|
| Hermes | M0 source/version/license audit; M1 live Hedera x402 spike; adversarial security review | `hermes/` | `docs/RESEARCH_NOTES.md`, payment module and evidence |
| Cursor | App UX, DB, audit scanner, OIDC, GitHub SHA merge gate | `cursor/` | backend/frontend modules, integration tests, evidence |
| Human maintainer | World IdP registration, funded keys, GitHub disposable repo, review and final acceptance | `main` reviews | no secrets in repo; verified milestone gates |

### Ownership rules

1. Before coding, each agent opens a scoped task/issue and posts which files it will change. Avoid conflicting changes to shared route schemas.
2. Start with contract definitions/interfaces agreed in `docs/RESEARCH_NOTES.md`, then parallelize.
3. One PR per milestone or bounded feature; all tests and typecheck must pass.
4. Do not claim a feature verified without linked evidence; mocks are named.
5. Security-sensitive OIDC, wallet and GitHub merge code requires independent cross-agent review.
6. Every branch handoff uses the template below and updates `docs/PROGRESS.md`.

### Handoff template

```text
TASK / MILESTONE:
OWNER / BRANCH / COMMIT SHA:
SOURCE REFS / PACKAGE VERSION PINS:
IMPLEMENTED FILES / BEHAVIOR:
TESTS / RESULTS (mock vs live):
REPRO COMMANDS:
REQUIRED ENV NAMES (never values):
EVIDENCE LINKS (HashScan/GitHub/logs sanitized):
FAILURE CASES TESTED:
OPEN RISKS / HANDOFF TO:
```

**Priority:** real x402 payment & validated World Agent Pass before polish or optional HCS/extra sponsors. Stop and surface integration blockers. Do not quietly replace real sponsors' flows with simulated screens.
