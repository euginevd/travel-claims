# To do

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

1. Bound the Live and similar-claims queries, which read every decision (the review of #72). About 15 to 20 minutes.
2. Success criteria: read the current version's latest held-out run, not any version's; and split the Scoreboard's trend lines by set. About 30 to 45 minutes.
3. Try live: the Copilot's lock held in the database, the hold when the approval limit is lowered after an approval (both 2026-11-11, untested), a send-back through the real agent, and a restart mid-claim. About 30 minutes, by hand.
4. Browser tests in CI, and an automated accessibility check. About 1 to 2 hours.
5. Put a claim added to the evaluation set into the tiny sets, with its receipts, so improvement rounds use it. About 1 to 2 hours.
6. The 2026-11-11 additions aren't deployed to tier 2 ([guide 03](guides/03-aws-cleanup.md#redeploying)). First, have the Copilot's context lookups sign for AgentCore Gateway, or they fail there. About 2 to 3 hours, and AWS cost.
7. Tier 2: an automatic sweep for stalled claims (today a handler's **Retry**), and code execution once a VPC-mode interpreter is in place (threat model R24). Half a day or more, and AWS cost.
8. Tier 3: the same apps on EKS in private subnets, with WAF, Multi-AZ PostgreSQL in Australia and admission control (spec 5, decision 6). Weeks.
