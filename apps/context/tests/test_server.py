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


@pytest.mark.anyio
async def test_an_empty_search_is_refused() -> None:
    async with Client(build_server()) as client:
        result = await client.call_tool("search_documents", {"query": "   "})
    assert result.is_error


def test_health_says_ok() -> None:
    with TestClient(build_app(), base_url="http://127.0.0.1:8006") as http:
        assert http.get("/health").json() == {"status": "ok"}


def test_refuses_an_unknown_host() -> None:
    request: dict[str, object] = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    with TestClient(build_app(), base_url="http://evil.example:8006") as http:
        response = http.post(
            "/mcp",
            content=json.dumps(request),
            headers={"content-type": "application/json", "accept": "application/json"},
        )
    assert response.status_code == 421


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
    assert result.structured_content["sources"]
