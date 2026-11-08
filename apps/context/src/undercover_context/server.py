"""The context layer's MCP server: seven read-only lookups over streamable HTTP at /mcp,
stateless and answering in JSON, with a health check at /health."""

import os
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import StringConstraints
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse

from undercover_context import files

NAME = "undercover-context"
PORT = 8006
READ_ONLY = ToolAnnotations(read_only_hint=True)
# Host headers the server answers, against DNS rebinding: the laptop and Compose's service name.
DEFAULT_ALLOWED_HOSTS = "127.0.0.1:*,localhost:*,[::1]:*,context:*"

# What the model may send: a term or a search needs some text, and no more than this.
Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Json = dict[str, Any]


def build_server() -> MCPServer:
    """Make the MCP server with its seven lookups and a health check."""
    server = MCPServer(NAME)

    @server.tool(annotations=READ_ONLY)
    def lookup_term(term: Term) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Look up a term the policy wording defines: its definition and sections."""
        return files.lookup_term(term)

    @server.tool(annotations=READ_ONLY)
    def describe_fields(record: files.RecordName) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Describe a record the claim agent reads and what each of its fields means."""
        return files.describe_fields(record)

    @server.tool(annotations=READ_ONLY)
    def get_plan(plan: files.PlanName) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Get a plan's limits, waiting periods and deductible, and the add-ons."""
        return files.get_plan(plan)

    @server.tool(annotations=READ_ONLY)
    def get_claim_rules() -> Json:  # pyright: ignore[reportUnusedFunction]
        """Get the rules claims operations applies to every claim."""
        return files.get_claim_rules()

    @server.tool(annotations=READ_ONLY)
    def search_reference_data(query: Query) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Find outside facts, such as storms, strikes and prices, holding every word."""
        return files.search_reference_data(query)

    @server.tool(annotations=READ_ONLY)
    def search_documents(query: Query) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Find sections of the wording and the manual holding a word or phrase."""
        return files.search_documents(query)

    @server.tool(annotations=READ_ONLY)
    def read_section(document: files.DocumentName, number: int) -> Json:  # pyright: ignore[reportUnusedFunction]
        """Read one section of the policy wording or the claims manual in full."""
        try:
            return files.read_section(document, number)
        except files.NotFoundError as error:
            raise ToolError(str(error)) from error

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Say the context layer is up."""
        return JSONResponse({"status": "ok"})

    return server


def build_app() -> Starlette:
    """The server as an ASGI app, guarding against DNS rebinding with the allowed hosts."""
    hosts = os.environ.get("CONTEXT_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS).split(",")
    security = TransportSecuritySettings(allowed_hosts=[host.strip() for host in hosts])
    return build_server().streamable_http_app(
        stateless_http=True, json_response=True, transport_security=security
    )
