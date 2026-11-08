# Status

## Built

1. Scaffold (plan-claim-flow phase 1): a uv workspace with `apps/api` and `apps/agent` (health endpoints only), `apps/web` (React, Vite and TypeScript, a placeholder page), a Dockerfile per app, `docker-compose.yml` with PostgreSQL 17, and the `apps` workflow running each app's checks.
2. Context layer (phase 2): `apps/context`, an MCP server at `/mcp` (port 8006) with seven read-only lookups over data governance's seven files, each answer naming its source; DNS-rebinding protection limits it to the laptop and Compose host names.

## Running it

3. Set up a machine once: `bash scripts/setup.sh`, then `uv sync` and `npm ci` in `apps/web`.
4. Secrets: copy `.env.example` to `.env` and fill it in. Python 3.14 (decision 9).
5. Run everything: `docker compose up --build`, then open http://127.0.0.1:5173.
6. Run without Docker: `uv run uvicorn undercover_api.main:app --reload`, `uv run -m undercover_context` and `npm run dev` in `apps/web`.
7. Check: `uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest`, and in `apps/web` `npm run lint && npm run typecheck && npm test`.

## Known gaps

8. `docker compose up` not yet run: Docker Desktop is being installed on the dev machine.
9. Packages resolve as of seven days ago (`exclude-newer` in `pyproject.toml`, `before` in `apps/web/.npmrc`); move the npm date forward when updating.

## Next

10. Plan-claim-flow phase 3, the `api`: [plan-claim-flow.md](plan-claim-flow.md).
