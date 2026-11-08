# Decisions

A worked example: `travel-claims`. Key decisions only, newest last, each with why and what it replaced. Never delete one; add a new one that supersedes it. Decisions 1–6 come from the template and apply to every project.

## From the template

1. **GitHub and Terraform for every project** (2026-11-08). Why: one pipeline, one IaC tool and one set of standards; each change is a reviewed plan. Instead of: a tool per project, or CloudFormation or CDK for the app.
2. **CloudFormation for the bootstrap** (2026-11-08). Why: it creates the pipeline's roles and state bucket, so it must exist first, and one stack deletes it all. Instead of: Terraform, which can't create its own state bucket.
3. **One repo per product** (2026-11-08). Why: apps and infrastructure change together in one PR, under one set of docs and rules. Instead of: a repo per app or per cloud.
4. **No account IDs or project names in the code** (2026-11-08). Why: the pipeline passes them from repository variables, so the code can go public safely. Instead of: writing them into each Terraform unit.
5. **Pre-push scan with Gitleaks and Trivy** (2026-11-08). Why: secrets, IaC misconfigurations and vulnerable packages are caught before they leave the machine, with free tools. Instead of: Wiz, which needs a licensed tenant, or a slower pre-commit scan.
6. **One generic `AGENTS.md`, no `CLAUDE.md`** (2026-11-08). Why: every coding agent reads it, and Claude Code skips it when a `CLAUDE.md` exists; project details live in the spec. Instead of: tool-specific files.

## For this project

7. **The agent decides; code pays** (2026-11-10). Why: a model can be talked into a wrong answer, so limits and payments must be enforced where no prompt can reach (spec 15). Instead of: letting the agent call the payment API.
8. **Lambda for the API and the agent** (2026-11-10). Why: claims arrive in bursts, there's nothing to run between them, and the team already deploys Lambda with Terraform. Instead of: EKS, which suits a larger platform team, or AgentCore Runtime.
9. **Claude on Bedrock, Australian inference profile** (2026-11-12). Why: claim data must stay in Australia, and Bedrock keeps the model inside the AWS account's controls (spec 16). Instead of: a model provider's own API, which sends data overseas.
10. **Automatic payment under $1,000** (2026-11-20). Why: most claims are small and clear-cut; the claims operations lead set the limit, and larger claims still need a handler (spec 11). Instead of: a handler signing off every claim.
