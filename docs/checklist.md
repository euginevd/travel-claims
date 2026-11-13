# Checklist

The guardrails in DevSecOps stage order. This project is a prototype throughout (decision 31); clear it before any real users, customer data or payments. How each one works: sdlc-template's [guide 04](https://github.com/euginevd/sdlc-template/blob/main/guides/04-the-guardrails.md); risks accepted instead: [guides/04-security-trade-offs.md](../guides/04-security-trade-offs.md). Tier 2 is torn down, so its rows describe what the code deploys.

| # | Stage | Control | Tool | Profile | Here |
|---|---|---|---|---|---|
| 1 | Plan | Threat modelling, requirements | `threat-model.md`, spec, ASVS | Production | Done: threat model and ASVS 5.0 Level 2 (spec 28) |
| 2 | Plan | Cost estimate | `costs.md` | Production | Done |
| 3 | Code, IDE | Secrets, SCA, IaC scanning | Gitleaks, Trivy | Both | Done: the pre-push scan |
| 4 | Code, repo | Push protection, SCA | GitHub, Dependabot | Both | Done |
| 5 | Code, agent | Agent guardrails | `AGENTS.md`, harness settings | Both | `AGENTS.md` only: no deny rules (trade-offs 8) |
| 6 | Build | Secrets, SCA, IaC scanning | Gitleaks, Trivy, Checkov | Both | Done: the `security` workflow |
| 7 | Build | SAST | Semgrep, CodeQL, GitHub AI Scan | Both | Done: Semgrep and CodeQL |
| 8 | Build | Supply chain security | Pinned versions, SBOM | Both | Done: pins, a 7-day wait, an SBOM per run, and each image scanned with its own SBOM before it reaches ECR |
| 9 | Test | Unit and abuse-case tests, coverage | pytest, `apps` workflow | Both | Done at 80%, with injection tests; abuse cases light (trade-offs 13) |
| 10 | Test | DAST, unauthenticated | OWASP ZAP baseline scan | Production | Open |
| 11 | Test | DAST, authenticated | OWASP ZAP with a test login | Production | Open |
| 12 | Release | Branch protection | `main` ruleset | Both | Done: `protect-main.sh` |
| 13 | Release | Peer review | Second reviewer | Production | Open: one owner (trade-offs 12, decision 28) |
| 14 | Release | Cost review | Infracost | Both | Done: the cost comment on PRs |
| 15 | Deploy | AWS account baseline | Root MFA, IAM Identity Center | Both | The owner's account, outside the repo |
| 16 | Deploy | Least privilege | OIDC, read-only role, `main` only | Both | Partly: OIDC, a read-only plan role and a boundary on every app role, but the deploy role and boundary are wide for AI features while building; narrowed by the permissions audit once built (decision 32) |
| 17 | Deploy | Deploy approval | Second reviewer | Production | Open: `dev` deploys unattended |
| 18 | Deploy | Runtime secrets | Secrets Manager, SSM | Both | Done on AWS: one SecureString of settings per environment |
| 19 | Deploy | API protection | Authoriser, WAF, CORS | Production | Partly: the api checks every token, CloudFront forwards one prefix per app; WAF on the sites from the platform's Firewall Manager with `CLOUDFRONT_WAF=on`, off in this prototype (decision 51) |
| 20 | Operate | Weekly re-scans | `security`, `codeql`, Dependabot | Both | Done |
| 21 | Operate | Budget alert | AWS Budgets | Both | Done: in the bootstrap, when `BudgetEmail` is set (decision 54) |
| 22 | Monitor | Access logs, throttling | API Gateway, CloudWatch | Both | Partly: function logs in CloudWatch; no throttling on the function URLs |
| 23 | Monitor | Audit logging | CloudTrail | Both | Open: the account's default event history only |
| 24 | Monitor | Threat detection, alarms | GuardDuty, CloudWatch alarms | Production | Open |
