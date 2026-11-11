"""The one place the Copilot reaches the context layer: the policy wording and the claims manual,
looked up over MCP so a handler can ask what they say."""

import asyncio
import json
from typing import Any, Protocol, cast

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

Json = dict[str, Any]
# Seconds to wait for a lookup, a cold start of the context's Lambda included.
CONTEXT_TIMEOUT_SECONDS = 20.0


class Context(Protocol):
    """The context layer's lookups: the answer, and whether it is an error."""

    def call(self, name: str, arguments: Json) -> tuple[Json, bool]: ...


class McpContext:
    """The context layer over MCP at its url, one short session per lookup."""

    def __init__(self, url: str) -> None:
        self._url = url

    def call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        return asyncio.run(self._call(name, arguments))

    async def _call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        http = httpx2.AsyncClient(timeout=CONTEXT_TIMEOUT_SECONDS)
        server = streamable_http_client(self._url, http_client=http)
        async with Client(server) as client:
            result = await client.call_tool(name, arguments)
        return lookup_result(result.structured_content, result.content, result.is_error)


def lookup_result(structured: Any, content: list[Any], is_error: bool) -> tuple[Json, bool]:
    """A lookup's answer from its structured content, or from its text; text that isn't a JSON
    object is an error."""
    if structured is not None:
        return dict(structured), is_error
    text = " ".join(getattr(block, "text", "") for block in content)
    try:
        found = json.loads(text)
    except ValueError:
        found = None
    if isinstance(found, dict) and not is_error:
        return cast(Json, found), False
    return {"error": text or "The lookup failed"}, True
