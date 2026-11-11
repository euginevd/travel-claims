# To do

Ideas and tasks, numbered. The agent confirms with you before starting one and removes it when done.

1. Bound the Live and similar-claims queries, which read every decision (the review of #72).
2. A unique index on decision feedback (the review of #72).
3. Close the Copilot's HTTP clients on shutdown (the review of #72).
4. The 2026-11-11 additions aren't deployed to tier 2 ([guide 03](guides/03-aws-cleanup.md#redeploying)). First, have the Copilot's context lookups sign for AgentCore Gateway, or they fail there.
5. Tier 3: the same apps on EKS in private subnets, with WAF, Multi-AZ PostgreSQL in Australia and admission control (spec 5, decision 6).
6. Try live: the Copilot's lock held in the database, the hold when the approval limit is lowered after an approval (both 2026-11-11, untested), a send-back through the real agent, and a restart mid-claim.
7. Put a claim added to the evaluation set into the tiny sets, with its receipts, so improvement rounds use it.
8. Success criteria: read the current version's latest held-out run, not any version's; and split the Scoreboard's trend lines by set.
9. Browser tests in CI, and an automated accessibility check.
10. Tier 2: an automatic sweep for stalled claims (today a handler's **Retry**), and code execution once a VPC-mode interpreter is in place (threat model R24).
