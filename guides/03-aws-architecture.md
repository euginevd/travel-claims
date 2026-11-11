# AWS architecture

Tier 2 end to end: the design a regulated insurer would run for UnderCover, built here in `dev` on made-up data (decision 31). How to deploy it and tear it down: [the AWS runbook](02-aws-runbook.md). Why each choice: decisions 30 to 35. Cost: [costs.md](../docs/costs.md). Risks: [threat-model.md](../docs/threat-model.md).

## Scope

- **Built here:** the workload: everything in `infra/aws/` and the four apps, in one account in Sydney (`ap-southeast-2`), serverless, with no VPC.
- **Assumed:** the organization-level controls a platform team runs for every workload ([Platform boundary](#platform-boundary)). A gap there is fixed at that layer, not in this repo.
- **Not built yet:** the items in [TODO.md](../TODO.md), such as a private network and Guardrails on the model's output ([Known gaps](#known-gaps)).

## End to end

*(Diagram to come.)*

**A customer's claim**

1. The customer opens the portal: CloudFront serves it from a private S3 bucket, behind AWS WAF.
2. They sign in to the customers' Cognito user pool and get an ID token.
3. They submit a claim and a receipt: CloudFront forwards `/api/customer/*` to the `api` Lambda, which checks the token's issuer, audience and group, keeps the claim in Aurora DSQL and the receipt in S3.
4. The `api` starts the agent: it gets a machine token from AgentCore Identity's token vault (the services pool, scope `undercover-agent/invoke`) and calls AgentCore Runtime, which accepts only that token.
5. The agent screens the customer's text with the Bedrock Guardrail, then works the claim with Claude (the Anthropic API or Bedrock, by `MODEL_PROVIDER`), saving each step in DynamoDB.
6. It looks up the policy through the agent's AgentCore Gateway, signed with IAM. AgentCore Policy allows the call before the gateway invokes the context Lambda by its ARN.
7. It remembers the customer in AgentCore Memory, one namespace per customer.
8. It records its decision through the `api` (a shared key): the `api` checks the approval limit and the kill switch, and code, not the model, pays (decision 4).

**A handler's question**

1. The handler signs in to the dashboard through the handlers' pool.
2. The dashboard sends `/api/staff/*` to the `api` and `/api/copilot/*` to the Copilot Lambda.
3. The Copilot checks the handler with the `api`, then looks up documents through the staff AgentCore Gateway, which takes the handler's own ID token and lets in only the `handlers` group. AgentCore Policy allows only `search_documents` and `read_section`.
4. Any action, such as a sign-off or a dispatch, waits for the handler's confirmation (decision 24). Conversations and notes are kept in DynamoDB.

**An AI engineer's work**

The console, through the engineers' pool, runs evaluations, improvement and the red team on the same agent runtime. Ask UnderCover searches the policy wording in a Bedrock Knowledge Base on S3 Vectors.

## By layer

| Layer | AWS | How it's secured | Decision |
|---|---|---|---|
| **Edge** | CloudFront, one distribution per site, with S3 origins | Private buckets read only through origin access control, TLS only, security headers and HSTS, the api never cached | 30 |
| **Firewall** | AWS WAF through CloudFront's Free plan | Three managed rule sets and a rate limit per IP on the three apps (4 of the plan's 5 rules); one plan per app, the account's limit of 3 | 30 |
| **Sign-in** | Cognito, four user pools | One pool per audience (customers, handlers, engineers), accounts made by an admin; a services pool with one client, the `api`, for its machine token | 10, 12, 33 |
| **Compute** | Lambda (`api`, `context`, `copilot`) | Each its own role inside the bootstrap's permissions boundary; the context server has no URL | 30, 34 |
| **Agent** | AgentCore Runtime | Accepts only the `api`'s machine token, with SigV4 off; one session per task | 17, 33 |
| **Tools** | AgentCore Gateway (two), AgentCore Policy | IAM for the agent and the handler's token for the Copilot; Cedar allow-lists in ENFORCE mode, so anything not permitted is denied | 34 |
| **Agent identity** | AgentCore Identity | A workload identity for each app (`api`, `agent`, `copilot`); the Anthropic key and the `api`'s client secret stay in the token vault | 33 |
| **AI safety** | Bedrock Guardrail | Customers' text is screened before any model reads it; a numbered version, so a change is a reviewed apply | 17 |
| **Model** | Claude on Bedrock (Australian inference profile) or the Anthropic API | The model decides and code pays: it can't reach a payment (decisions 4 and 18) | 3, 15 |
| **Search and memory** | Bedrock Knowledge Base on S3 Vectors, AgentCore Memory | Public policy wording only; memory is records the agent writes itself, so no model extracts anything from customers' words | 17 |
| **Data** | Aurora DSQL, DynamoDB, S3 (receipts) | IAM sign-in to DSQL, so no password exists; encrypted at rest; receipts private and TLS-only under random names | 30 |
| **Settings** | SSM Parameter Store (SecureString) | Written by script, so no value is in Terraform state | 30 |
| **Audit** | Bedrock model invocation logging, CloudWatch | Every Bedrock model call kept 30 days in a bucket only tear down can empty; alarms on errors and throttles, by email through SNS | 34 |
| **Delivery** | GitHub Actions with OIDC, Terraform per unit, ECR | No stored AWS keys; a read-only plan role on PRs, a deploy role only from `main`; scans and a cost estimate on every PR | 30, 32 |

What plays each part locally: the same apps run in Docker Compose, with PostgreSQL for DSQL, DynamoDB and Memory, a local stand-in for Cognito, and nginx for CloudFront.

## Platform boundary

### What the platform provides

In a regulated insurer, the secure enterprise patterns are expected to be in place already, managed at the organization level by a platform team. Every workload, this one included, inherits them:

- **Accounts:** AWS Organizations and Control Tower, with separate development, test, production, log-archive and security accounts.
- **Guardrails:** service and resource control policies: regions locked to Australia, nobody turns off CloudTrail, GuardDuty or Config, and data can't leave the organization.
- **People:** IAM Identity Center with the company's identity provider: MFA everywhere, least-privilege access, time-bound admin access, break-glass accounts, and no standing root credentials.
- **Keys and secrets:** AWS KMS customer-managed keys per data class, with rotation; Secrets Manager and AWS Private CA standards.
- **Network:** central inspected egress through AWS Network Firewall (an outbound allow-list) and Route 53 Resolver DNS Firewall.
- **Edge:** AWS Firewall Manager rules on every WAF, and Shield Advanced.
- **Logging:** an organization CloudTrail trail to the log-archive account with S3 Object Lock, into the company's SIEM, kept for the regulated period.
- **Detection:** Amazon GuardDuty (including Bedrock and AgentCore), AWS Security Hub, AWS Config, Amazon Inspector, Amazon Macie and IAM Access Analyzer: threat detection, one view of findings, drift checks, vulnerability scans, personal-data discovery and unused access.
- **Response:** a 24/7 incident team and tested runbooks.
- **Backup and resilience:** AWS Backup organization policies with Vault Lock, copies in another account and region, and recovery targets for critical operations.
- **Compliance:** evidence through AWS Audit Manager and AWS Artifact for APRA CPS 234 (information security), CPS 230 (operational risk, including the model provider as a material service provider) and the Privacy Act.
- **Cost:** AWS Budgets, Cost Anomaly Detection and tag policies per workload.
- **Delivery:** a second reviewer on every change and every deploy beyond `dev`, signed images with an SBOM, and a pen test before go-live.

### What the workload owns

Everything in [By layer](#by-layer): its sites and WAF rules, sign-in pools, apps, agent and its identity, tool rules, data stores, settings, alarms, and the audit trail of its own AI decisions (Bedrock model invocation logging, agreed with the platform team in a shared account).

### What this repo builds that the platform would own

In a real organization this code sits in the platform team's own landing-zone repo, such as one built on Landing Zone Accelerator on AWS or Account Factory for Terraform, deployed through their pipeline to every account. It's shown in this repo only for simplicity, so one repo deploys the whole picture to an account with no platform team. Each piece is kept apart from the workload's and switched off with a setting (decision 35):

- **The bootstrap:** the workflows read only `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` and `TF_STATE_BUCKET`, so the platform's own pipeline roles and state bucket replace `bootstrap.yaml`.
- **The `platform` unit** (budget alert, Access Analyzer): `PLATFORM_MANAGED=true` skips it.
- **Staff sign-in:** point the `api`'s `STAFF_` and `ENGINEERING_TOKEN_ISSUER` and `_AUDIENCE` at the company's identity provider; the customer and services pools stay.
- **CloudFront's Free plan and its WAF:** `CLOUDFRONT_FREE_PLAN=false`, leaving Firewall Manager and Shield Advanced to the platform.
- **`check-aws.sh` and `teardown-aws.sh`:** account-level, so not run.

## Known gaps

What the workload would still add before real data, in [TODO.md](../TODO.md) and [the security trade-offs](04-security-trade-offs.md):

- **Private network:** the Lambdas and the agent runtime in a VPC with endpoints, about $120 a month.
- **Guardrails on the model's output**, not only customers' text.
- **AWS Backup for DSQL.**
- **A permissions audit:** the bootstrap is wide while building (decision 32), to be narrowed.
- **Observability and Evaluations** on AgentCore.
- **The agent's own call back to the `api`** uses a shared key; a machine token like the `api`'s is next.
