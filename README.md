<div align="center">

# travel-claims

**UnderCover: an AI agent decides routine travel insurance claims, so handlers spend their time only on claims that need judgement.**

![Terraform](https://img.shields.io/badge/Terraform-IaC-7B42BC?style=for-the-badge&logo=terraform&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-OIDC-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Cloud-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)

[Apps](#-apps) · [Docs](#-docs) · [Bootstrap](#-bootstrap) · [Cleanup](#-cleanup)

</div>

---

Built with a secure agentic SDLC: [guides/01-agentic-sdlc.md](guides/01-agentic-sdlc.md).

## 🧪 Apps

| App | What | Runs on |
|-----|------|---------|
| `portal` | Customers make and track claims (127.0.0.1:5173) | Docker locally; EKS *(planned)* |
| `dashboard` | Handlers work the queue and sign off payouts (127.0.0.1:5174) | Docker locally; EKS *(planned)* |
| `api` | Claims, decisions, payments and settings | Docker locally; EKS *(planned)* |
| `agent` | Claim agent, hidden-instruction check, dispatcher and improver | Docker locally; EKS *(planned)* |
| `copilot` | The handlers' chat agent | Docker locally; EKS *(planned)* |
| `context` | Policy wording and claims manual as an MCP server | Docker locally; EKS *(planned)* |

Rebuilt from the UnderCover project in Ed Donner's AI FDE course. Stages and what done means: [spec.md](docs/spec.md).

## 📚 Docs

| File | What |
|------|------|
| [AGENTS.md](AGENTS.md) | Rules for every coding agent |
| [business-context.md](docs/business-context.md) | The business: UnderCover Travel Insurance (fictional) |
| [spec.md](docs/spec.md) | The project and what done means |
| [status.md](docs/status.md) | What's built and what's next |
| [decisions.md](docs/decisions.md) | Key decisions and why |
| [design-system.md](docs/design-system.md) | Look and feel, from the ArcVault design system |
| [threat-model.md](docs/threat-model.md), [costs.md](docs/costs.md) | Threats and controls; what it costs |

## 🚀 Bootstrap

Once per AWS account (`dev`, then `prod`), as an admin:

1. **AWS Console:** CloudFormation → upload [bootstrap.yaml](aws/bootstrap/bootstrap.yaml) as `travel-claims-bootstrap`, with `ProjectName` `travel-claims` and `Target` `dev` or `prod` (`CreateOidcProvider` false if the account already has GitHub's).
2. **GitHub:** Settings → Environments: `aws-<target>-plan`, and `aws-<target>-apply` with yourself as required reviewer.
3. **GitHub:** Settings → Variables: `PROJECT_NAME` (`travel-claims`) for the repo. Then on each environment, from that account's stack outputs: `AWS_PLAN_ROLE_ARN` on `-plan`, `AWS_DEPLOY_ROLE_ARN` on `-apply`, and `TF_STATE_BUCKET` on both.
4. **GitHub,** once the repo is public: Settings → Security → turn on Private vulnerability reporting.

**Deploying:** a merge to `main` applies to `dev` after your approval. To promote to `prod`: Actions → `aws` → Run workflow → target `prod`, `all`, `apply`, then approve.

## 🧹 Cleanup

1. **GitHub:** Actions → `aws` → Run workflow → each target, `all`, `destroy`.
2. **AWS Console:** empty the state bucket, then delete the bootstrap stack.
3. **GitHub:** delete the plan and apply environments.
