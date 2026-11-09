"""Which Host headers the server answers: the laptop's names by default, any on Lambda (stage 2)."""

import pytest
from starlette.testclient import TestClient

from undercover_context.server import build_app

LAMBDA_HOST = "abc123.lambda-url.ap-southeast-2.on.aws"
INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "t", "version": "1"},
    },
}
HEADERS = {"Accept": "application/json, text/event-stream", "Host": LAMBDA_HOST}


def post(allowed: str | None, monkeypatch: pytest.MonkeyPatch) -> int:
    if allowed is None:
        monkeypatch.delenv("CONTEXT_ALLOWED_HOSTS", raising=False)
    else:
        monkeypatch.setenv("CONTEXT_ALLOWED_HOSTS", allowed)
    with TestClient(build_app()) as http:
        return http.post("/mcp", json=INIT, headers=HEADERS).status_code


def test_by_default_an_unknown_host_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    assert post(None, monkeypatch) == 421  # noqa: PLR2004 - Misdirected Request


def test_on_lambda_any_host_is_answered(monkeypatch: pytest.MonkeyPatch) -> None:
    assert post("*", monkeypatch) == 200  # noqa: PLR2004
