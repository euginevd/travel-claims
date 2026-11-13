# AWS architecture

How UnderCover runs on AWS as a regulated insurer would run it: one serverless workload account in Sydney, inside the platform team's controls. Deploy: [the runbook](02-aws-runbook.md). Why: [decisions.md](../docs/decisions.md). Accepted risks: [the trade-offs](04-security-trade-offs.md). Threats: [the threat model](../docs/threat-model.md). Cost: [costs.md](../docs/costs.md).

![UnderCover on AWS: customers, handlers and AI engineers sign in through Cognito and reach their apps through CloudFront and WAF; API Gateway checks each token before the api and copilot Lambdas in the platform's private subnets; the claim agent runs on AgentCore Runtime and reaches its tools only through Gateway under Cedar policy, with Claude, guardrails and the knowledge base on Bedrock; data in Aurora DSQL, S3, DynamoDB and AgentCore Memory; the platform team provides identity, network, logging, detection, backup and keys.](../docs/assets/aws-architecture.png)

## How a claim moves

The lettered badges in the diagram.

| Step | What happens |
|:-:|---|
| A1 | The customer signs in to the customers' pool. |
| A2 | The portal loads through CloudFront and WAF; API Gateway checks the token. |
| A3 | The api checks it again, saves the claim in Aurora DSQL and the receipt in S3. |
| A4 | The api gets a machine token from AgentCore Identity. |
| A5 | The agent screens the text with a guardrail, then Claude works the claim. |
| A6 | It reaches the policy tools only through Gateway, under Cedar policy. |
| A7 | It keeps each customer's history apart in AgentCore Memory. |
| A8 | It records its decision with its own token; the api checks limits and pays. Code pays, not the model. |
| B1 | The handler signs in through the company's Okta. |
| B2 | The dashboard calls the api and the copilot through API Gateway. |
| B3 | The copilot checks the handler with the api, then searches through the staff Gateway with the handler's token. |
| B4 | Any action waits for the handler to confirm. |
| C1 | The AI engineer signs in to the engineers' pool and opens the console. |
| C2 | Evaluations, improvement and the red team run on the same agent; AgentCore Evaluations scores live sessions. |

## Key controls

The numbered badges in the diagram.

1. Every call carries a token: API Gateway's WAF and authorizer check it, and the api checks it again.
2. Compute has no public URLs. AWS is reached through VPC endpoints; other egress is inspected by the platform.
3. The agent reaches tools only through Gateway, under Cedar policy; the staff Gateway takes the handler's own token.
4. A separate model checks each claim for hidden instructions, and Textract turns receipts into fields. Guardrails screen customer text, check answers for grounding (with Automated Reasoning) and letters for personal data.
5. The model decides; code checks limits and pays. Large payouts wait for a handler, and payouts can be paused.
6. Every model call is logged and every claim traced. Live sessions are scored, memory is kept per customer, and logs are masked.
7. Machine clients get short-lived tokens from AgentCore Identity. Each function and the agent has its own role inside a permissions boundary.
8. Code the agent writes runs in a sandbox that reaches VPC endpoints only.
9. Each audience has its own Cognito pool; staff sign in through the company's Okta.
10. Data is encrypted with the platform's key and backed up by the platform. Uploads are scanned for malware, and the api uses its own database role.

## What each part does

| Part | Role |
|---|---|
| Sign-in (Cognito) | A pool each for customers, handlers and engineers, so one audience's token never works for another. A services pool issues machine tokens; staff use Okta by SAML. |
| Edge (CloudFront, WAF) | One site per app on the company's domain, from private buckets, with WAF rules and a rate limit. |
| API (API Gateway) | A regional REST API with its own WAF, checking every token before a function runs. Throttling and access logs; functions have no public URLs. |
| Backend (Lambda) | The api owns claims, payouts and limits. The copilot serves handlers; the context server is reachable only through Gateway. |
| VPC | Functions and the agent in private subnets with nothing coming in. VPC endpoints for AWS, the platform's inspected egress for the rest. |
| Agent (AgentCore) | The claim agent on Runtime, accepting only the api's machine token. Identity holds client secrets; Gateway is the only way to tools; Code Interpreter reaches endpoints only. |
| Models (Bedrock) | Claude on Australia's inference profile, guardrails and Automated Reasoning. Textract reads receipts in Sydney; the knowledge base holds the public policy wording. |
| Data | Aurora DSQL (IAM sign-in) for claims and payouts, S3 for receipts, DynamoDB for progress, AgentCore Memory per customer. Encrypted with the platform's key and backed up by the platform. |
| Operate | CloudWatch logs with personal data masked, email alarms, a trace per claim, live evaluations. A log of every model call is the AI audit trail. |
| Delivery | GitHub Actions with OIDC: plans on PRs, deploys only from `main`, through the platform's pipeline roles and state bucket. |

Docker Compose runs the same apps on a laptop to test a change before deploying.

## Settings

The diagram shows the recommended settings. Every piece is in the code; a setting in `.env` decides whether it's deployed, and the defaults keep cost down. Costs in full: [costs.md](../docs/costs.md).

| Setting | Default | Recommended | What it adds | Cost |
|---|---|---|---|---|
| `NETWORK_MODE` | `public` | `private` | Private subnets and VPC endpoints | ~$165–220/month |
| `API_GATEWAY` | `false` | `true` | A REST API with its own WAF; no function URLs | ~$3.50/million requests + ~$10/month |
| `EVALUATION_SAMPLING` | `0` | `10` | Live sessions scored by judges | Cents a day |
| `CLOUDFRONT_WAF` | `off` | `on` | The platform's Firewall Manager WAF policy on the four sites | The platform's |
| `ENCRYPTION_KEYS` | `aws` | `platform` | The platform's KMS key on data, settings and logs | ~$0.03 per 10,000 requests |
| `DOMAIN_NAME` | Empty | The company's domain | Sites on the company's names, with certificates | ~$0.50/month |
| `MALWARE_SCANNING` | `false` | `true` | Every receipt scanned; only clean ones read | ~$0.60/GB |
| `LOG_MASKING` | `false` | `true` | Personal data and secrets masked in logs | ~$0.12/GB |
| `DATABASE_APP_ROLE` | `false` | `true` | Requests served by a role that can't change the schema | Free |

With the defaults, CloudFront calls the function URLs and the api checks every token itself. Staff use their own pool, since the Okta sign-in (B1) is reference code that isn't switched on.

## What the platform team provides

The diagram's bottom band: accounts, guardrails, Identity Center, logging, detection, keys, backup and cost controls. The workload builds none of it and uses:

| From the platform | Used for |
|---|---|
| Pipeline roles and state bucket (`bootstrap.yaml` stands in) | Every deploy |
| VPC, endpoints and egress: `/platform/network/vpc-id`, `/platform/network/private-subnet-ids` | `NETWORK_MODE=private` |
| A backup policy on the tag `Backup=daily` | DSQL, both DynamoDB tables, the receipts bucket |
| A KMS data key: `/platform/kms/data-key-arn` | `ENCRYPTION_KEYS=platform` |
| A Route 53 zone delegated to this account | `DOMAIN_NAME` |
| CloudWatch Transaction Search | Traces and live evaluations |
| A Firewall Manager CloudFront policy on the tag `FirewallManager=cloudfront-waf`, ID at `/platform/waf/cloudfront-policy-id`; Shield Advanced | `CLOUDFRONT_WAF=on` |
| API Gateway's logging role, one per account | `API_GATEWAY=true` access logs |
| The company's Okta, with a SAML app for staff | `STAFF_SAML_METADATA_URL` (reference only) |
