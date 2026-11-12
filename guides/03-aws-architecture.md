# AWS architecture

How UnderCover runs on AWS, as a regulated insurer would run it: one workload account in Sydney, serverless, with the platform team's controls around it. Deploy it with [the runbook](02-aws-runbook.md); why each choice was made is in [decisions.md](../docs/decisions.md), and the accepted risks in [the security trade-offs](04-security-trade-offs.md).

![UnderCover on AWS: customers, handlers and AI engineers sign in through Cognito and reach their apps through CloudFront and WAF; API Gateway checks each token before the api and copilot Lambdas in the platform's private subnets; the claim agent runs on AgentCore Runtime and reaches its tools only through Gateway under Cedar policy, with Claude, guardrails and the knowledge base on Bedrock; data in Aurora DSQL, S3, DynamoDB and AgentCore Memory; the platform team provides identity, network, logging, detection, backup and keys.](../docs/assets/aws-architecture.png)

## How a claim moves

The badges in the diagram.

**A customer's claim**

- **A1** The customer signs in to the customers' pool.
- **A2** The portal loads through CloudFront and WAF; API Gateway checks the customer's token.
- **A3** The api checks it again, saves the claim in Aurora DSQL and the receipt in S3.
- **A4** The api gets a machine token from AgentCore Identity.
- **A5** The agent screens the text with a guardrail, then Claude works the claim.
- **A6** It reaches the policy tools only through Gateway, under Cedar policy.
- **A7** It keeps the customer's history in AgentCore Memory, separate for each customer.
- **A8** It records its decision through API Gateway with its own machine token; the api checks limits and pays. Code pays, not the model.

**A handler's question**

- **B1** The handler signs in through the company's Okta.
- **B2** The dashboard calls the api and the copilot through API Gateway.
- **B3** The copilot checks the handler with the api, then searches through the staff Gateway with the handler's own token.
- **B4** Any action waits for the handler to confirm.

**An AI engineer's work**

- **C1** The AI engineer signs in to the engineers' pool and opens the console.
- **C2** Evaluations, improvement and the red team run on the same agent; AgentCore Evaluations also scores live sessions.

## Key controls

The numbered badges in the diagram.

1. Every call carries a token; API Gateway's WAF and authorizer check it, and the api checks it again.
2. Compute has no public URLs; AWS is reached through VPC endpoints and egress is inspected by the platform.
3. The agent reaches tools only through Gateway, under Cedar policy; the staff Gateway takes the handler's own token.
4. A separate model checks every claim for hidden instructions; a guardrail screens customer text, answers are checked for grounding and letters for personal data; Claude runs on Bedrock's Australian profile.
5. The model decides; code checks the limits and pays; large payouts wait for a handler, and payouts can be paused.
6. Every model call is logged; traces follow each claim; evaluations score live sessions; each customer's memory is kept apart.
7. Machine clients get short-lived tokens from AgentCore Identity; each function and the agent has its own role, inside a permissions boundary.
8. Code the agent writes runs in a sandbox that reaches VPC endpoints only, never the internet.
9. Each audience has its own pool; staff sign in through the company's Okta.

## What each part does

In the diagram's order:

- **Sign-in (Cognito):** a pool each for customers, handlers and AI engineers, so one audience's token never works for another; staff sign in with the company's Okta, by SAML; a services pool issues the apps' machine tokens.
- **Edge (CloudFront, WAF):** one site per app, served from private buckets; WAF rules and a rate limit in front.
- **API (API Gateway):** a regional REST API with its own WAF, so even a call that skips CloudFront meets the rules; it checks every token before a function runs, with throttling and access logs; the functions have no public URLs.
- **Backend (Lambda):** the api, which owns claims, payouts and limits and checks every token again; the copilot for handlers; and the context server, reachable only through Gateway.
- **VPC:** the functions and the agent run in private subnets, with nothing coming in; they reach AWS through VPC endpoints, and anything else through the platform's inspected egress.
- **Agent (AgentCore):** the claim agent on Runtime, which accepts only the api's machine token; Identity keeps the machine-client secrets; Gateway and the staff Gateway are the only way to the tools, under Cedar policy; Code Interpreter reaches the VPC endpoints only.
- **Models (Bedrock):** Claude on Australia's inference profile, so data stays in Australia; guardrails screen customers' text and check answers and letters before anyone sees them; the knowledge base holds the public policy wording.
- **Data:** Aurora DSQL for claims and payouts (IAM sign-in, no password, through its own endpoint); S3 for receipts, each scanned for malware; DynamoDB for agent and chat progress; AgentCore Memory for each customer's history. All encrypted at rest with the platform's key, and backed up by the platform.
- **Operate:** CloudWatch alarms by email, AgentCore Observability's trace of each claim, AgentCore Evaluations on live sessions, and a log of every model call as the workload's AI audit trail.
- **Delivery:** GitHub Actions signs in with OIDC, plans on PRs and deploys only from `main`, through the platform's pipeline roles and state bucket.

To test a change before deploying, Docker Compose runs the same apps on a laptop.

## Settings

The diagram shows the recommended settings. Each piece is in the code, and a setting in `.env` decides whether it's deployed; the defaults keep cost down.

| Setting | Default (cost-optimized) | Recommended | What it adds | Cost |
|---|---|---|---|---|
| `NETWORK_MODE` | `public` | `private` | Private subnets and VPC endpoints | ~$165–220/month |
| `API_GATEWAY` | `false` | `true` | A REST API with its own WAF and token checks; no function URLs | ~$3.50/million requests + ~$10/month WAF |
| `EVALUATION_SAMPLING` | `0` | `10` | Live sessions scored by judges | Cents a day |
| `CLOUDFRONT_FREE_PLAN` | `true` | `false`, with the platform's Firewall Manager | Central WAF and Shield Advanced in place of the Free plan's | The platform's |
| `ENCRYPTION_KEYS` | `aws` | `platform` | The platform's KMS key on every data store, the settings and the logs | ~$0.03 per 10,000 requests |
| `DOMAIN_NAME` | Empty | The company's domain | The sites on the company's own names, with certificates | ~$0.50/month |
| `MALWARE_SCANNING` | `false` | `true` | Every receipt scanned; only clean ones can be read | ~$0.60/GB scanned |
| `LOG_MASKING` | `false` | `true` | Personal data and secrets masked in the functions' logs | ~$0.12/GB scanned |
| `DATABASE_APP_ROLE` | `false` | `true` | The api serves requests through a database role that can't change the schema | Free |

With the defaults, CloudFront calls the functions' URLs and the api checks every token itself; staff sign in to their own pool, as the company's Okta sign-in (B1) is reference code that isn't switched on.

## What the platform team provides

Everything in the diagram's bottom band is the platform team's: accounts and guardrails, Identity Center for access to AWS, logging, detection, keys, backup and cost controls. The workload builds none of it; it uses these parts:

| From the platform | Used for |
|---|---|
| Pipeline roles and state bucket (`bootstrap.yaml` stands in for them) | Every deploy |
| The VPC, its endpoints and egress, published as `/platform/network/vpc-id` and `/platform/network/private-subnet-ids` | `NETWORK_MODE=private` |
| A backup policy that selects the tag `Backup=daily` | The DSQL cluster, both DynamoDB tables and the receipts bucket |
| A KMS data key, published as `/platform/kms/data-key-arn`, whose key policy lets the workload's roles and services use it | `ENCRYPTION_KEYS=platform` |
| A Route 53 zone for the company's domain, delegated to this account | `DOMAIN_NAME` |
| CloudWatch Transaction Search | Traces and online evaluations |
| Firewall Manager's WAF and Shield Advanced | `CLOUDFRONT_FREE_PLAN=false` |
| API Gateway's logging role, one per account | `API_GATEWAY=true` access logs |
| The company's Okta, with a SAML app for staff (the identity team's) | `STAFF_SAML_METADATA_URL` (reference only) |
