# AWS runbook

The AWS build from nothing to running in `dev`, the only environment (decision 31), and back: about 1.5 hours to deploy, 45 minutes to tear down. What it builds and why: [the AWS architecture](03-aws-architecture.md).

**Cost:** about $1 to $2 a month idle with the default settings ([costs](../docs/costs.md)); the recommended ones add about $165 to $220 a month, mostly the private network. About $3 to $6 a day in use, mostly AgentCore Runtime ([findings 7](01-findings.md)); $0 after tear down.

## How it fits together

| Part | What it does |
|---|---|
| Bootstrap | CloudFormation you deploy once: GitHub's keyless sign-in, the state bucket, plan, deploy and read-only troubleshoot roles, and a boundary on every Terraform role. |
| GitHub | Variables and secrets: the roles, bucket and Claude the workflows use, and the switch that turns deploys on. |
| `aws` workflow | Ten Terraform units in `infra/aws/`, planned with the plan role and applied with the deploy role, from `main` only. |
| `images` workflow | The four app images into ECR, and the web apps into S3. |

Scripts run on your machine (with `gh`) or pasted into CloudShell; the AWS work runs in GitHub Actions. One unit at any time: `gh workflow run aws.yml -f target=dev -f unit=<unit>` (add `-f action=destroy` to remove it).

## 1. Merge the branch

The workflows deploy only from `main`, and only once step 4 switches deploys on.

## 2. Check the account (1 minute)

Paste [scripts/check-aws.sh](../scripts/check-aws.sh) into AWS CloudShell in Sydney (under $0.001). Success means:

1. The account plan is `PAID ACTIVE`.
2. Titan Text Embeddings V2 answers (needed now).
3. Claude Haiku and Sonnet 5.5 answer (needed only for [Bedrock](#switching-to-claude-on-bedrock)).
4. After step 3, IAM Access Analyzer finds no `ERROR` or unknown action in the bootstrap. A `SECURITY_WARNING` on the wide statements is expected (decision 32).

## 3. Deploy the bootstrap (3 minutes)

1. In the CloudFormation console in Sydney, create a stack named `travel-claims-bootstrap` from `infra/aws/bootstrap/bootstrap.yaml`, keeping every default except `BudgetEmail`, the address for the account's budget alerts (rule 28: always set it; confirm the email AWS sends).
2. A stack made before decision 36 needs **Update stack** with the new template.
3. Paste `check-aws.sh` again.

## 4. Set up GitHub (1 minute)

1. Put these in `.env` (git-ignored):
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`: already there for local testing.
   - `TF_STATE_BUCKET`, `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`: the stack's **Outputs**, not needed if the AWS CLI is signed in. Their names are fixed: `travel-claims-tfstate-<account>`, `travel-claims-github-plan`, `travel-claims-github-deploy`.
   - Optional settings, such as `ALERT_EMAIL`, `CLOUDFRONT_WAF`, `NETWORK_MODE` and `API_GATEWAY`: see [the architecture guide's settings](03-aws-architecture.md#settings). The platform team's pieces are assumed (decision 41).
2. Run `bash scripts/use-anthropic.sh`. It prints no value and sets, under the repo's **Settings**:

   | Where | What |
   |---|---|
   | Environments > `aws-dev-plan` | The state bucket and plan role. |
   | Environments > `aws-dev-apply` | The state bucket, deploy role, and the Anthropic key and workspace (secrets). |
   | Secrets and variables > Actions > Variables | `MODEL_PROVIDER`, the optional settings, and `PROJECT_NAME` last, which switches deploys on. |

3. Missing environments are created: `aws-dev-plan` with no rules, `aws-dev-apply` from `main` only with no reviewer (AGENTS.md rule 26). You still see each PR's plan and cost before merging.
4. Success: `gh variable list` and `gh secret list --env aws-dev-apply` show the names.

## 5. Deploy (about an hour)

```bash
bash scripts/deploy-aws.sh apply
```

It runs each workflow in turn and waits, because each unit reads what earlier ones made:

| # | Run | Makes |
|---|---|---|
| 1 | `registry` | ECR repositories for the four app images. |
| 2 | `secrets` | A Parameter Store SecureString for the apps' settings; the Anthropic key in AgentCore Identity's vault. |
| 3 | `database` | Aurora DSQL for records; DynamoDB tables for agent checkpoints and Copilot chats. |
| 4 | `storage` | An S3 bucket for receipts. |
| 5 | `identity` | Cognito pools for customers, handlers, AI engineers and services; AgentCore workload identities. |
| 6 | `guardrail` | Bedrock Guardrails on customers' text and on the model's answers and letters. |
| 7 | `images` | Builds the four app images and pushes them to ECR. |
| 8 | `functions` | Lambda functions: the api, the context server and the Copilot. |
| 9 | `agent` | AgentCore Runtime, two Gateways with Policy allow-lists, Memory, and a Knowledge Base on S3 Vectors. |
| 10 | `web` | S3 and CloudFront for the four websites. |
| 11 | `monitoring` | CloudWatch alarms, an SNS email topic, and model invocation logging. |
| 12 | `images` | Uploads the web apps to S3, now that their sites exist. |

1. If a run fails, the script stops: fix it, run that unit alone, then the rest.
2. If `ALERT_EMAIL` is set, confirm the email AWS sends.
3. The script is needed only from nothing (first deploy, or after tear down), because a merge plans every unit at once and later units fail on what doesn't exist yet. After that, merges deploy on their own.

## 6. Smoke check (15 minutes)

1. List the sites:
   ```bash
   aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'travel-claims')].[Comment,DomainName]" --output text
   ```
2. Open the project page and each app, and sign in with **Use test account**.
3. Make a claim in the portal and watch the agent work it in the dashboard.
4. If anything fails, read the Lambda logs, starting with `/aws/lambda/travel-claims-dev-api`. The api builds the schema on first start, so the first page may fail once; reload after a minute.

Proven on AWS on 2026-11-12 with the default settings. If a step fails, check `AGENTS.md`'s known mistakes 38 to 49 first, then record anything new in [01-findings.md](01-findings.md).

## 7. Tear down (about 45 minutes)

Removes everything in AWS. The code, repo and GitHub environments stay, so steps 3 to 5 bring it back.

1. On your machine: `bash scripts/deploy-aws.sh destroy`. It removes the units, last made first, then `PROJECT_NAME`. If a run fails, fix it, destroy that unit alone, then run it again. With `NETWORK_MODE=private`, destroy `agent` again later: AgentCore keeps its network interfaces for up to 8 hours.
2. In CloudShell: paste [scripts/teardown-aws.sh](../scripts/teardown-aws.sh). Success prints `Clean but the bootstrap`; `LEFT` lists what remains. CloudFront takes up to 15 minutes, so paste it again if only CloudFront is left.
3. The agent confirms the account is empty through its read-only troubleshoot role.
4. Last, in CloudShell: paste [scripts/teardown-bootstrap.sh](../scripts/teardown-bootstrap.sh). It deletes the state bucket, the CLI user's key and the bootstrap stack, and prints `Clean` or `LEFT`. It stops if another repo's roles use its GitHub sign-in.

## Switching to Claude on Bedrock

Once step 2 shows Claude `OK`, run `bash scripts/use-bedrock.sh`. On a deployed setup it also applies `secrets`, `functions` and `agent`, so the apps call Bedrock. `use-anthropic.sh` switches back.

## Letting an agent troubleshoot

The bootstrap's `travel-claims-troubleshoot` role has AWS's `ReadOnlyAccess` and can't change anything (decision 46). Its `travel-claims-cli` user can only assume that role.

1. In CloudShell: paste [scripts/cli-key.sh](../scripts/cli-key.sh). It replaces the user's access key and prints three lines.
2. Paste those lines into your own terminal, not an agent's chat; then `clear` CloudShell.
3. Add the role's profile to `~/.aws/config`:

```ini
[profile travel-claims-troubleshoot]
role_arn = arn:aws:iam::<account id>:role/travel-claims-troubleshoot
source_profile = travel-claims-cli
region = ap-southeast-2
```

4. Check it with `aws sts get-caller-identity --profile travel-claims-troubleshoot`, then tell the agent the profile's name. Sessions last an hour; tear down deletes the key, the user and the role.
