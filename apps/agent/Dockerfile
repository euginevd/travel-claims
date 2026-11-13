# Build from the repo root: docker build -f apps/agent/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.8-python3.14-trixie-slim@sha256:81a1340fea1e72ad4a8e9a016128b0c61041cf182ea49fd788023e52842bc147 AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/agent/pyproject.toml apps/agent/
COPY apps/context/pyproject.toml apps/context/
COPY apps/copilot/pyproject.toml apps/copilot/
RUN uv sync --frozen --no-dev --package undercover-agent --no-install-workspace
COPY apps/agent apps/agent
RUN uv sync --frozen --no-dev --package undercover-agent --no-editable

FROM python:3.14.10-slim-trixie@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f
# Debian's security fixes since the base image was built, and no pip: the app runs from its own .venv,
# and pip bundles its own urllib3, msgpack and setuptools, which the image scan flags.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* && python -m pip uninstall -y pip
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY data/redteam/attacks.json /app/data/redteam/
COPY data/redteam/receipts /app/data/redteam/receipts
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"]
# Under OpenTelemetry only when AGENT_OBSERVABILITY_ENABLED=true (AgentCore Runtime).
CMD ["python", "-m", "undercover_agent.start"]
