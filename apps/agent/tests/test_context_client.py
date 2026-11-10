"""The context client waits out a cold start of the context's Lambda (about 9 seconds on AWS)."""

from typing import Any

import httpx2
import pytest

from undercover_agent import tools


def test_the_context_client_waits_longer_than_a_cold_start(monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[dict[str, Any]] = []

    class Recorded:
        def __init__(self, **kwargs: Any) -> None:
            made.append(kwargs)

    def no_server(url: str, http_client: object) -> object:
        raise RuntimeError("stop before connecting")

    monkeypatch.setattr(httpx2, "AsyncClient", Recorded)
    monkeypatch.setattr(tools, "streamable_http_client", no_server)
    with pytest.raises(RuntimeError, match="stop before connecting"):
        tools.McpContext("http://context/mcp").call("get_claim_rules", {})
    assert made[0]["timeout"] >= 20  # noqa: PLR2004 - the context Lambda takes about 9 to start
    assert made[0]["auth"] is None
