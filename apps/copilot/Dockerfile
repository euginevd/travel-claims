# Build from the repo root: docker build -f apps/copilot/Dockerfile .
FROM ghcr.io/astral-sh/uv:0.13.8-python3.14-trixie-slim@sha256:81a1340fea1e72ad4a8e9a016128b0c61041cf182ea49fd788023e52842bc147 AS build
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

FROM python:3.14.10-slim-trixie@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f
# Debian's security fixes since the base image was built, and no pip: the app runs from its own .venv,
# and pip bundles its own urllib3, msgpack and setuptools, which the image scan flags.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* && python -m pip uninstall -y pip
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
# Lets the same image run on Lambda; Lambda starts it as an extension, Docker never does.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8090 AWS_LWA_READINESS_CHECK_PATH=/health
USER 10001
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health')"]
CMD ["uvicorn", "undercover_copilot.server:build_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
