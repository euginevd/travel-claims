# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.7-python3.14-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/agent/pyproject.toml apps/agent/
RUN uv sync --frozen --no-dev --package undercover-api --no-install-workspace
COPY apps/api apps/api
RUN uv sync --frozen --no-dev --package undercover-api --no-editable

FROM python:3.14-slim-bookworm
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"]
CMD ["uvicorn", "undercover_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
