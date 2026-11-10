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


class Text:
    def __init__(self, text: str) -> None:
        self.text = text


def test_a_lookup_reads_structured_content_or_json_text() -> None:
    structured = {"rules": [{"rule": "filing_window"}]}
    assert tools.lookup_result(structured, [], False) == (structured, False)
    # Gateway may relay only the text; a JSON object there is the same answer.
    assert tools.lookup_result(None, [Text('{"plan": {"plan": "first"}}')], False) == (
        {"plan": {"plan": "first"}},
        False,
    )
    assert tools.lookup_result(None, [Text("No such section")], True) == (
        {"error": "No such section"},
        True,
    )
    assert tools.lookup_result(None, [Text('{"error": "x"}')], True)[1] is True
    assert tools.lookup_result(None, [Text('{"error": "No section 99"}')], False)[1] is True
    assert tools.lookup_result(None, [Text("[1, 2]")], False)[1] is True
    assert tools.lookup_result(None, [], False) == ({"error": "The lookup failed"}, True)


def test_through_gateway_each_tool_is_named_after_its_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[str] = []

    class Result:
        structured_content = {"ok": True}
        content: list[object] = []
        is_error = False

    class FakeClient:
        def __init__(self, server: object) -> None: ...

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *_: object) -> None: ...

        async def call_tool(self, name: str, arguments: dict[str, Any]) -> Result:
            called.append(name)
            return Result()

    monkeypatch.setattr(tools, "Client", FakeClient)

    def no_transport(url: str, http_client: object) -> str:
        return url

    monkeypatch.setattr(tools, "streamable_http_client", no_transport)
    found = tools.McpContext("https://gw/mcp", None, "context___").call("get_claim_rules", {})
    assert found == ({"ok": True}, False)
    assert called == ["context___get_claim_rules"]
