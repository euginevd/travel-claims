# To do

1. Deploy to AWS (~1 to 1.5 h, you run it, after the PR merges): the bootstrap stack, `bash scripts/use-anthropic.sh` (Claude through your API key first; `use-bedrock.sh` later), then `bash scripts/deploy-aws.sh apply`, which runs unattended ([guide](guides/02-aws-runbook.md)).
2. Smoke check (~15 min): the schema builds on DSQL, every health check passes through CloudFront, one claim is worked, and agent identity works: the api reaches the runtime with its machine token, the Copilot's policy lookups pass the handler-only gateway, and both gateways reach the context server by ARN with AgentCore Policy allowing each lookup (decision 33). Model calls appear in the model-logs bucket once on Bedrock; and, on the default settings, the agent's calls back use its machine token and an output guardrail stops an ungrounded answer (decision 38). The recommended settings (private network, API Gateway, online evaluations, Identity Center) and the platform's reference code aren't deployed or tested here (decisions 39 and 40).
3. Switch to Claude on Bedrock only (~15 min, you run it): `bash scripts/use-bedrock.sh` once `check-aws.sh` shows Claude `OK`, so data stays in Australia and no third-party key is left.
4. IAM Identity Center for your own sign-in (~15 min, console only, free): MFA, instead of the root or an admin user.
5. Bedrock Managed Knowledge Base through a Gateway connector (~2 h, $5 per GB a month): optional, in place of S3 Vectors.
6. Delete the whole stack, when you've finished testing (~45 min): the deploy guide's step 7, `bash scripts/deploy-aws.sh destroy`, then `scripts/teardown-aws.sh` in CloudShell until it prints `Clean`.
7. Permissions audit (~1 h), once every feature is built and deployed: narrow the bootstrap's deploy role, plan role and boundary to the actions the units and apps actually call (CloudTrail's event history and IAM Access Analyzer's policy generation show them), drop the AI and workflow services left unused, and remove the Checkov skips that cover the width ([decision 32](docs/decisions.md)).

## Notes

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

**Fully AWS-native** ([decisions 30 and 36](docs/decisions.md)). Managed and serverless, cost-optimized by default (close to $0 idle), with the private network and the rest of the design deployed by settings. Everything stays in `ap-southeast-2`, and Claude is called only through Bedrock. Anything that costs money just by existing is swapped for a free alternative, and the paid, more secure option is recorded in decision 30. Prototype, built for speed: no plan doc, and tests only where the checks need them to pass (the 80% coverage gate stays). Nothing deploys while building: the `aws` workflow skips while `PROJECT_NAME` is unset. Commit after each step; push when you say.

Built on the `aws-native` branch, one commit per step. Left: about 1.5 hours to get it up (steps 1 and 2), plus 45 minutes to delete it. Idle cost is a few cents a month (images, logs and stored data); Bedrock, DSQL, Lambda and AgentCore are paid per use.

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
| CloudFront flat-rate Free plan: WAF and DDoS protection, three sites | `web` | Free | **New** |
| CloudWatch alarms, SNS email, AWS Budgets alert, IAM Access Analyzer; CloudTrail event history | `monitoring` | Free | **New** |

Left out for cost, with the paid option recorded in decision 30: a paid WAF, GuardDuty, Security Hub, AWS Config, a CloudTrail trail, customer-managed KMS keys, a VPC with PrivateLink and Control Tower.
