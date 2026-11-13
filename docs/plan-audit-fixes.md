# Plan: audit fixes

Spec items: 20, 21, 22, 23, 27, 28. Profile: prototype.

## Design

Fixes from the end-to-end audit of 13 Nov 2026, with no new features. The api, agent, Copilot, the three web apps, the bootstrap, two Terraform lock files and CI change; the data model doesn't, and no migration is needed.

## Security risks

- R14: the AWS demo offered the senior handler to anyone. Now the plain handler only.
- Spec 20: an override paid any amount up to $1M. Now at most what was claimed, within the plan.
- Spec 27: payments read the pause switch and approval limit unlocked, so a pause landing mid-payment could be missed. Now read locked; a Postgres test proves it.
- Spec 21 and 23: Copilot memory and the Ask history went to the model unchecked. Now screened in code.
- The deploy role could rewrite the troubleshoot role's trust, or tag any KMS key into `kms:*`. Both closed.

## Phases

### 1. Money and sign-in (api)

- [x] The demo refuses `senior`; overrides capped; locked reads; cents comparisons; failed uploads leave no file; customer email matched ignoring case; phone numbers redacted; demo stats counted in SQL; sign-in routes moved out of `main.py`
- [x] Tests on SQLite and Postgres

### 2. Agents

- [x] The red team fails an attack not decided in time or decided wrongly, and exits non-zero; it signs in as the plain handler
- [x] Improver failures end the round; Copilot survives a timeout mid-turn; Copilot memory and Ask history checked in code; specialist calls counted

### 3. Infrastructure and CI

- [x] A budget alert in the bootstrap; KMS tagging grants removed; troubleshoot role protected; costly AI creates denied; teardown matches only this project's buckets
- [x] Lock files for `agent` and `web`
- [x] The `quality` workflow: evaluation floors and the red team, by hand on `dev`
- [x] Playwright in CI: sign-in, tokens refused across audiences, axe on each main page

### 4. Web apps

- [x] Shared code in `packages/web-core`; staff sign-in handles MFA challenges; panel and dialog focus; focus ring contrast; draft and New-chat races; captions on the walkthrough

## Ask first

- The bootstrap gains a budget (free) and a required `BudgetEmail` parameter: the user updates the stack.
- Left for the user: the CLI user's MFA (changes how the developer signs in), sending the raw receipt image when Textract can't read it (decision 48), server-side Ask history, checking the agent's thread on decisions and payments (a contract change between the api and the agent), and turning Cognito MFA on for the staff and engineering pools (the apps now handle it, but there's no screen to add an authenticator yet, and `ON` would stop the demo's test accounts signing in).
