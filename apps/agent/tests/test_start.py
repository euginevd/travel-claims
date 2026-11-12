"""The server starts under OpenTelemetry only when observability is on, so nothing is exported
locally."""

import os

import pytest

from undercover_agent import start


def test_locally_the_server_starts_plainly() -> None:
    assert start.command({}) == start.SERVER
    assert start.command({"AGENT_OBSERVABILITY_ENABLED": "false"}) == start.SERVER


def test_on_aws_the_server_starts_under_opentelemetry() -> None:
    found = start.command({"AGENT_OBSERVABILITY_ENABLED": "true"})
    assert found == ["opentelemetry-instrument", *start.SERVER]


def test_main_replaces_the_process_with_the_server(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[tuple[str, list[str]]] = []

    def execvp(file: str, args: list[str]) -> None:
        ran.append((file, args))

    monkeypatch.delenv("AGENT_OBSERVABILITY_ENABLED", raising=False)
    monkeypatch.setattr(os, "execvp", execvp)
    start.main()
    assert ran == [("uvicorn", start.SERVER)]
