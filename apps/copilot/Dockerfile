# Build from the repo root: docker build -f apps/copilot/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.7-python3.14-trixie-slim@sha256:e80c05a310400cfc90af00b5b7271ef9ad24816e3265e1162af8a678e1aad099 AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/agent/pyproject.toml apps/agent/
COPY apps/context/pyproject.toml apps/context/
COPY apps/copilot/pyproject.toml apps/copilot/
RUN uv sync --frozen --no-dev --package undercover-copilot --no-install-workspace
COPY apps/copilot apps/copilot
RUN uv sync --frozen --no-dev --package undercover-copilot --no-editable

FROM python:3.14.9-slim-trixie@sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
# Stage 2: lets the same image run on Lambda; Lambda starts it as an extension, Docker never does.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8090 AWS_LWA_READINESS_CHECK_PATH=/health
USER 10001
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health')"]
CMD ["uvicorn", "undercover_copilot.server:build_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
