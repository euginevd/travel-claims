# AWS architecture

UnderCover as a regulated insurer would run it on AWS, deployed here to `dev` on made-up data (decisions 31 and 37). Docker runs the same apps on a laptop only to test a change before it's deployed.

Deploy and tear down: [the runbook](02-aws-runbook.md). Why: decisions 30 to 39. Cost: [costs.md](../docs/costs.md). Risks: [threat-model.md](../docs/threat-model.md) and [the security trade-offs](04-security-trade-offs.md).

## At a glance

- **One account, one region:** Sydney (`ap-southeast-2`); every service managed and serverless.
- **Private in the design:** the code runs in private subnets and reaches AWS through VPC endpoints; the cost-optimized default skips the network ([Settings](#settings)).
- **Two owners:** the workload builds its apps and their controls; the platform team's controls are assumed in place ([Platform boundary](#platform-boundary)).
- **Every control is in the code:** whether a piece is deployed is a setting, chosen for its cost ([Settings](#settings)).

## End to end

*(Diagram to come.)*

**A customer makes a claim**

1. The portal loads from a private S3 bucket through CloudFront, behind AWS WAF.
2. The customer signs in to the customers' Cognito pool.
3. CloudFront sends `/api/customer/*` to the `api` Lambda, which checks the token, keeps the claim in Aurora DSQL (through DSQL's own endpoint) and the receipt in S3.
4. The `api` gets a machine token from AgentCore Identity and starts the agent on AgentCore Runtime, which accepts only that token.
5. The agent screens the customer's text with a Bedrock guardrail, then works the claim with Claude, saving each step in DynamoDB.
6. It looks up the policy through AgentCore Gateway; AgentCore Policy allows each tool call before the gateway invokes the context Lambda.
7. It remembers the customer in AgentCore Memory, one namespace per customer.
8. It records its decision with the `api`, using its own machine token. The `api` checks the approval limit and the kill switch, and code, not the model, pays (decision 4).

**A handler asks the Copilot**

1. The handler signs in to the dashboard through the handlers' pool.
2. The Copilot Lambda checks the handler with the `api`.
3. It looks up documents through a second gateway that takes the handler's own token; AgentCore Policy allows only `search_documents` and `read_section`.
4. A sign-off, send-back or dispatch waits for the handler to confirm (decision 24).

**An AI engineer checks the agent**

The console, through the engineers' pool, runs evaluations, improvement and the red team. Online, AgentCore Evaluations also scores a sample of live sessions from their traces.

## By layer

| Layer | AWS | How it's secured |
|---|---|---|
| **Edge** | CloudFront and S3, one distribution per site | Buckets read only by CloudFront; TLS only, security headers and HSTS; the api never cached |
| **API** | API Gateway HTTP API (`API_GATEWAY=true`) | JWT authorizers check each audience's token before a function runs; throttling and access logs; the functions then have no URLs |
| **Firewall** | AWS WAF, on CloudFront's Free plan | Three managed rule sets and a rate limit per IP on each app |
| **Network** | The platform's VPC: private subnets in two zones, VPC endpoints, inspected egress | With `NETWORK_MODE=private`, the code runs in the platform's private subnets with its own security groups (nothing in); AWS's services through the platform's endpoints and DSQL through its own |
| **Compute** | Lambda: `api`, `context`, `copilot` | In the private subnets; a role each inside the permissions boundary; the context server has no URL |
| **Agent** | AgentCore Runtime | In the private subnets; accepts only the `api`'s machine token |
| **Lookup programs** | AgentCore Code Interpreter (off unless `CODE_EXECUTION=true`) | Reaches only the VPC endpoints, never the internet (R24) |
| **Tools** | AgentCore Gateway (two), AgentCore Policy | IAM for the agent, the handler's token for the Copilot; Cedar allow-lists deny anything not permitted |
| **Sign-in** | Cognito, four pools | Customers, handlers and engineers each in their own pool; a services pool for the apps' machine tokens |
| **Agent identity** | AgentCore Identity | A workload identity per app; the Anthropic key and both machine clients' secrets stay in the token vault; no shared key on AWS |
| **AI safety** | Bedrock Guardrails | Customers' text screened before any model reads it; answers checked for grounding and letters for personal data before anyone sees them, failing closed |
| **Model** | Claude on Bedrock (Australian profile) or the Anthropic API | The model decides; code pays |
| **Search and memory** | Bedrock Knowledge Base on S3 Vectors, AgentCore Memory | Public policy wording only; memory holds only what the agent writes itself |
| **Data** | Aurora DSQL, DynamoDB, S3 | IAM sign-in to DSQL (no password), through its own endpoint; encrypted at rest; backed up daily |
| **Settings** | SSM Parameter Store | Written by script, so no value is in Terraform state |
| **Observability** | AgentCore Observability, CloudWatch | Each claim's trace across the agent, tools and models; alarms by email |
| **Audit** | Bedrock model invocation logging | Every Bedrock call kept 30 days in a bucket only tear down can empty |
| **Evaluations** | AgentCore Evaluations | Built-in judges score a sample of live sessions (`EVALUATION_SAMPLING`) |
| **Delivery** | GitHub Actions with OIDC, Terraform per unit, ECR | No stored AWS keys; a read-only plan role on PRs; deploys only from `main`; scans and a cost estimate on every PR |

To test locally, Docker Compose stands in for each: PostgreSQL for DSQL, DynamoDB and Memory, a sign-in stand-in for Cognito, nginx for CloudFront.

## Platform boundary

### What the platform team provides

A regulated insurer's platform team runs these for every account, and a gap in them is fixed at that layer, not in this repo.

- **Accounts:** AWS Organizations and Control Tower; separate development, test, production, log-archive and security accounts.
- **Guardrails:** service and resource control policies: Australian regions only, logging and detection can't be turned off, data can't leave the organization.
- **People:** IAM Identity Center with the company's identity provider, MFA, least privilege, time-bound admin and break-glass accounts.
- **Keys:** AWS KMS customer-managed keys per data class, rotated.
- **Network:** each workload's VPC, private subnets and endpoints; central inspected egress (AWS Network Firewall, DNS Firewall); VPC Flow Logs.
- **Edge:** Firewall Manager rules on every WAF, and Shield Advanced.
- **Logging:** an organization CloudTrail trail to the log-archive account, locked, into the company's SIEM.
- **Detection:** GuardDuty (including Bedrock and AgentCore), Security Hub, Config, Inspector, Macie and Access Analyzer.
- **Backup:** AWS Backup by tag, with Vault Lock and copies in another account and region.
- **Tracing:** CloudWatch Transaction Search, one setting per account.
- **Response:** a 24/7 incident team with tested runbooks.
- **Compliance:** evidence for APRA CPS 234 and CPS 230 and the Privacy Act, through Audit Manager and Artifact.
- **Cost:** Budgets, anomaly detection and tag policies.
- **Delivery:** a second reviewer on every change and every deploy beyond `dev`, signed images and a pen test before go-live.

### What the workload owns

Everything in [By layer](#by-layer), including its own security groups and the audit trail of its AI decisions (model invocation logging is one setting per account, so it's agreed with the platform team). The workload's DSQL cluster carries the tag `Backup=daily`, which the platform's backup plan selects.

### What the workload expects from the platform

The workload builds none of the platform's pieces; it consumes them, and each is used only where a setting needs it:

| The platform provides | The workload uses it for |
|---|---|
| Its pipeline roles and state bucket, in `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` and `TF_STATE_BUCKET` (`bootstrap.yaml` here stands in for them) | Every deploy |
| `/platform/network/vpc-id` and `/platform/network/private-subnet-ids`, with VPC endpoints and inspected egress | `NETWORK_MODE=private` |
| An AWS Backup policy that selects the tag `Backup=daily` | The DSQL cluster, which carries the tag |
| CloudWatch Transaction Search | Traces, and `EVALUATION_SAMPLING` |
| Firewall Manager's WAF and Shield Advanced on CloudFront | `CLOUDFRONT_FREE_PLAN=false` |
| An IAM Identity Center SAML app for staff | Reference code, never switched on here: `STAFF_SAML_METADATA_URL` federates the staff pools and the api accepts those sign-ins; the apps' sign-in pages don't change |
| Budgets, Access Analyzer, GuardDuty, Security Hub and the rest of the list above | Nothing in the code |

## Settings

Every piece above is in the code; these settings, in `.env` before step 4 of [the runbook](02-aws-runbook.md), decide what's deployed. The default is the cost-optimized one, for a `dev` demo on made-up data; the recommended one is the design, for an enterprise account or real data. This project deploys and tests only the defaults; the recommended settings are code that shows how each works, validated and scanned but not deployed.

| Setting | Default (cost-optimized) | Recommended | What it adds | Cost |
|---|---|---|---|---|
| `NETWORK_MODE` | `public` | `private` | Private subnets and VPC endpoints | ~$165–220/month |
| `API_GATEWAY` | `false` | `true` | Token checks at the gateway; no function URLs | ~$1/million requests |
| `EVALUATION_SAMPLING` | `0` | `10` | Live sessions scored by judges | Cents a day |
| `CLOUDFRONT_FREE_PLAN` | `true` | `false`, with the platform's Firewall Manager | Central WAF and Shield Advanced in place of the Free plan's | The platform's |

What's still accepted for `dev`, with the fix for real data, is in [the security trade-offs](04-security-trade-offs.md).
