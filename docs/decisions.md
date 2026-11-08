# Decisions

Key decisions only, newest last, each with why and what it replaced. Never delete one; add a new one that supersedes it.

1. **Rebuild UnderCover fresh, with credit** (2026-11-08). Why: the course repo has no licence, so publishing a copy of it isn't ours to do; its `week3day5-end` branch is the reference for behaviour and data. Instead of: forking the course repo.
2. **Local first, then AWS, then publish** (2026-11-08). Why: the whole app is proven on a laptop with a Claude API key before anything costs AWS money (spec 6–8). Instead of: building straight onto AWS.
3. **Anthropic API locally, Bedrock on AWS** (2026-11-08). Why: the API key is the quickest way to test, and stage 1 sends only made-up data; Bedrock's Australian inference profile keeps real claim data in Australia from stage 2 (spec 41). One module per app switches between them. Instead of: Bedrock from day one, or OpenRouter as in the course.
4. **The agent decides; code pays** (2026-11-08). Why: a model can be talked into a wrong answer, so limits and payments are enforced where no prompt can reach (spec 35). Instead of: letting the agent call the payment API.
5. **PostgreSQL in every stage** (2026-11-08). Why: the agent's saved progress, its memory and the records all need it, and Docker locally matches Aurora on AWS. Instead of: Supabase as in the course, SQLite, or DynamoDB.
6. **Containers from stage 1, EKS in stage 2** (2026-11-08). Why: the same images run in Docker Compose and on EKS, which inherits an enterprise platform's controls (GitOps, admission control, network policy) and controls the agent's egress. Instead of: AgentCore Runtime, simpler and right for smaller teams, or Lambda.
7. **Approval limit $1,000** (2026-11-08). Why: most claims are small and clear-cut; larger ones need a handler's sign-off (spec 21). Instead of: a handler signing off every claim.
8. **Free security tools in the repo** (2026-11-08). Why: the public repo can't use a licensed Wiz tenant; the DevSecOps notes map where Wiz would replace each tool. Instead of: Wiz in the pipeline.
9. **Python 3.14, not 3.15** (2026-11-08). Why: LangGraph depends on `zstandard`, which has no 3.15 build yet; code-standards 15 asks for the current stable version, so move up once it does. Instead of: Python 3.15.
10. **Separate apps and identities for customers and staff** (2026-11-08). Why: a customer token must fail the staff API's signature and audience checks before any role check runs, so one bug can't expose the queue or payments; in stage 2 the staff app sits behind its own Cognito user pool and allowed networks. Instead of: one web app with two sign-ins and a role claim.
11. **UnderCover has its own brand design system** (2026-11-08). Why: a travel insurer's customers expect a bright, reassuring travel brand, so "Sky and sunset" (navy, sky blue, coral, Plus Jakarta Sans) replaces the restrained consultancy look; ArcVault stays the base for other projects. Instead of: ArcVault tokens.
