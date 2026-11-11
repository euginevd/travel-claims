# To do

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

1. Build tier 2's secure target in code ([infra/aws/README.md](infra/aws/README.md) 12 to 19): a network unit (private subnets, VPC endpoints, one NAT gateway for the function URLs, which have no private endpoint), Aurora Serverless v2 with RDS Proxy in place of Supabase, Bedrock only, the Lambdas and AgentCore Runtime in the VPC, WAF on CloudFront, GuardDuty, Security Hub, CloudTrail and alarms, with the bootstrap's deploy role and the aws workflow updated to match. The landing zone (Control Tower) stays the account owner's, outside this repo. New AWS services and about $100 to $200 a month once deployed. About a day; test on AWS after.

## Parked for later

Kept, but not suggested or started until you move one back up.

*Nothing parked.*
