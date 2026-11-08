# Costs

Approximate monthly figures, by stage.

## Stage 1, local

1. Claude through the Anthropic API: the only cost, driven by tokens per claim and how often dispatches and evaluations run. A full evaluation and an improvement round cost the most. Cut it with token limits (code-standards 19), prompt caching, Claude Haiku for the hidden-instruction check and the judge, and the five tiny claims for quick runs.
2. Each improvement round has its own spending limit, and the Anthropic Console's spend limit caps the key.

## Stage 2, AWS *(planned)*

3. Estimated before stage 2 starts. EKS, its nodes, NAT and the load balancer cost money even when idle, so `dev` is torn down when not in use.
4. `dev` budget: $200 a month. AWS Budgets emails at 80% and 100%.
