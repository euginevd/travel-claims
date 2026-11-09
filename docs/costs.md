# Costs

Approximate monthly figures, by stage.

## Stage 1, local

1. Claude through the Anthropic API: the only cost, driven by tokens per claim and how often dispatches and evaluations run. A full evaluation and an improvement round cost the most. Cut it with token limits (code-standards 19), prompt caching, Claude Haiku for the hidden-instruction check and the judge, and the five tiny claims for quick runs.
2. Each improvement round has its own spending limit, and the Anthropic Console's spend limit caps the key.

## Stage 2, AWS *(planned)*

3. Serverless (decision 13): Lambda, AgentCore and Bedrock are paid per use and Supabase's free tier holds the database, so `dev` costs close to $0 idle and can stay up. Bedrock tokens are the main cost.
4. `dev` budget: under $20 a month, watched by the account's AWS Budgets.
5. Each PR that changes `aws/` gets a cost comment: the monthly estimate, the change and the top drivers, each with a saving where one applies. It warns above the `MONTHLY_COST_LIMIT` variable and excludes usage, such as model tokens and data transfer.
