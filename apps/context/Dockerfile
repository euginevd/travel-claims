# Build from the repo root: docker build -f apps/context/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.7-python3.14-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/agent/pyproject.toml apps/agent/
COPY apps/context/pyproject.toml apps/context/
RUN uv sync --frozen --no-dev --package undercover-context --no-install-workspace
COPY apps/context apps/context
RUN uv sync --frozen --no-dev --package undercover-context --no-editable

FROM python:3.14.9-slim-bookworm@sha256:945c2676dc2b18e0c1f16879244122c57c0ffede60006bf3df159c507a31bcae
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8006
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8006/health')"]
CMD ["uvicorn", "undercover_context.server:build_app", "--factory", "--host", "0.0.0.0", "--port", "8006"]
