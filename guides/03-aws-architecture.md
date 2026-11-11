# AWS architecture

UnderCover's design end to end: what a regulated insurer would run, deployed here to `dev` on made-up data (decisions 31 and 37). Docker runs the same apps on a laptop only to test them before deploying. How to deploy it and tear it down: [the AWS runbook](02-aws-runbook.md). Why each choice: decisions 30 to 37. Cost: [costs.md](../docs/costs.md). Risks: [threat-model.md](../docs/threat-model.md).

## Scope

- **The workload:** everything in `infra/aws/` and the four apps, in one account in Sydney (`ap-southeast-2`): managed and serverless, in private subnets that reach AWS through VPC endpoints.
- **The platform:** the organization-level controls a platform team runs for every workload are in place ([Platform boundary](#platform-boundary)); a gap there is fixed at that layer, not in this repo. The network it provides is built here by a stand-in, the `platform` unit.
- **Cost:** the design is what's described; cheaper deploys are settings, not other designs ([Cost switches](#cost-switches)).
- **Next:** the items in [TODO.md](../TODO.md), such as Guardrails on the model's output ([Known gaps](#known-gaps)).

## End to end

*(Diagram to come.)*

**A customer's claim**

1. The customer opens the portal: CloudFront serves it from a private S3 bucket, behind AWS WAF.
2. They sign in to the customers' Cognito user pool and get an ID token.
3. They submit a claim and a receipt: CloudFront forwards `/api/customer/*` to the `api` Lambda, running in the private subnets, which checks the token's issuer, audience and group, keeps the claim in Aurora DSQL and the receipt in S3.
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
| **Network** | A VPC with private subnets in two availability zones, VPC endpoints, one NAT gateway | The functions, the agent's runtime and the lookup programs run in private subnets with nothing coming in; AWS's services through eight interface endpoints (ECR, Logs, SSM, Bedrock's runtime and knowledge bases, AgentCore and its gateways) and free S3 and DynamoDB gateway endpoints; anything else through the NAT gateway, standing in for the platform's inspected egress; lookup programs reach only the endpoints | 36 |
| **Compute** | Lambda (`api`, `context`, `copilot`) | In the private subnets; each its own role inside the bootstrap's permissions boundary and a security group out only on HTTPS and PostgreSQL; the context server has no URL | 30, 34, 36 |
| **Agent** | AgentCore Runtime | In the private subnets (VPC mode); accepts only the `api`'s machine token, with SigV4 off; one session per task | 17, 33, 36 |
| **Tools** | AgentCore Gateway (two), AgentCore Policy | IAM for the agent and the handler's token for the Copilot; Cedar allow-lists in ENFORCE mode, so anything not permitted is denied | 34 |
| **Agent identity** | AgentCore Identity | A workload identity for each app (`api`, `agent`, `copilot`); the Anthropic key and the `api`'s client secret stay in the token vault | 33 |
| **AI safety** | Bedrock Guardrail | Customers' text is screened before any model reads it; a numbered version, so a change is a reviewed apply | 17 |
| **Model** | Claude on Bedrock (Australian inference profile) or the Anthropic API | The model decides and code pays: it can't reach a payment (decisions 4 and 18) | 3, 15 |
| **Search and memory** | Bedrock Knowledge Base on S3 Vectors, AgentCore Memory | Public policy wording only; memory is records the agent writes itself, so no model extracts anything from customers' words | 17 |
| **Data** | Aurora DSQL, DynamoDB, S3 (receipts) | IAM sign-in to DSQL, so no password exists; encrypted at rest; receipts private and TLS-only under random names | 30 |
| **Settings** | SSM Parameter Store (SecureString) | Written by script, so no value is in Terraform state | 30 |
| **Audit** | Bedrock model invocation logging, CloudWatch | Every Bedrock model call kept 30 days in a bucket only tear down can empty; alarms on errors and throttles, by email through SNS | 34 |
| **Delivery** | GitHub Actions with OIDC, Terraform per unit, ECR | No stored AWS keys; a read-only plan role on PRs, a deploy role only from `main`; scans and a cost estimate on every PR | 30, 32 |

To test locally, Docker Compose runs the same apps with PostgreSQL for DSQL, DynamoDB and Memory, a local stand-in for Cognito, and nginx for CloudFront.

## Platform boundary

### What the platform provides

In a regulated insurer, the secure enterprise patterns are expected to be in place already, managed at the organization level by a platform team. Every workload, this one included, inherits them:

- **Accounts:** AWS Organizations and Control Tower, with separate development, test, production, log-archive and security accounts.
- **Guardrails:** service and resource control policies: regions locked to Australia, nobody turns off CloudTrail, GuardDuty or Config, and data can't leave the organization.
- **People:** IAM Identity Center with the company's identity provider: MFA everywhere, least-privilege access, time-bound admin access, break-glass accounts, and no standing root credentials.
- **Keys and secrets:** AWS KMS customer-managed keys per data class, with rotation; Secrets Manager and AWS Private CA standards.
- **Network:** each workload's VPC, its private subnets and shared VPC endpoints, published as `/platform/network/*` parameters; central inspected egress through AWS Network Firewall (an outbound allow-list), Route 53 Resolver DNS Firewall, and VPC Flow Logs to the log-archive account.
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

In a real organization this code sits in the platform team's own landing-zone repo, such as one built on Landing Zone Accelerator on AWS or Account Factory for Terraform, deployed through their pipeline to every account. It's shown in this repo only for simplicity, so one repo deploys the whole picture to an account with no platform team. Each piece is kept apart from the workload's and switched off with a setting (decisions 35 and 36):

- **The bootstrap:** the workflows read only `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` and `TF_STATE_BUCKET`, so the platform's own pipeline roles and state bucket replace `bootstrap.yaml`.
- **The `platform` unit** (the network, budget alert and Access Analyzer): `PLATFORM_MANAGED=true` skips it, and the workload reads the platform's own `/platform/network/vpc-id` and `/platform/network/private-subnet-ids` instead (decision 36).
- **Staff sign-in:** point the `api`'s `STAFF_` and `ENGINEERING_TOKEN_ISSUER` and `_AUDIENCE` at the company's identity provider; the customer and services pools stay.
- **CloudFront's Free plan and its WAF:** `CLOUDFRONT_FREE_PLAN=false`, leaving Firewall Manager and Shield Advanced to the platform.
- **`check-aws.sh` and `teardown-aws.sh`:** account-level, so not run.

## Cost switches

The design above is the default. Each setting below, in `.env` before step 4 of [the runbook](02-aws-runbook.md), trades a piece of it for cost in `dev`, and changes nothing else:

| Setting | What it drops | Saves |
|---|---|---|
| `NETWORK_MODE=public` | The private network: the functions, agent runtime and lookup programs run on AWS's public network, still signed and authorized as above; lookup programs must then stay off (R24) | About $150 to $200 a month |
| `PLATFORM_MANAGED=true` | Nothing: the platform team's own network and account settings are used instead | The stand-in network's cost |
| `CLOUDFRONT_FREE_PLAN=false` | WAF on the apps, for an account that can't have CloudFront's Free plan (Firewall Manager's rules take over) | Nothing; the plan is free |

## Known gaps

What the workload would still add before real data, in [TODO.md](../TODO.md) and [the security trade-offs](04-security-trade-offs.md):

- **DSQL through its own endpoint**, not the NAT gateway.
- **Guardrails on the model's output**, not only customers' text.
- **AWS Backup for DSQL.**
- **A permissions audit:** the bootstrap is wide while building (decision 32), to be narrowed.
- **Observability and Evaluations** on AgentCore.
- **The agent's own call back to the `api`** uses a shared key; a machine token like the `api`'s is next.
