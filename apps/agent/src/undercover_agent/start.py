"""Start the agent's server: under OpenTelemetry's instrumentation when observability is on (on
AgentCore Runtime, which then shows each claim's trace), plainly otherwise (locally)."""

import os
from collections.abc import Mapping

SERVER = [
    "uvicorn",
    "undercover_agent.server:build_app",
    "--factory",
    "--host",
    "0.0.0.0",  # noqa: S104 - inside the container; Docker publishes it to 127.0.0.1
    "--port",
    "8080",
]


def command(environment: Mapping[str, str]) -> list[str]:
    """The server's command, wrapped by opentelemetry-instrument only when asked."""
    if environment.get("AGENT_OBSERVABILITY_ENABLED", "").lower() == "true":
        return ["opentelemetry-instrument", *SERVER]
    return SERVER


def main() -> None:
    """Replace this process with the server, so it gets the container's signals."""
    found = command(os.environ)
    os.execvp(found[0], found)  # noqa: S606 - a fixed command, no shell


if __name__ == "__main__":
    main()
