<div align="center">

# travel-claims

**UnderCover: AI agents decide routine travel insurance claims in minutes, so handlers spend their time only on claims that need judgement.**

<img src="https://img.shields.io/badge/Claude-D97757?style=flat-square&logo=anthropic&logoColor=white" alt="Claude">
<img src="https://img.shields.io/badge/LangGraph-1C3C3C?style=flat-square&logo=langchain&logoColor=white" alt="LangGraph">
<img src="https://img.shields.io/badge/AWS-FF9900?style=flat-square" alt="AWS">
<img src="https://img.shields.io/badge/Terraform-7B42BC?style=flat-square&logo=terraform&logoColor=white" alt="Terraform">
<img src="https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white" alt="GitHub Actions">
<img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
<img src="https://img.shields.io/badge/uv-DE5FE9?style=flat-square&logo=uv&logoColor=white" alt="uv">
<img src="https://img.shields.io/badge/Trivy-1904DA?style=flat-square&logo=trivy&logoColor=white" alt="Trivy">

[Quick start](#quick-start) · [What you get](#what-you-get) · [Built with](#built-with) · [Guides](#guides)

<br>

<img src="docs/assets/undercover-tour.gif" width="880" alt="A tour of the three apps: a customer makes a claim in the portal, a handler reads the agent's case brief and recommendation in the dashboard, and an AI engineer checks the agent in the assurance console.">

</div>

> Based on the UnderCover project from Ed Donner's AI FDE course ([ed-donner/undercover](https://github.com/ed-donner/undercover)), including its fictional sample data. Built with a secure agentic SDLC from [sdlc-template](https://github.com/euginevd/sdlc-template).

## Quick start

1. Install Docker Desktop and [uv](https://docs.astral.sh/uv/), then clone the repo and run `bash scripts/setup.sh`.
2. Copy `.env.example` to `.env`, and add an Anthropic API key with its workspace ID.
3. `docker compose up --build -d`, then open the project page at http://127.0.0.1:5172: a card for each app, live numbers, a five-minute script and the architecture. **Use test account** signs you in on each app:

   | App | Address | Test account |
   |-----|---------|--------------|
   | Customer portal | http://127.0.0.1:5173 | Oliver Grant |
   | Handlers' workspace | http://127.0.0.1:5174 | Dana Whitfield, senior handler |
   | AI assurance console | http://127.0.0.1:5175 | Sam Carter, AI engineer |
4. Make a claim with the sample receipts in [data/sample-receipts](data/sample-receipts): a delayed bag and a taxi in Nairobi, a clinic invoice in Sri Lanka, and `04-injection-test-mara-lodge.png`, which hides an instruction to the AI that the hidden-instruction check should catch.
5. Browser tests: in [e2e](e2e), `npm run stack`, then `npm test` ([status.md](docs/status.md) 14a).

Each claim costs 2 to 4 cents of Claude. On AWS, the pipeline deploys the same apps ([status.md](docs/status.md), tier 2).

## What you get

| | |
|---|---|
| **Customers** | Make a claim in three steps (what happened, receipts, check what the AI drafted, your words stay the record); claim a delayed flight in one tap; follow it on a tracker with every email and text under **Updates**; get paid to your PayID; ask **Wattle AI** about your policy, with the wording cited; ask a person to review any decision |
| **Handlers** | The queue opens on what needs them; a case brief with the agent's recommendation, a checklist with sources and the payout line by line; approvals under $1,000 pay automatically, larger ones wait for sign-off, send-back or an override with a reason; AI drafts the customer's letter; **Retry** carries on a claim the agent stopped working; a senior handler can pause every payout |
| **AI engineers** | A separate assurance console: evaluations against handlers' decisions, the improver's proposals kept only if they score better and the red team holds, and the red team's eight attacks mapped to the OWASP Top 10 for LLMs |
| **Security** | A hidden-instruction check and a Bedrock guardrail before any model reads a claim; payments and limits in code, never in a prompt; separate sign-ins and token audiences per app; a [threat model](docs/threat-model.md) with every control |

<img src="docs/assets/dashboard-claim.webp" width="880" alt="A claim in the handlers' dashboard: the stage tracker, the agent's referral with its reason, the evidence, and the recommendation citing the policy wording and claims manual.">

```mermaid
flowchart LR
  customer([Customers])
  handler([Handlers])
  engineer([AI engineers])

  portal["<b>portal</b><br/>make claims"]
  dashboard["<b>dashboard</b><br/>review claims"]
  console["<b>console</b><br/>evaluate the agent"]
  api["<b>api</b><br/>claims, payments"]
  copilot["<b>copilot</b><br/>chat agent"]
  agent["<b>agent</b><br/>claim agent"]
  context["<b>context</b><br/>policy wording"]
  data[("PostgreSQL<br/>and receipts")]
  claude{{"Claude"}}

  customer --> portal --> api
  handler --> dashboard --> api
  engineer --> console --> api
  dashboard --> copilot --> api
  api -->|decide| agent
  agent -->|lookups| context
  agent --> claude
  copilot --> claude
  api --> data

  classDef person fill:#fef3c7,stroke:#d97706,color:#1f2937
  classDef app fill:#dbeafe,stroke:#2563eb,color:#1f2937
  classDef ai fill:#fde8df,stroke:#d97757,color:#1f2937
  classDef store fill:#dcfce7,stroke:#16a34a,color:#1f2937
  classDef external fill:#f3f4f6,stroke:#6b7280,color:#1f2937,stroke-dasharray:4 3

  class customer,handler,engineer person
  class portal,dashboard,console,api,context app
  class agent,copilot ai
  class data store
  class claude external
```

| App | What | Runs on (tier 2) |
|-----|------|------------------|
| `portal` | Customers make and track claims | S3 and CloudFront |
| `dashboard` | Handlers work the queue, ask customers for documents and sign off payouts | S3 and CloudFront |
| `console` | AI assurance: evaluations and improvements (quality), the red team (security) | S3 and CloudFront |
| `home` | The project page | S3 and CloudFront |
| `api` | Claims, decisions, payments, settings and sign-in | Lambda |
| `agent` | Claim agent with a hidden-instruction check and specialists, dispatcher, improver and drafting assistant | AgentCore Runtime |
| `copilot` | The handlers' chat agent | Lambda |
| `context` | Policy wording, claims manual and reference data as an MCP server | Lambda, behind AgentCore Gateway |

The same apps run three ways (decision 14). Rough monthly cost in USD:

| Tier | Runs on | Status | Cost a month |
|------|---------|--------|-------------:|
| 1 · Local | Docker Compose on a laptop, Claude through the Anthropic API | Complete | Tokens only |
| 2 · AWS cost-optimised | Serverless: S3 and CloudFront, Lambda, AgentCore (Runtime, Gateway, Memory), a Bedrock Knowledge Base and guardrail, Cognito, Supabase | Complete | ≈ $10 (≈ $2 idle) |
| 3 · AWS enterprise pattern | EKS in private subnets, WAF, Multi-AZ PostgreSQL, Bedrock | Planned | ≈ $400 before Claude |

Tier 2 is mostly free tiers and pay-per-use, so it can stay up; Supabase's free project pauses after a week without use. Details: [costs.md](docs/costs.md).

## Built with

| Tool | What it does here | Where |
|------|-------------------|-------|
| Claude (Sonnet, Haiku) | Decides claims, checks for hidden instructions, drafts, answers questions | [apps/agent](apps/agent/), [apps/copilot](apps/copilot/) |
| LangGraph | The claim agent and the Copilot, with progress saved after every step | [apps/agent](apps/agent/) |
| MCP | The context layer's seven lookups | [apps/context](apps/context/) |
| FastAPI, PostgreSQL | The api, its rules and payments; Supabase on AWS | [apps/api](apps/api/) |
| React, Vite | The portal, dashboard and console | [apps/](apps/) |
| AgentCore | Runtime for the agent, Gateway in front of the context layer, Memory for customers | [aws/agent](aws/agent/) |
| Bedrock | The guardrail, the Knowledge Base on S3 Vectors, and Claude when `MODEL_PROVIDER` is `bedrock` | [aws/agent](aws/agent/), [aws/guardrail](aws/guardrail/) |
| Terraform | AWS infrastructure, one root per unit | [aws/](aws/) |
| GitHub Actions | App checks, security scans, images, Terraform plan and apply | [.github/workflows/](.github/workflows/) |
| Python, uv | Apps, scripts and one locked workspace | [pyproject.toml](pyproject.toml) |
| Semgrep, CodeQL | Static analysis | [security.yml](.github/workflows/security.yml), [codeql.yml](.github/workflows/codeql.yml) |
| Gitleaks | Secrets in code and history | [scan.sh](scripts/scan.sh) |
| Trivy, Checkov | Vulnerable packages, images and IaC misconfiguration | [security.yml](.github/workflows/security.yml) |
| Infracost | Cost of each Terraform change, as a PR comment | [aws.yml](.github/workflows/aws.yml) |
| Playwright | Browser tests across the apps | [e2e](e2e/) |
| Lefthook, Dependabot | The pre-push scan; weekly package updates | [lefthook.yml](lefthook.yml), [dependabot.yml](.github/dependabot.yml) |

## Guides

1. [Findings](guides/01-findings.md): what the build found, and what was fixed.
2. [Security trade-offs](guides/02-security-trade-offs.md): the risks this project accepts, and the fix for production.
3. [Cleaning up AWS](guides/03-aws-cleanup.md): remove everything from AWS so nothing is charged, and prove it.

Developers start with [AGENTS.md](AGENTS.md), then [docs/](docs/); tiers and what done means are in [spec.md](docs/spec.md). To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md); report vulnerabilities through [SECURITY.md](SECURITY.md).
