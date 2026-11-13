# Security trade-offs

The risks this project accepts, numbered so reviews can cite them (trade-offs 1). An accepted risk is a decision: change it here, never by weakening a check.

The profile decides what happens to them ([AGENTS.md](../AGENTS.md) rules 11 to 13). This `prototype` accepts them all (decision 28). As `production` it applies each fix or records who accepts the risk; 12 and 13 then no longer apply.

| # | Risk | Why | Production fix |
|:-:|------|-----|----------------|
| 1 | The agent shares the developer's GitHub identity | It could approve its own deploy or change the ruleset; only `AGENTS.md` rules 25 and 26 ask it not to. | A `main` ruleset needing another person's approval, and *Prevent self-review* on the apply environments (sdlc-template's `protect-main.sh production`). |
| 2 | Pinned scanner and CI images go stale | Images pinned by digest in `docker run` and `container:` lines aren't updated by Dependabot. | Renovate with the same 7-day wait; until then, update by hand when changing a workflow. |
| 3 | The deploy role is broad in places | AgentCore, Cognito and CloudFront actions are limited to the region or account, not the project. | A dedicated AWS account per project and environment. |
| 4 | A failing Terraform plan can merge | The `aws` workflow runs only on some paths, so `plan` can't be required; `terraform validate` is. | A small always-run job that fails when a plan failed, as a required check. |
| 5 | A PR's checks cover only what it changes | Scans and app jobs run on the PR's changes only; older code is caught only on `main` or weekly. | Alerts on failed `main` and weekly runs; review the `changes` job's paths when the layout changes. |
| 6 | Cost is a warning, not a gate | The cost comment flags a plan over `MONTHLY_COST_LIMIT` but doesn't block, and misses usage like tokens. | A required cost check, plus AWS Budgets and Cost Anomaly Detection. |
| 7 | The api and copilot URLs are open | Every route checks its token, but floods and probing that skip CloudFront reach the functions. | `API_GATEWAY=true`: no function URLs, a REST API with its own WAF and authorizers. |
| 8 | Nothing enforces the agent's rules on the machine | Only `AGENTS.md` rules 25 and 26 stop it reading `.env`, skipping a hook or changing the cloud. | Deny rules in `.claude/settings.json` or a sandbox for `.env*`, `*.tfvars`, `--no-verify`, `terraform apply` and `aws`. |
| 9 | Plans run unreviewed code and are kept as files | A PR's Terraform can read state before review, and the saved plan holds state in plain text for a day. | A private repo, a reviewer on the plan environments, encrypted plans. |
| 10 | Some checks are missing | No workflow lint, no tests for the report scripts, no tflint, no evals in CI, no automated accessibility check. | actionlint or zizmor and tflint as required checks, script tests, a capped evals job, axe in browser tests. |
| 11 | CodeQL needs a paid plan on private repos | On a private repo without Code Security, Semgrep is the only static analysis. | Buy GitHub Code Security, or record Semgrep alone as a decision. |
| 12 | A prototype runs without human gates | Only the owner approves, and the agent settles unclear points itself (`AGENTS.md` rules 12 and 21). | The `production` profile, with the second reviewer in 1. |
| 13 | A prototype is tested and reviewed lightly | Main-path tests and one review per branch, so edge cases surface late. | Abuse-case tests for every feature, a review per phase, the threat model re-approved. |
| 14 | Machine clients' secrets are in Terraform state | The api's and agent's Cognito client secrets sit in the identity unit's state, readable by the plan and deploy roles. | Create the clients by a script that pipes each secret to the vault, as `api-key-provider.py` does. |
