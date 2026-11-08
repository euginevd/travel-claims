# Plan: the claim flow (stage 1, plan 1)

The first working slice of UnderCover on a laptop: a handler signs in, the agent works one claim end to end, and a handler signs off or sends back a payout over $1,000. Covers spec 18–23 and the parts of 28 that apply. The dispatcher, evaluations, improver and Copilot are plans 2–4.

## Design

### Layout

- `apps/api/`: FastAPI, SQLAlchemy Core and Alembic on PostgreSQL. Packages `undercover_api` with `main.py` (app and routes), `auth.py`, `payout.py`, `payments.py`, `records.py`, `seed.py`, `db.py`.
- `apps/agent/`: the claim agent. `models.py` (the one place that reaches Claude), `screening.py`, `graph.py`, `tools.py`, `api_client.py`, `server.py` (a small FastAPI app the `api` calls to start or resume a claim), `__main__.py` (`uv run -m agent work CLM-1001`).
- `apps/context/`: the MCP server over the seven context files (FastMCP, stateless HTTP), with the lookups `lookup_term`, `describe_fields`, `get_plan`, `get_claim_rules`, `search_reference_data`, `search_documents`, `read_section`. Each answer names its file and source.
- `apps/web/`: React, Vite and TypeScript.
- `data/` and `apps/context/files/`: the course's seed data and context files, copied from `week3day5-end`.
- Root: a uv workspace `pyproject.toml`, `docker-compose.yml` (postgres, context, api, agent, web), `.env.example`, a `.github/workflows/apps.yml` running each app's checks.

### How a claim is worked

1. A handler presses **Work this claim** (or `uv run -m agent work <id>`). The `api` marks it in progress and calls the agent's `/work` with the agent's key.
2. **Screen:** Claude Haiku reads the claim as the agent would and answers `{instructions_found, reason}` through structured output (`messages.parse`). A flagged claim is referred to a handler with the reason; the claim agent's model never sees it.
3. **Decide:** a LangGraph `StateGraph` loop: Claude Sonnet with the tools `get_claim`, `get_policy`, `get_claim_history`, `calculate_payout`, `record_decision` and the context lookups. The tools take the claim, policy and customer from the graph's context, never from the model. Each step (tool call, lookup with sources, reply, refusal) is recorded on the claim.
4. **Record:** the `api` checks the record against claims manual section 14 and refuses what falls short, with what's missing. An approval's payout must equal the calculation on file for that attempt.
5. **Pay or hold:** code, not the model, calls `pay_claim`. The payments module refuses any amount over the approval limit before it reads the claim, and pays each claim at most once (unique payment per claim and attempt). Over the limit, the graph pauses with `interrupt()`.
6. **Sign off or send back:** a handler who can sign off over the limit either signs off (which pays) or sends back with a note up to 1,000 characters. The `api` calls the agent's `/resume`, and the agent decides again with the note as a senior handler's review.
7. Progress is saved after every step with LangGraph's `PostgresSaver`, so a restart carries on without deciding or paying twice.

### Claude

- `models.py` builds the client once from settings: `anthropic.Anthropic()` in stage 1, sending `ANTHROPIC_WORKSPACE_ID` as the `anthropic-workspace-id` header (the key is organisation-scoped); `AnthropicBedrockMantle` in stage 2. Model IDs, `max_tokens`, effort, a 60-second timeout and 2 retries are settings with defaults (code-standards 19).
- Claim agent: `claude-sonnet-5-5`, adaptive thinking at `medium` effort, `tool_choice` auto with `strict: true` tools (forced tool choice is rejected on this model), server-side refusal fallbacks on (`fallbacks: "default"`). Full response content, thinking blocks included, is kept in the graph's messages unchanged.
- Hidden-instruction check and judge: `claude-haiku-5-5` at `low` effort, structured output validated with Pydantic.
- Prompt caching: the instructions, tool list and policy wording are a stable prefix with `cache_control`; the claim goes after it.
- Token use and cost of every call are recorded on the claim from `response.usage`.

### Sign-in

- A local sign-in stand-in in the `api` (`/api/dev/sign-in`) issues RS256 JWTs shaped like Cognito's (`iss`, `sub`, `email`, `token_use`, `exp`), with the handlers' password from `.env`. `auth.py` verifies tokens against the issuer's JWKS, so stage 2 swaps the issuer URL for Cognito's with no code change. The stand-in is off unless `LOCAL_SIGN_IN=true`.
- The agent sends its key in `X-API-Key`, compared with `secrets.compare_digest`. A request with the key is the agent's; handler routes refuse it.

### Dashboard

Sign-in page; the queue with each claim's status; a claim page with the story, documents, the agent's steps as they happen (polled), lookups grouped by source file, the decision with its calculation line by line, and **Sign off and pay** / **Send back** for a held payout. WCAG 2.2 AA.

## Security risks

- Instructions hidden in a claim (CLM-1901): screened first, content kept apart from instructions, limits in code. Test: CLM-1901 is referred and the claim agent's model is never called.
- Overpaying or paying twice: payments module checks the limit first and fails closed; one payment per claim enforced by a unique constraint. Tests: over-limit pay refused; replayed pay after restart refused.
- One customer's records reached from another's claim: tools take IDs from context. Test: the tools ignore any claim or customer ID in the model's arguments.
- The agent's key acting as a handler, or a handler without the right signing off: one gate per route, deny by default. Tests per route.
- The local sign-in stand-in left on: off by default, refuses to start when `LOCAL_SIGN_IN=true` and `ENVIRONMENT` isn't `local`.
- Personal data in logs: structured JSON logs with redaction at the source; a test that a logged claim holds no name, email or policy number.
- The Anthropic key: only in `.env`, read through settings; never logged.
- Licence: the seed data and context files are the course's. Fine in the private repo; they need Ed Donner's permission or replacing before the repo goes public (stage 3).

## Phases

### 1. Scaffold

- [x] uv workspace with `apps/api` and `apps/agent`; `apps/web` with Vite; pinned versions checked as real and maintained. (`apps/context` joins in phase 2.)
- [ ] `docker-compose.yml` with PostgreSQL 17 and the apps; `.env.example`; `docker compose up` starts everything. Written; not yet run, as Docker is being installed.
- [x] `apps.yml` workflow runs ruff, pyright, pytest and the web checks on every PR.
- [x] `status.md` says how to run it.

### 2. Context layer

- [x] `apps/context` added to the workspace, with its Dockerfile and compose service.
- [x] The seven context files copied in; the seven lookups served over MCP, each naming its file, system, owner and review date.
- [x] Tests for each lookup, including an unknown term and a missing section.

### 3. The `api`

- [ ] Schema and migrations: policies, customers, handlers, claims, steps, model calls, calculations, decisions, payments, settings.
- [ ] Seeding from `data/` and the context files, with CLM-1901 added from `data/security/`; the handlers' decisions in `data/evals/` are never loaded where the agent can reach them.
- [ ] Payout rules and section 14 checks, with the course's cases as tests.
- [ ] Payments module: limit first, one payment per claim, sign-off pays.
- [ ] Sign-in stand-in, JWT checks, agent key, and per-route authorisation tests.

### 4. The claim agent

- [ ] `models.py`, `screening.py`, the graph, tools and the `/work` and `/resume` server.
- [ ] Tests with Claude stubbed: approve under the limit pays; over the limit holds; sign-off resumes and finishes; send-back decides again; CLM-1901 referred without the claim agent's model; a restart mid-claim carries on without paying twice.

### 5. The dashboard

- [ ] Sign-in, queue, claim page, sign-off and send-back, with component tests and an accessibility check.
- [ ] Playwright end to end against the stack with a stub model: sign in, work a claim, sign off.

### 6. Live check

- [ ] With the user's go-ahead (it costs a few dollars of Anthropic API spend): run the five tiny claims and CLM-1901 on real Claude, compare with the handlers' decisions by eye, and record what was found in `guides/03-findings.md`.

## PR groups

1. The docs and this plan (branch `docs/undercover-spec`).
2. Phases 1–3: scaffold, context layer and `api`.
3. Phase 4: the claim agent.
4. Phases 5–6: dashboard, end to end and the live check.

## Before starting

- Install Docker Desktop (WSL 2 backend) and confirm `docker compose version` works.
- Put `ANTHROPIC_API_KEY` in `.env` yourself; the agent never reads or prints it.
