# Status

## Built

1. Scaffold (plan-claim-flow phase 1): a uv workspace with `apps/api` and `apps/agent` (health endpoints only), `apps/web` (React, Vite and TypeScript, a placeholder page), a Dockerfile per app, `docker-compose.yml` with PostgreSQL 17, and the `apps` workflow running each app's checks.
2. Context layer (phase 2): `apps/context`, an MCP server at `/mcp` (port 8006) with seven read-only lookups over data governance's seven files, each answer naming its source; DNS-rebinding protection limits it to the laptop and Compose host names.
3. The `api` (phase 3): claims, policies, customers, handlers, decisions, payments and steps in PostgreSQL through SQLAlchemy Core and Alembic; seeding from `data/` and the context layer (never `data/evals/`); the payout rules and claims manual section 14 checks; payments that refuse anything over the approval limit before reading the claim and pay each claim once; the local sign-in stand-in issuing Cognito-shaped ID tokens; the agent's key and handlers' tokens checked on every route. The agent's routes are scoped to one claim (`/api/agent/claims/{id}/...`).

## Running it

4. Set up a machine once: `bash scripts/setup.sh`, then `uv sync` and `npm ci` in `apps/web`.
5. Secrets: copy `.env.example` to `.env` and fill it in. Python 3.14 (decision 9).
6. Run everything: `docker compose up --build`, then open http://127.0.0.1:5173.
7. Run without Docker: with `DATABASE_URL` set, `uv run -m undercover_api.migrate`, `uv run -m undercover_api.seed` and `uv run uvicorn undercover_api.main:create_app --factory --reload`, `uv run -m undercover_context` and `npm run dev` in `apps/web`.
8. Check: `uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest`, and in `apps/web` `npm run lint && npm run typecheck && npm test`.

## Known gaps

9. `docker compose up` not yet run: Docker Desktop is being installed on the dev machine.
10. Packages resolve as of seven days ago (`exclude-newer` in `pyproject.toml`, `before` in `apps/web/.npmrc`); move the npm date forward when updating.
11. The api's tests run on SQLite through the same SQLAlchemy Core code and Alembic migration, so they need no Docker; PostgreSQL-only behaviour (JSON operators, locking, `psycopg` itself) is untested until the stack runs in Compose.
12. Sign-off and send-back don't yet ask the agent to resume the claim: that call arrives with the agent in phase 4.

## Next

13. Plan-claim-flow phase 4, the claim agent: [plan-claim-flow.md](plan-claim-flow.md).
