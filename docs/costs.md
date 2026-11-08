# Costs

A worked example: `travel-claims` in `dev`. Optional: delete it if the project has little that costs money. Costs are approximate monthly figures.

## Resources

1. Claude on Bedrock: about $120, driven by tokens per claim. Cut it with token limits (code-standards 19), prompt caching and a smaller model for simple claims.
2. Lambda (`api`, `agent`): about $15, driven by claim volume. Cut it by right-sizing memory.
3. CloudWatch logs: about $15, driven by log volume. Cut it with 30-day retention and no debug logs in `prod`.
4. S3 and CloudFront (`web`, receipts): about $10, driven by receipt uploads. Cut it by expiring old receipt versions.
5. HTTP API: about $5, driven by requests. Throttling keeps floods from running up the bill.

## Budget and alerts

6. `dev` budget: $200 a month (spec 19). AWS Budgets emails the team at 80% and 100%.
7. `prod` budget: set after the first full month of real claims.
