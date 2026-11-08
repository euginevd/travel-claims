# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.7-python3.14-trixie-slim@sha256:e80c05a310400cfc90af00b5b7271ef9ad24816e3265e1162af8a678e1aad099 AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/agent/pyproject.toml apps/agent/
COPY apps/context/pyproject.toml apps/context/
COPY apps/copilot/pyproject.toml apps/copilot/
RUN uv sync --frozen --no-dev --package undercover-api --no-install-workspace
COPY apps/context apps/context
COPY apps/api apps/api
RUN uv sync --frozen --no-dev --package undercover-api --no-editable

FROM python:3.14.9-slim-trixie@sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8
RUN useradd --system --uid 10001 app     && mkdir -p /data/receipts && chown 10001 /data/receipts
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
# Only the records seeding loads, and the labelled sets evaluations score against (the api
# keeps their labels to itself); never the security claim's decision.
COPY data/claims.json data/policies.json data/customers.json data/handlers.json data/company.json /app/data/
COPY data/evals/decisions.json data/evals/held_out_claims.json data/evals/held_out_decisions.json /app/data/evals/
COPY data/security/claims.json data/security/policies.json data/security/customers.json /app/data/security/
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 SEED_DATA_DIR=/app/data RECEIPTS_DIR=/data/receipts
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"]
# Migrate, seed an empty database, then serve.
CMD ["sh", "-c", "python -m undercover_api.migrate && python -m undercover_api.seed && exec uvicorn undercover_api.main:create_app --factory --host 0.0.0.0 --port 8000"]
