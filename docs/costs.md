# Costs

Approximate figures in US dollars. Measured spend beats these: check Cost Explorer the day after a deploy (AGENTS.md rule 19).

## Locally (Docker)

1. Claude tokens are the only cost: 2 to 4 cents a claim, about a cent a Copilot question.
2. The judge grades on Claude Haiku, about $0.002 a claim ($0.05 for 25). A dispatch of the seeded queue is about $0.50 to $1.
3. Limits: each improvement round's spending limit ($0.50 to $10, in Settings), 25 model calls per Copilot turn, and the Anthropic Console's spend limit on the key.
4. Similar claims, success criteria, the Live page and feedback are worked out in code and cost nothing.

## On AWS

5. Everything is paid per use or free, except the private network. Budget for `dev`: under $20 a month, or about $250 while the private network is up. The bootstrap's `MonthlyBudgetUsd` (default $20) emails `BudgetEmail` at 80% spent, 100% forecast and 100% spent.

| Item | Idle | In use | Setting |
|---|---|---|---|
| Default build | about $1 to $2 a month | plus the rows below | defaults |
| AgentCore Runtime | $0 | **about $3 to $6 a day of demo use**: each agent task holds a session open (finding 7) | always on |
| Claude tokens | $0 | 2 to 4 cents a claim | always on |
| ECR images, secrets, logs | about $0.10 to $0.20 for images, $0.40 a secret, cents for logs | the same | always on |
| Agent identity, tool policy, audit logs | $0 | cents a month | always on |
| Budget alert | $0 | $0: an account's first two budgets are free | always on (bootstrap) |
| `quality` workflow | $0 | about $0.05 a tiny run with the red team; a whole run is 2 to 4 cents a claim | by hand only |
| Receipts (Textract) | $0 | about $0.01 a page | default |
| Output guardrail, Automated Reasoning | $0 | cents a day | always on |
| Private network: DSQL endpoint | about $15 to $20 a month | the same | `NETWORK_MODE=private` (off) |
| Private network: VPC and endpoints | the platform's, about $150 to $200 a month | the same | `NETWORK_MODE=private` (off) |
| API Gateway and its WAF | about $10 a month | plus $3.50 and $0.60 per million requests | `API_GATEWAY` (off) |
| Online evaluations | $0 | cents a day at 10% | `EVALUATION_SAMPLING` (0, off) |
| Platform KMS key, domain, malware scan, log masking | $0.50 a month for a hosted zone | about $0.03 per 10,000 key requests, $0.60 per GB scanned, $0.12 per GB of logs masked | each off unless set |
| CloudFront WAF | $0 | the platform's | `CLOUDFRONT_WAF` (off) |

6. The platform team pays for its shared controls, so they aren't in this bill: Firewall Manager, Shield Advanced, GuardDuty, Security Hub, Config, CloudTrail, KMS keys, backups, Transaction Search and Control Tower.
7. Each PR that changes `infra/aws/` gets an Infracost comment. It warns above `MONTHLY_COST_LIMIT` but excludes usage such as tokens and data transfer.
