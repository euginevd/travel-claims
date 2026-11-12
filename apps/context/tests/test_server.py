import json

import pytest
from mcp import Client
from starlette.testclient import TestClient

from undercover_context.server import build_app, build_server

TOOLS = {
    "lookup_term",
    "describe_fields",
    "get_plan",
    "get_claim_rules",
    "search_reference_data",
    "search_documents",
    "read_section",
}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_serves_the_seven_read_only_lookups() -> None:
    async with Client(build_server()) as client:
        listed = await client.list_tools()
    assert {tool.name for tool in listed.tools} == TOOLS
    assert all(tool.annotations and tool.annotations.read_only_hint for tool in listed.tools)


@pytest.mark.anyio
async def test_a_lookup_answers_with_its_sources() -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool("read_section", {"document": "policy_wording", "number": 1})
    assert not result.is_error
    assert result.structured_content is not None
    assert result.structured_content["sources"][0]["file"] == "policy_wording.md"


@pytest.mark.anyio
async def test_a_missing_section_comes_back_as_an_error() -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool(
            "read_section", {"document": "claims_manual", "number": 999}
        )
    assert result.is_error
    assert "Section 999 of the claims manual not found" in str(result.content)


@pytest.mark.anyio
async def test_an_empty_search_is_refused() -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool("search_documents", {"query": "   "})
    assert result.is_error


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("lookup_term", {"term": " "}),
        ("lookup_term", {"term": "x" * 101}),
        ("search_reference_data", {"query": "x" * 201}),
    ],
)
async def test_refuses_text_out_of_bounds(tool: str, arguments: dict[str, object]) -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool(tool, arguments)
    assert result.is_error


def test_health_says_ok() -> None:
    with TestClient(build_app(), base_url="http://127.0.0.1:8006") as http:
        assert http.get("/health").json() == {"status": "ok"}


LIST_TOOLS: dict[str, object] = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}


def post_list_tools(base_url: str) -> int:
    with TestClient(build_app(), base_url=base_url) as http:
        response = http.post(
            "/mcp",
            content=json.dumps(LIST_TOOLS),
            headers={"content-type": "application/json", "accept": "application/json"},
        )
    return response.status_code


def test_answers_the_compose_host() -> None:
    assert post_list_tools("http://context:8006") == 200


def test_refuses_an_unknown_host() -> None:
    assert post_list_tools("http://evil.example:8006") == 421


CALLS: list[tuple[str, dict[str, object]]] = [
    ("lookup_term", {"term": "Carrier"}),
    ("describe_fields", {"record": "claim"}),
    ("get_plan", {"plan": "premium"}),
    ("get_claim_rules", {}),
    ("search_reference_data", {"query": "storm"}),
    ("search_documents", {"query": "deductible"}),
    ("read_section", {"document": "claims_manual", "number": 14}),
]


@pytest.mark.anyio
@pytest.mark.parametrize(("tool", "arguments"), CALLS)
async def test_every_lookup_names_its_sources(tool: str, arguments: dict[str, object]) -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool(tool, arguments)
    assert not result.is_error
    assert result.structured_content is not None
    for source in result.structured_content["sources"]:
        assert set(source) >= {"file", "system", "owner", "reviewed"}


def gateway_call(tool: str, arguments: object) -> dict[str, object]:
    """One invocation as the Lambda Web Adapter passes it on from AgentCore Gateway."""
    context = {"client_context": {"custom": {"bedrockAgentCoreToolName": f"context___{tool}"}}}
    with TestClient(build_app()) as client:
        response = client.post(
            "/events", json=arguments, headers={"x-amzn-lambda-context": json.dumps(context)}
        )
    return response.json()


def test_the_gateways_lambda_target_reaches_the_same_lookups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CONTEXT_GATEWAY_EVENTS", "true")
    answer = gateway_call("read_section", {"document": "policy_wording", "number": 1})
    assert answer["sources"][0]["file"] == "policy_wording.md"  # pyright: ignore[reportIndexIssue]
    assert "error" in gateway_call("get_plan", {"plan": "platinum"})


def test_events_are_off_unless_switched_on() -> None:
    with TestClient(build_app()) as client:
        assert client.post("/events", json={}).status_code != 200  # noqa: PLR2004
