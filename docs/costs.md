# Costs

Approximate monthly figures, by tier.

## Tier 1, local

1. Claude through the Anthropic API: the only cost, driven by tokens per claim and how often dispatches and evaluations run. A full evaluation and an improvement round cost the most. Cut it with token limits (code-standards 19), prompt caching, Claude Haiku for the hidden-instruction check and the judge, and the five tiny claims for quick runs.
2. Each improvement round has its own spending limit, and the Anthropic Console's spend limit caps the key.
3. The judge grades each evaluated claim on Claude Haiku, about $0.002 a claim ($0.05 for all 25). A dispatch costs what its claims do, 2 to 4 cents each (about $0.50 to $1 for the seeded queue), and takes only the claims waiting when it starts.
3a. The Copilot (Claude Sonnet) shows each turn's steps, time and cost under its answer, about a cent a question; 25 model calls a turn at most. Similar claims, the success criteria, the Live page and feedback are worked out in code and cost nothing. The Live page shows the average cost and time per live claim, and Settings holds a round's spending limit ($0.50 to $10).

## Tier 2, AWS cost-optimised

4. Serverless (decision 13): Lambda, AgentCore and Bedrock are paid per use and Supabase's free tier holds the database, so `dev` costs about $2 a month idle and about $10 with demo use, and can stay up. Bedrock tokens are the main cost.
5. `dev` budget: under $20 a month, watched by the account's AWS Budgets.
6. Each PR that changes `aws/` gets a cost comment: the monthly estimate, the change and the top drivers, each with a saving where one applies. It warns above the `MONTHLY_COST_LIMIT` variable and excludes usage, such as model tokens and data transfer.

## Tier 3, AWS enterprise pattern *(planned)*

7. EKS (decision 13): the control plane, nodes in two zones, NAT gateways, a load balancer with WAF and Multi-AZ PostgreSQL run all the time, so about $400 a month before Claude, whether used or not.
