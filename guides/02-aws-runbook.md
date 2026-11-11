# AWS runbook

Tier 2 from nothing to running in `dev`, the only environment (decision 31), and back to nothing: about an hour and a half to deploy and 45 minutes to tear down, mostly waiting. Why it's built this way: decisions 30 to 35. Compared with local: [What's deployed](#whats-deployed).

**Cost:** cents idle; about $3 to $6 a day in use, mostly AgentCore Runtime ([findings 7](01-findings.md)); $0 after tear down.

## How it fits together

- **Bootstrap** (CloudFormation, deployed once by you): GitHub's sign-in to AWS without stored keys, the Terraform state bucket, a read-only plan role, a deploy role, and a boundary every Terraform role stays inside.
- **GitHub** (variables and secrets): which roles, bucket and Claude the workflows use, and the switch that turns deploys on.
- **The `aws` workflow**: eleven Terraform units in `infra/aws/`, planned with the plan role and applied with the deploy role, only from `main`.
- **The `images` workflow**: the four app images into ECR, and the web apps into S3.

Scripts run on your machine (with `gh`) or in CloudShell (pasted); the AWS work itself runs in GitHub Actions. One unit at any time: `gh workflow run aws.yml -f target=dev -f unit=<unit>` (add `-f action=destroy` to remove it).

## 1. Merge the branch

The workflows deploy only from `main`, and only once step 4 switches deploys on.

## 2. Check the account (1 minute)

Paste [scripts/check-aws.sh](../scripts/check-aws.sh) into AWS CloudShell in Sydney (under $0.001). It checks:

- the account plan is `PAID ACTIVE`;
- Titan Text Embeddings V2 answers (needed now);
- Claude Haiku and Sonnet 5.5 answer (needed only for [Bedrock](#switching-to-claude-on-bedrock));
- after step 3, the bootstrap's IAM policies, with IAM Access Analyzer: an `ERROR` or unknown action needs fixing; a `SECURITY_WARNING` on the wide statements is expected (decision 32).

## 3. Deploy the bootstrap (3 minutes)

In the CloudFormation console in Sydney, create a stack named `travel-claims-bootstrap` from `infra/aws/bootstrap/bootstrap.yaml`, keeping every default (`GitHubRepo` and `GitHubIds` already point at this repo). It already grants every service tier 2 uses and the paid options in decision 30, so it's deployed once. Then paste `check-aws.sh` again.

## 4. Set up GitHub (1 minute)

Put these in `.env` (git-ignored):

- `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`: already there for tier 1.
- `TF_STATE_BUCKET`, `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`: the stack's **Outputs** (not needed if the AWS CLI is signed in). The names are fixed, so they survive a redeploy: `travel-claims-tfstate-<account>`, `travel-claims-github-plan`, `travel-claims-github-deploy`.
- Optional: `ALERT_EMAIL`, `MONTHLY_BUDGET` (default 10), `CLOUDFRONT_FREE_PLAN=false` if the account can't have CloudFront's Free plan, and `PLATFORM_MANAGED=true` if a platform team already runs the account-wide budget and Access Analyzer (the `platform` unit is then skipped).

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
| 3 | `database` | Amazon Aurora DSQL for the records; Amazon DynamoDB tables for agent checkpoints and Copilot chats |
| 4 | `storage` | An Amazon S3 bucket for customers' receipts |
| 5 | `identity` | Amazon Cognito user pools for customers, handlers and AI engineers, with test accounts, and a services pool for the api's machine sign-in; AgentCore Identity's workload identities and token vault |
| 6 | `guardrail` | An Amazon Bedrock Guardrail on customers' text |
| 7 | `images` | A workflow, not a unit: builds the four app images and pushes them to Amazon ECR |
| 8 | `functions` | AWS Lambda functions: the api, the context server and the Copilot |
| 9 | `agent` | Amazon Bedrock AgentCore Runtime (the claim agent), two AgentCore Gateways (tools: IAM for the agent, handlers' tokens for the Copilot) with AgentCore Policy allow-lists, AgentCore Memory (customer memory) and a Bedrock Knowledge Base on S3 Vectors (policy search) |
| 10 | `web` | Amazon S3 and Amazon CloudFront for the four websites; AWS WAF on the three apps, through CloudFront's Free plan |
| 11 | `monitoring` | Amazon CloudWatch alarms on the functions, an Amazon SNS email topic, and Bedrock model invocation logging to S3 |
| 12 | `platform` | Account-wide settings: an AWS Budgets alert and IAM Access Analyzer; skipped with `PLATFORM_MANAGED=true` |
| 13 | `images` | The workflow again: uploads the web apps to S3, now that their sites exist |

If a run fails, the script stops: fix it, run that unit alone, then the rest. If `ALERT_EMAIL` is set, confirm the email AWS sends.

**Why a script, not just a merge:** a merge plans every unit at once, so from nothing the later units fail on what doesn't exist yet. The script is needed only from nothing (the first deploy, and after a tear down); between those, merges deploy on their own. It's the smallest change, over one Terraform root (a rebuild, with images needed mid-apply) and a layered workflow (a larger workflow change), which would replace it if deploys from nothing become frequent.

## 6. Smoke check (15 minutes)

1. List the sites:
   ```bash
   aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'travel-claims')].[Comment,DomainName]" --output text
   ```
2. Open the project page and each app, and sign in with **Use test account**.
3. Make a claim in the portal, and watch the agent work it in the dashboard.
4. If anything fails, read the Lambda logs in CloudWatch, starting with `/aws/lambda/travel-claims-dev-api`: the api builds the database's schema on its first start.

Not yet proven on AWS, so check these first: the schema builds on DSQL and claims save (the api's log); the api reaches the agent with its machine token, the Copilot's policy lookups pass its handler-only gateway, and the gateways reach the context server by ARN with AgentCore Policy allowing each tool call (decisions 33 and 34); the agent resumes a claim and the Copilot keeps a conversation (DynamoDB); a receipt uploads through WAF; and `check-aws.sh` shows the bootstrap's policies `OK`. Once they pass, record what was found in [01-findings.md](01-findings.md).

## 7. Tear down (about 45 minutes)

Removes everything tier 2 put in AWS. The code, the repo and its GitHub environments stay (free), so steps 3 to 5 bring it back.

1. On your machine: `bash scripts/deploy-aws.sh destroy`. It removes the units, last made first, then `PROJECT_NAME`, so the workflows skip AWS. If a run fails, it stops: fix it, destroy that unit alone, then run it again.
2. In CloudShell: paste [scripts/teardown-aws.sh](../scripts/teardown-aws.sh). It empties and deletes the state bucket, the bootstrap, leftover `travel-claims` buckets, the `cf-templates-*` buckets the console makes for uploaded templates, and AgentCore's log groups, then prints `Clean` or `LEFT` with what's still there. CloudFront takes up to 15 minutes, so paste it again if only CloudFront is left. It stops before deleting the bootstrap if another repo's roles use its GitHub sign-in.

## Switching to Claude on Bedrock

Once step 2's script shows Claude `OK`, run `bash scripts/use-bedrock.sh`. On a deployed setup it also applies the `secrets`, `functions` and `agent` units, so the apps call Bedrock and the Anthropic key leaves the token vault. `use-anthropic.sh` switches back the same way.

## What's deployed

Each AWS component in a word, and what plays its part locally; the apps and features are the same as `docker compose up`.

| In a word | AWS component | What it does here | Local (Docker) |
|---|---|---|---|
| **Websites** | S3 and CloudFront | Hosts the four sites (project page, portal, dashboard, console) and forwards each app's `/api/` paths | nginx in each web app's container |
| **Firewall** | AWS WAF, through CloudFront's Free plan | Three managed rule sets and a rate limit per IP (4 of the plan's 5 rules) on the three apps, one plan each: an account's limit of 3. Each plan covers 1 million requests and 100 GB a month | none |
| **Backend** | Lambda (`api`, `context`, `copilot`) | The api, the context server and the Copilot, from the same images | Containers |
| **Agent** | AgentCore Runtime | Runs the claim agent, evaluations, improvement and the red team | The `agent` container |
| **Tool gateway** | AgentCore Gateway (two) | The only way to the context server's tools (MCP): one signed with IAM for the agent and lookup programs, one that takes a handler's own token for the Copilot. Each invokes the context server by its ARN, so it has no URL | A direct call to the context container |
| **Tool rules** | AgentCore Policy | Cedar allow-lists checked before every tool call: the agent may use all seven lookups, the Copilot only the two document ones; anything else is denied | none |
| **Memory** | AgentCore Memory | What the agent remembers of each customer | PostgreSQL |
| **Sandbox** | AgentCore Code Interpreter | Lookup programs, off unless `CODE_EXECUTION=true` | none |
| **Model** | Bedrock (or the Anthropic API) | Claude, chosen by `MODEL_PROVIDER` | The Anthropic API |
| **Screening** | Bedrock Guardrail | Checks customers' text before any model reads it | The app's own check only |
| **Search** | Bedrock Knowledge Base with S3 Vectors | Finds the policy wording for Wattle AI | The context server |
| **Database** | Aurora DSQL | Claims, decisions, payments and everything else the api keeps | PostgreSQL |
| **Checkpoints** | DynamoDB | Each claim's and conversation's saved progress, and the Copilot's notes | PostgreSQL |
| **Files** | S3 (receipts) | Customers' receipts, private and encrypted | A Docker volume |
| **Sign-in** | Cognito (four user pools) | Customers, handlers and AI engineers, each separately, and a services pool whose only client is the api, for its machine token | A local stand-in issuing the same tokens |
| **Agent identity** | AgentCore Identity | Each app's workload identity; the token vault keeps the Anthropic key and the api's client secret, and hands out the key and the api's machine token, which the agent's runtime checks | The agent's shared key and `.env` |
| **Settings** | SSM Parameter Store | The apps' settings and the agent's key, read at start; the Anthropic key is in the token vault | `.env` |
| **Images** | ECR | The four app images the backend and agent run | Local Docker images |
| **Alarms** | CloudWatch and SNS | Emails on errors and throttles | none |
| **AI audit** | Bedrock model invocation logging | Every Bedrock model call, prompt and answer, kept 30 days in a bucket only tear down can empty (not the Anthropic API's calls) | none |
| **Access** | IAM, through the bootstrap | GitHub's sign-in, the plan and deploy roles, and the boundary on every role | none |
| **State** | S3 (Terraform state) | What Terraform has built, so it changes only what differs | none |

## Enterprise pattern

In a regulated insurer, the secure enterprise patterns are expected to be in place already, managed at the organization level by a platform team. Every workload, this one included, inherits them, and a gap there is fixed at that layer, not in this repo:

- **Accounts:** AWS Organizations and Control Tower, with separate development, test, production, log-archive and security accounts.
- **Guardrails:** service and resource control policies: regions locked to Australia, nobody turns off CloudTrail, GuardDuty or Config, and data can't leave the organization.
- **People:** IAM Identity Center with the company's identity provider: MFA everywhere, least-privilege access, time-bound admin access, break-glass accounts, and no standing root credentials.
- **Keys and secrets:** AWS KMS customer-managed keys per data class, with rotation; Secrets Manager and AWS Private CA standards.
- **Network:** central inspected egress through AWS Network Firewall (an outbound allow-list) and Route 53 Resolver DNS Firewall.
- **Edge:** AWS Firewall Manager rules on every WAF, and Shield Advanced.
- **Logging:** an organization CloudTrail trail to the log-archive account with S3 Object Lock, into the company's SIEM, kept for the regulated period.
- **Detection:** Amazon GuardDuty (including Bedrock and AgentCore), AWS Security Hub, AWS Config, Amazon Inspector, Amazon Macie and IAM Access Analyzer: threat detection, one view of findings, drift checks, vulnerability scans, personal-data discovery and unused access.
- **Response:** a 24/7 incident team and tested runbooks.
- **Backup and resilience:** AWS Backup organization policies with Vault Lock, copies in another account and region, and recovery targets for critical operations.
- **Compliance:** evidence through AWS Audit Manager and AWS Artifact for APRA CPS 234 (information security), CPS 230 (operational risk, including the model provider as a material service provider) and the Privacy Act.
- **Cost:** AWS Budgets, Cost Anomaly Detection and tag policies per workload.
- **Delivery:** a second reviewer on every change and production deploy, signed images with an SBOM, and a pen test before go-live.

What this repo builds that a platform team would own, and how each is left to them (decision 35):

- **The bootstrap:** the workflows read only `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` and `TF_STATE_BUCKET`, so the platform's own pipeline roles and state bucket replace `bootstrap.yaml`.
- **The `platform` unit** (budget alert, Access Analyzer): `PLATFORM_MANAGED=true` skips it. Model invocation logging stays with the workload, agreed with the platform team in a shared account.
- **Staff sign-in:** point the api's `STAFF_` and `ENGINEERING_TOKEN_ISSUER` and `_AUDIENCE` at the company's identity provider; the customer and services pools stay.
- **CloudFront's Free plan and its WAF:** `CLOUDFRONT_FREE_PLAN=false`, leaving Firewall Manager and Shield Advanced to the platform.
- **`check-aws.sh` and `teardown-aws.sh`:** account-level, so not run.
