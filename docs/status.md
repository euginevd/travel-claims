# Status

## Built

1. Scaffold (plan-claim-flow phase 1): a uv workspace with `apps/api` and `apps/agent` (health endpoints only), `apps/web` (React, Vite and TypeScript, a placeholder page), a Dockerfile per app, `docker-compose.yml` with PostgreSQL 17, and the `apps` workflow running each app's checks.

## Running it

2. Set up a machine once: `bash scripts/setup.sh`, then `uv sync` and `npm ci` in `apps/web`.
3. Secrets: copy `.env.example` to `.env` and fill it in. Python 3.14 (3.15 isn't supported by LangGraph's dependencies yet).
4. Run everything: `docker compose up --build`, then open http://127.0.0.1:5173.
5. Run without Docker: `uv run uvicorn undercover_api.main:app --reload` and `npm run dev` in `apps/web`.
6. Check: `uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest`, and in `apps/web` `npm run lint && npm run typecheck && npm test`.

## Known gaps

7. `docker compose up` not yet run: Docker Desktop is being installed on the dev machine.
8. Packages resolve as of seven days ago (`exclude-newer` in `pyproject.toml`, `before` in `apps/web/.npmrc`); move the npm date forward when updating.

## Next

9. Plan-claim-flow phase 2, the context layer: [plan-claim-flow.md](plan-claim-flow.md).
