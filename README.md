<div align="center">

# travel-claims

**UnderCover: AI agents decide routine travel insurance claims in minutes, so handlers spend their time only on claims that need judgement.**

![Claude](https://img.shields.io/badge/Claude-Agents-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Agents-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-OIDC-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Planned-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)

[Customers](#-customers) · [Handlers](#️-handlers) · [AI engineers](#-ai-engineers) · [Apps](#-apps) · [Run it](#-run-it)

</div>

> Based on the UnderCover project from Ed Donner's AI FDE course ([ed-donner/undercover](https://github.com/ed-donner/undercover)), including its fictional sample data. Built with a secure agentic SDLC from [sdlc-template](https://github.com/euginevd/sdlc-template).

## 🧳 Customers

1. Sign in and start a claim: tap what happened, snap your receipts (JPEG, PNG or PDF), and an AI assistant drafts the claim for you to check.
2. Track it under **My claims**: **Received**, **Assessing**, **Decision**, then **Paid**.
3. Every decision says why in plain English. Not happy with it? Ask a person to review it.

## 🗂️ Handlers

1. The queue opens on **Needs me**: payouts waiting for sign-off, referrals and review requests first.
2. Open a claim for the case brief: the agent's recommendation, a checklist of what it verified with sources, and the payout worked out line by line. **Show trace** reveals every tool call, token and cost.
3. Sign off, send back or override. Approvals under $1,000 are paid automatically; anything over waits for a senior handler.
4. A senior handler can pause all payouts at once. The **Copilot** answers questions and acts for the signed-in handler.

## 🧪 AI engineers

1. A separate console, with its own sign-in, scores the agent against handlers' decisions on an evaluation set and a held-out set.
2. The improver proposes a better configuration; an AI engineer approves it, and it's kept only if it scores better on the held-out set.
3. The red-team suite attacks the agent with eight claims and reports which attacks held.

## 📦 Apps

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

| App | What | Runs on |
|-----|------|---------|
| `portal` | Customers make and track claims | Docker locally; EKS *(planned)* |
| `dashboard` | Handlers work the queue, ask customers for documents and sign off payouts | Docker locally; EKS *(planned)* |
| `console` | AI engineers run evaluations, approve the agent's improvements and run the red team | Docker locally; EKS *(planned)* |
| `api` | Claims, decisions, payments, settings and sign-in | Docker locally; EKS *(planned)* |
| `agent` | Claim agent with a hidden-instruction check and specialists, dispatcher, improver and drafting assistant | Docker locally; EKS *(planned)* |
| `copilot` | The handlers' chat agent | Docker locally; EKS *(planned)* |
| `context` | Policy wording, claims manual and reference data as an MCP server | Docker locally; EKS *(planned)* |

## 🚀 Run it

1. Install Docker Desktop and [uv](https://docs.astral.sh/uv/), then clone the repo.
2. Copy `.env.example` to `.env`, and add an Anthropic API key with its workspace ID.
3. `docker compose up --build -d`, then open the customer portal at http://127.0.0.1:5173, the handlers' dashboard at http://127.0.0.1:5174 and the AI engineers' console at http://127.0.0.1:5175. **Use test account** signs you in on each.
4. Make a claim with the sample receipts in [data/sample-receipts](data/sample-receipts): a delayed bag and a taxi in Nairobi, a clinic invoice in Sri Lanka, and `04-injection-test-mara-lodge.png`, which hides an instruction to the AI that the hidden-instruction check should catch.

Developers: [AGENTS.md](AGENTS.md), then [docs/](docs/). Stages and what done means: [spec.md](docs/spec.md).
