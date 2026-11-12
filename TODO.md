# To do

1. Switch to Claude on Bedrock only (~15 min, you run it, on the next deploy: the [guide](guides/02-aws-runbook.md)'s steps 3 to 6 bring the build back in about 1.5 h): `bash scripts/use-bedrock.sh` once `check-aws.sh` shows Claude `OK`, so data stays in Australia and no third-party key is left.
2. IAM Identity Center for your own sign-in (~15 min, console only, free): MFA, instead of the root or an admin user.
3. Bedrock Managed Knowledge Base through a Gateway connector (~2 h, $5 per GB a month): optional, in place of S3 Vectors.
4. Permissions audit (~1 h), once every feature is built and deployed: narrow the bootstrap's deploy role, plan role and boundary to the actions the units and apps actually call (CloudTrail's event history and IAM Access Analyzer's policy generation show them), drop the AI and workflow services left unused, and remove the Checkov skips that cover the width ([decision 32](docs/decisions.md)).

## Notes

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

**Fully AWS-native** ([decisions 30 and 36](docs/decisions.md)). Managed and serverless, cost-optimized by default (close to $0 idle), with the private network and the rest of the design deployed by settings. Everything stays in `ap-southeast-2`, and Claude is called only through Bedrock. Anything that costs money just by existing is swapped for a free alternative, and the paid, more secure option is recorded in decision 30. Prototype, built for speed: no plan doc, and tests only where the checks need them to pass (the 80% coverage gate stays). Nothing deploys while building: the `aws` workflow skips while `PROJECT_NAME` is unset. Commit after each step; push when you say.

Deployed to `dev` and checked by hand on 2026-11-12 (claims, sign-off, the Copilot, Textract receipts, Automated Reasoning answers), then torn down the same day: the account is empty, the bootstrap included. Idle cost is a few cents a month (images, logs and stored data); Bedrock, DSQL, Lambda and AgentCore are paid per use.

**AWS components**

| Component | Unit | Cost idle | Status |
|---|---|---|---|
| IAM: GitHub OIDC, plan and deploy roles, boundary; S3 Terraform state | `bootstrap` (CloudFormation, you deploy it) | Free | Change |
| ECR, the four images | `registry` | Cents | As built |
| SSM Parameter Store SecureString, the app's settings | `secrets` | Free | **New**: replaces Secrets Manager |
| Aurora DSQL, IAM sign-in | `database` | Free tier, then per use | **New**: replaces Supabase |
| DynamoDB on demand and an S3 bucket, the agent's checkpoints | `database` | Free tier | **New** |
| S3, receipts | `storage` | Cents | As built |
| Cognito, three user pools and test accounts | `identity` | Free tier | As built |
| Bedrock Guardrail | `guardrail` | Per use | As built |
| Lambda with IAM-only function URLs (`api`, `context`, `copilot`) | `functions` | Free tier | Change |
| AgentCore Runtime, Gateway, Memory, Knowledge Base with S3 Vectors | `agent` | Per use | Change |
| Bedrock, Claude Sonnet and Haiku (Australian profile) | `functions`, `agent` | Per use | Change: the only provider |
| S3 and CloudFront, the four sites | `web` | Free tier | As built |
| CloudFront WAF: off; on puts the sites in the platform's Firewall Manager policy (decision 51) | `web` | Free off; the platform's on | Change |
| CloudWatch alarms, SNS email, AWS Budgets alert, IAM Access Analyzer; CloudTrail event history | `monitoring` | Free | **New** |

Left out for cost, with the paid option recorded in decision 30: a paid WAF, GuardDuty, Security Hub, AWS Config, a CloudTrail trail, customer-managed KMS keys, a VPC with PrivateLink and Control Tower.
