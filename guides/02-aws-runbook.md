# AWS runbook

The AWS build from nothing to running in `dev`, the only environment (decision 31), and back to nothing: about an hour and a half to deploy and 45 minutes to tear down, mostly waiting. What it builds and why: [the AWS architecture](03-aws-architecture.md).

**Cost:** cents idle with the default, cost-optimized settings; the recommended ones (the [architecture guide's settings](03-aws-architecture.md#settings)) add about $165 to $220 a month while up, mostly the private network; about $3 to $6 a day in use, mostly AgentCore Runtime ([findings 7](01-findings.md)); $0 after tear down.

## How it fits together

- **Bootstrap** (CloudFormation, deployed once by you): GitHub's sign-in to AWS without stored keys, the Terraform state bucket, a read-only plan role, a deploy role, and a boundary every Terraform role stays inside.
- **GitHub** (variables and secrets): which roles, bucket and Claude the workflows use, and the switch that turns deploys on.
- **The `aws` workflow**: ten Terraform units in `infra/aws/`, planned with the plan role and applied with the deploy role, only from `main`.
- **The `images` workflow**: the four app images into ECR, and the web apps into S3.

Scripts run on your machine (with `gh`) or in CloudShell (pasted); the AWS work itself runs in GitHub Actions. One unit at any time: `gh workflow run aws.yml -f target=dev -f unit=<unit>` (add `-f action=destroy` to remove it).

## 1. Merge the branch

The workflows deploy only from `main`, and only once step 4 switches deploys on.

## 2. Check the account (1 minute)

Paste [scripts/check-aws.sh](../scripts/check-aws.sh) into AWS CloudShell in Sydney (under $0.001). It checks:

- the account plan is `PAID ACTIVE`;
- no CloudFront Free plans are in use yet, since the build takes all three an account can have (otherwise set `CLOUDFRONT_FREE_PLAN=false`);
- Titan Text Embeddings V2 answers (needed now);
- Claude Haiku and Sonnet 5.5 answer (needed only for [Bedrock](#switching-to-claude-on-bedrock));
- after step 3, the bootstrap's IAM policies, with IAM Access Analyzer: an `ERROR` or unknown action needs fixing; a `SECURITY_WARNING` on the wide statements is expected (decision 32).

## 3. Deploy the bootstrap (3 minutes)

In the CloudFormation console in Sydney, create a stack named `travel-claims-bootstrap` from `infra/aws/bootstrap/bootstrap.yaml`, keeping every default (`GitHubRepo` and `GitHubIds` already point at this repo). It grants every service the build uses, the private network included (decision 36), and the paid options in decision 30, so it's deployed once; a stack made before decision 36 needs **Update stack** with the new template. Then paste `check-aws.sh` again.

## 4. Set up GitHub (1 minute)

Put these in `.env` (git-ignored):

- `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`: already there for testing locally.
- `TF_STATE_BUCKET`, `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`: the stack's **Outputs** (not needed if the AWS CLI is signed in). The names are fixed, so they survive a redeploy: `travel-claims-tfstate-<account>`, `travel-claims-github-plan`, `travel-claims-github-deploy`.
- Optional: `ALERT_EMAIL` for the alarms, `CLOUDFRONT_FREE_PLAN=false` if the account can't have CloudFront's Free plan, `NETWORK_MODE=private` for the platform team's private network, `EVALUATION_SAMPLING` for the share of live agent sessions scored online (default 0, off; 10 recommended), and `API_GATEWAY=true` to put the api and Copilot behind API Gateway (decision 39). The platform team's pieces, such as the budget, backups and Transaction Search, are assumed (decision 41).

Then run `bash scripts/use-anthropic.sh`. It prints no value, and sets, under the repo's **Settings**:

| Where | What |
|---|---|
| Environments > `aws-dev-plan` | the state bucket and plan role |
| Environments > `aws-dev-apply` | the state bucket, deploy role, and the Anthropic key and workspace (secrets) |
| Secrets and variables > Actions > Variables | `MODEL_PROVIDER`, the optional settings, and `PROJECT_NAME` last, which switches deploys on |

It makes the two environments if they're missing: `aws-dev-plan` with no rules, and `aws-dev-apply` from `main` only with no reviewer, so `dev` applies unattended (AGENTS.md rule 24); you still see each PR's plan and cost before merging. `gh variable list` and `gh secret list --env aws-dev-apply` show the names.

## 5. Deploy (about an hour)

```bash
bash scripts/deploy-aws.sh apply
```

It runs each workflow in turn and waits for it, in this order, because each unit reads what the earlier ones made:

| # | Run | Makes |
|---|---|---|
| 1 | `registry` | Amazon ECR repositories for the four app images |
| 2 | `secrets` | An AWS Systems Manager Parameter Store SecureString for the apps' settings; the Anthropic key in AgentCore Identity's token vault |
| 3 | `database` | Amazon Aurora DSQL for the records (through its own endpoint with `NETWORK_MODE=private`), tagged for the platform's backups; Amazon DynamoDB tables for agent checkpoints and Copilot chats |
| 4 | `storage` | An Amazon S3 bucket for customers' receipts |
| 5 | `identity` | Amazon Cognito user pools for customers, handlers and AI engineers, with test accounts, and a services pool for the api's machine sign-in; AgentCore Identity's workload identities and token vault |
| 6 | `guardrail` | Amazon Bedrock Guardrails: one on customers' text, and two on the model's output (answers checked for grounding, letters for personal data) |
| 7 | `images` | A workflow, not a unit: builds the four app images and pushes them to Amazon ECR |
| 8 | `functions` | AWS Lambda functions (in the platform's private subnets with `NETWORK_MODE=private`): the api, the context server and the Copilot |
| 9 | `agent` | Amazon Bedrock AgentCore Runtime (the claim agent; in the private subnets with `NETWORK_MODE=private`), two AgentCore Gateways (tools: IAM for the agent, handlers' tokens for the Copilot) with AgentCore Policy allow-lists, AgentCore Memory (customer memory) and a Bedrock Knowledge Base on S3 Vectors (policy search) |
| 10 | `web` | Amazon S3 and Amazon CloudFront for the four websites; AWS WAF on the three apps, through CloudFront's Free plan |
| 11 | `monitoring` | Amazon CloudWatch alarms on the functions, an Amazon SNS email topic, and Bedrock model invocation logging to S3 |
| 12 | `images` | The workflow again: uploads the web apps to S3, now that their sites exist |

If a run fails, the script stops: fix it, run that unit alone, then the rest. If `ALERT_EMAIL` is set, confirm the email AWS sends.

**Why a script, not just a merge:** a merge plans every unit at once, so from nothing the later units fail on what doesn't exist yet. The script is needed only from nothing (the first deploy, and after a tear down); between those, merges deploy on their own. It's the smallest change, over one Terraform root (a rebuild, with images needed mid-apply) and a layered workflow (a larger workflow change), which would replace it if deploys from nothing become frequent.

## 6. Smoke check (15 minutes)

1. List the sites:
   ```bash
   aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'travel-claims')].[Comment,DomainName]" --output text
   ```
2. Open the project page and each app, and sign in with **Use test account**.
3. Make a claim in the portal, and watch the agent work it in the dashboard.
4. If anything fails, read the Lambda logs in CloudWatch, starting with `/aws/lambda/travel-claims-dev-api`: the api builds the database's schema on its first start, which can take a minute, so the first page or sign-in may fail once; reload after a minute.

Not yet proven on AWS, so check these first: the schema builds on DSQL and claims save (the api's log); the api reaches the agent with its machine token, the Copilot's policy lookups pass its handler-only gateway, and the gateways reach the context server by ARN with AgentCore Policy allowing each tool call (decisions 33 and 34); the agent's calls back carry its machine token and the output guardrail answers (decision 38); the agent resumes a claim and the Copilot keeps a conversation (DynamoDB); a receipt uploads through WAF; and `check-aws.sh` shows the bootstrap's policies `OK`. Once they pass, record what was found in [01-findings.md](01-findings.md).

## 7. Tear down (about 45 minutes)

Removes everything the build put in AWS. The code, the repo and its GitHub environments stay (free), so steps 3 to 5 bring it back.

1. On your machine: `bash scripts/deploy-aws.sh destroy`. It removes the units, last made first, then `PROJECT_NAME`, so the workflows skip AWS. If a run fails, it stops: fix it, destroy that unit alone, then run it again. With `NETWORK_MODE=private`, AgentCore keeps its network interfaces for up to 8 hours after the agent goes, so the agent's security group may not delete at once: destroy `agent` again later.
2. In CloudShell: paste [scripts/teardown-aws.sh](../scripts/teardown-aws.sh). It empties and deletes the state bucket, the bootstrap, leftover `travel-claims` buckets, the bootstrap template the console uploaded to a `cf-templates-*` bucket (and that bucket, if nothing else is in it), and AgentCore's log groups, then prints `Clean` or `LEFT` with what's still there. CloudFront takes up to 15 minutes, so paste it again if only CloudFront is left. It stops before deleting the bootstrap if another repo's roles use its GitHub sign-in.

## Switching to Claude on Bedrock

Once step 2's script shows Claude `OK`, run `bash scripts/use-bedrock.sh`. On a deployed setup it also applies the `secrets`, `functions` and `agent` units, so the apps call Bedrock and the Anthropic key leaves the token vault. `use-anthropic.sh` switches back the same way.
