# Status

## Built

1. Scaffold (plan-claim-flow phase 1): a uv workspace with `apps/api` and `apps/agent` (health endpoints only), `apps/web` (React, Vite and TypeScript, a placeholder page), a Dockerfile per app, `docker-compose.yml` with PostgreSQL 17, and the `apps` workflow running each app's checks.
2. Context layer (phase 2): `apps/context`, an MCP server at `/mcp` (port 8006) with seven read-only lookups over data governance's seven files, each answer naming its source; DNS-rebinding protection limits it to the laptop and Compose host names.
3. The `api` (phase 3): claims, policies, customers, handlers, decisions, payments and steps in PostgreSQL through SQLAlchemy Core and Alembic; seeding from `data/` and the context layer (never `data/evals/`); the payout rules and claims manual section 14 checks; payments that refuse anything over the approval limit before reading the claim and pay each claim once; the local sign-in stand-in issuing Cognito-shaped ID tokens; the agent's key and handlers' tokens checked on every route. The agent's routes are scoped to one claim (`/api/agent/claims/{id}/...`). Handlers ask the agent to work a claim (`POST /api/claims/{id}/work`), and sign-off and send-back ask it to resume, over the contract in [plan-claim-flow.md](plan-claim-flow.md); the `api` names who made each decision. The `api` tests also run on PostgreSQL 17 (`TEST_DATABASE_URL`, and the `api-on-postgres` CI job).
4. The claim agent (phase 4): `apps/agent`, a FastAPI service the `api` calls at `/work` and `/resume`. Claude Haiku 5.5 checks each claim for hidden instructions first (a flagged claim is referred and Claude Sonnet 5.5 never sees it); then a LangGraph graph runs Claude Sonnet 5.5 with strict tools (the claim, policy, history, payout and decision through the `api`, and the context layer's seven lookups over MCP), records every step and model call, has code pay an approval under the limit, and pauses a held payout until a handler signs it off or sends it back. Progress is saved in PostgreSQL after every step. `models.py` is the only module that reaches Claude, with the workspace header.
5. The handlers' dashboard (phase 5): sign-in, the queue, and the claim page with live steps, sources, the decision and its calculation, sign-off and send-back. Every response is checked with zod; `src/fixtures/` holds real api responses (`UPDATE_WEB_FIXTURES=1 uv run pytest apps/api/tests/test_web_contract.py`) that the dashboard's tests parse. Served by nginx with a strict Content-Security-Policy.
6. The customers' portal ([plan-customer-portal.md](plan-customer-portal.md)): a landing page with two sign-ins, "I'm a customer" and "I'm a claims handler". Tokens carry a Cognito group (`handlers` or `customers`) checked on every route. A customer sees only their own policies and claims (plain status and reason; never steps, calculations, sources or handler notes), makes a claim on their own active policy, and adds up to five receipts (JPEG, PNG or PDF by their first bytes, 5 MB each) while it waits. Receipts are kept under random names on the `receipts` Docker volume (`storage.py`); handlers see thumbnails and download them as attachments with `nosniff`; the hidden-instruction check and the claim agent read them as Claude image and document blocks marked as customer-supplied data. The dashboard has an UnderCover logo, a travel illustration, a header that wraps instead of clipping, and a queue whose IDs, money and dates never wrap.

## Running it

7. Set up a machine once: `bash scripts/setup.sh`, then `uv sync` and `npm ci` in `apps/web`.
8. Secrets: copy `.env.example` to `.env` and fill it in. Python 3.14 (decision 9).
9. Run everything: `docker compose up --build`, then open http://127.0.0.1:5173.
10. Run without Docker: with `DATABASE_URL` set, `uv run -m undercover_api.migrate`, `uv run -m undercover_api.seed` and `uv run uvicorn undercover_api.main:create_app --factory --reload`, `uv run -m undercover_context` and `npm run dev` in `apps/web`.
11. Check: `uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest`, and in `apps/web` `npm run lint && npm run typecheck && npm test`.

## Testing it in the browser

12. Start Docker Desktop, then `docker compose up --build -d` in the repo root, and open http://127.0.0.1:5173.
13. Choose **I'm a claims handler** and sign in as Dana Whitfield (`dana.whitfield@undercover.example`, the only handler who can sign off over $1,000) with the `HANDLER_PASSWORD` value from `.env`. Marcus Oyelaran and Priya Raman can't sign off.
14. Open a waiting claim and press **Work this claim**; the steps appear as the agent works. Each claim costs about 2–4 cents of Claude.
15. Claims already worked in the live run (2026-11-08): CLM-1007, 1015, 1017, 1020, 1021 (the five tiny claims), CLM-1901 (hidden instructions) and CLM-1003 (held, then signed off). Try CLM-1008 or CLM-1011 for a payout over the limit to sign off or send back.
16. As a customer: choose **I'm a customer**, pick Maya Patel (`maya.patel@example.com`, policy POL-2001, Rome, 10–18 June 2026), Oliver Grant or Dorothy Gale, and sign in with the same `HANDLER_PASSWORD`. Make a claim with a receipt photo, then sign in as Dana to see it in the queue with its receipt and work it.
17. Start again from a clean queue: `docker compose down -v`, then `up` again (this deletes the local database).

## Live run, 2026-11-08

18. The five tiny claims matched the handlers' decision and payout exactly (CLM-1007 approve $50, CLM-1015 decline, CLM-1017 refer, CLM-1020 approve $240, CLM-1021 approve $825). CLM-1003 was approved at $3,750 as the handler did, held, signed off by Dana and paid. CLM-1901 was referred by the hidden-instruction check (the handler declined it; the check only refers, by design). Claude cost about $0.17 in all, by the agent's own price table.

## Known gaps

19. Packages resolve as of seven days ago (`exclude-newer` in `pyproject.toml`, `before` in `apps/web/.npmrc`); move the npm date forward when updating.
20. A claim whose agent crashes mid-work stays `in_progress`: its saved progress isn't picked up again automatically, and a handler can't retry it from the dashboard yet.
21. Not yet tested: a send-back through the real agent, a restart mid-claim, refusal fallbacks on Claude Sonnet 5.5.
22. The whole branch still needs its review before it merges to `main`; phases 4 and 5 and the integration pass weren't reviewed separately. No automated accessibility check or Playwright test yet.
23. LangGraph is only partly typed: three files switch off pyright's unknown-member checks for it.

## Next

24. Review the whole branch, open the PR, then stage 1 plan 2 (the dispatcher and evaluations).
