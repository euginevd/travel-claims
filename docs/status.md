# Status

## Built

1. Scaffold (plan-claim-flow phase 1): a uv workspace with `apps/api` and `apps/agent` (health endpoints only), `apps/web` (React, Vite and TypeScript, a placeholder page), a Dockerfile per app, `docker-compose.yml` with PostgreSQL 17, and the `apps` workflow running each app's checks.
2. Context layer (phase 2): `apps/context`, an MCP server at `/mcp` (port 8006) with seven read-only lookups over data governance's seven files, each answer naming its source; DNS-rebinding protection limits it to the laptop and Compose host names.
3. The `api` (phase 3): claims, policies, customers, handlers, decisions, payments and steps in PostgreSQL through SQLAlchemy Core and Alembic; seeding from `data/` and the context layer (never `data/evals/`); the payout rules and claims manual section 14 checks; payments that refuse anything over the approval limit before reading the claim and pay each claim once; the local sign-in stand-in issuing Cognito-shaped ID tokens; the agent's key and handlers' tokens checked on every route. The agent's routes are scoped to one claim (`/api/agent/claims/{id}/...`). Handlers ask the agent to work a claim (`POST /api/claims/{id}/work`), and sign-off and send-back ask it to resume, over the contract in [plan-claim-flow.md](plan-claim-flow.md); the `api` names who made each decision. The `api` tests also run on PostgreSQL 17 (`TEST_DATABASE_URL`, and the `api-on-postgres` CI job).
4. The handlers' dashboard (phase 5): sign-in, the queue, and the claim page with live steps, sources, the decision and its calculation, sign-off and send-back. Every response is checked with zod; `src/fixtures/` holds real api responses (`UPDATE_WEB_FIXTURES=1 uv run pytest apps/api/tests/test_web_contract.py`) that the dashboard's tests parse. Served by nginx with a strict Content-Security-Policy.

## Running it

5. Set up a machine once: `bash scripts/setup.sh`, then `uv sync` and `npm ci` in `apps/web`.
6. Secrets: copy `.env.example` to `.env` and fill it in. Python 3.14 (decision 9).
7. Run everything: `docker compose up --build`, then open http://127.0.0.1:5173.
8. Run without Docker: with `DATABASE_URL` set, `uv run -m undercover_api.migrate`, `uv run -m undercover_api.seed` and `uv run uvicorn undercover_api.main:create_app --factory --reload`, `uv run -m undercover_context` and `npm run dev` in `apps/web`.
9. Check: `uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest`, and in `apps/web` `npm run lint && npm run typecheck && npm test`.

## Known gaps

10. `docker compose up` not yet run end to end.
11. Packages resolve as of seven days ago (`exclude-newer` in `pyproject.toml`, `before` in `apps/web/.npmrc`); move the npm date forward when updating.
12. The agent's service (phase 4) isn't built: **Work this claim** answers that the agent's service isn't answering until it is.
13. No automated accessibility check or Playwright end-to-end test yet.

## Next

14. Plan-claim-flow phase 4, the claim agent: [plan-claim-flow.md](plan-claim-flow.md).
