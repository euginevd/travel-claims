# Costs

Approximate monthly figures, by tier.

## Tier 1, local (Docker)

1. Claude through the Anthropic API: the only cost, driven by tokens per claim and how often dispatches and evaluations run. A full evaluation and an improvement round cost the most. Cut it with token limits (code-standards 19), prompt caching, Claude Haiku for the hidden-instruction check and the judge, and the five tiny claims for quick runs.
2. Each improvement round has its own spending limit, and the Anthropic Console's spend limit caps the key.
3. The judge grades each evaluated claim on Claude Haiku, about $0.002 a claim ($0.05 for all 25). A dispatch costs what its claims do, 2 to 4 cents each (about $0.50 to $1 for the seeded queue), and takes only the claims waiting when it starts.
3a. The Copilot (Claude Sonnet) shows each turn's steps, time and cost under its answer, about a cent a question; 25 model calls a turn at most. Similar claims, the success criteria, the Live page and feedback are worked out in code and cost nothing. The Live page shows the average cost and time per live claim, and Settings holds a round's spending limit ($0.50 to $10).

## Tier 2, AWS serverless, cost-optimised

4. Serverless (decisions 13 and 30): everything is paid per use or free, so `dev` costs a few cents a month idle. In use, AgentCore Runtime is the main cost: about $3 to $6 a day of demo use (measured November 2026, findings 7), because each agent task holds a session open while it works, plus Claude tokens.
5. `dev` budget: under $20 a month, watched by the account's AWS Budgets.
6. Each PR that changes `infra/aws/` gets a cost comment: the monthly estimate, the change and the top drivers, each with a saving where one applies. It warns above the `MONTHLY_COST_LIMIT` variable and excludes usage, such as model tokens and data transfer.

## Tier 2, fully AWS-native (decision 30)

7. Close to $0 idle (AgentCore Runtime aside while in use, item 4): Aurora DSQL, DynamoDB, Lambda, AgentCore, Cognito and Bedrock are paid per use within free tiers; the app settings are a free SSM parameter; WAF and DDoS protection come with CloudFront's flat-rate Free plan on the three apps; alarms (six of the ten free), SNS email, the budget alert and IAM Access Analyzer are free. A few cents a month for images, logs and stored data, plus Bedrock tokens. Left out because they cost just by existing, each recorded in decision 30: a paid WAF, GuardDuty, Security Hub, AWS Config, a CloudTrail trail, customer-managed KMS keys, a VPC with PrivateLink and Control Tower (about $100 to $200 a month together).
8. Agent identity (decision 33): AgentCore Identity is free through Runtime and Gateway, and $0.010 per 1,000 token or key requests from the api's and Copilot's Lambdas; Cognito charges about $0.00225 per machine token (the US East rate), with no free tier, and the api reuses each for 50 minutes, so cents a month.
9. Tool rules and the model-call audit trail (decision 34): AgentCore Policy is $0.000025 per tool call checked; model invocation logs are a few cents of S3 a month, kept 30 days.
10. The platform unit's budget alert emails at 80% of `MONTHLY_BUDGET` (default $10) spent and at 100% forecast.
