"""The context layer's MCP server: seven read-only lookups over streamable HTTP at /mcp,
stateless and answering in JSON, with a health check at /health.

On Lambda (tier 2) AgentCore Gateway invokes the function directly, by its ARN, so it has no
URL: the Lambda Web Adapter passes each invocation to /events, with the tool's arguments as the
body and the tool's name in the Lambda context's client context."""

import json
import os
from typing import Annotated, Any, cast

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

    add_gateway_events(server)

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Say the context layer is up."""
        return JSONResponse({"status": "ok"})

    return server


def add_gateway_events(server: MCPServer) -> None:
    """The route AgentCore Gateway's Lambda target reaches, through the Lambda Web Adapter;
    only on Lambda, where CONTEXT_GATEWAY_EVENTS is set."""
    if os.environ.get("CONTEXT_GATEWAY_EVENTS") != "true":
        return

    @server.custom_route("/events", methods=["POST"])
    async def events(request: Request) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """One tool call from AgentCore Gateway's Lambda target."""
        return JSONResponse(await gateway_event(server, request))


async def gateway_event(server: MCPServer, request: Request) -> Json:
    """Answer one gateway invocation with the lookup's structured answer, or an error."""
    name = gateway_tool(request.headers.get("x-amzn-lambda-context", ""))
    try:
        arguments = await request.json()
    except ValueError:
        arguments = None
    if name is None or not isinstance(arguments, dict):
        return {"error": "Not a tool call from the gateway"}
    try:
        result = await server.call_tool(name, cast(Json, arguments))
    except ToolError as error:
        return {"error": str(error)}
    structured = getattr(result, "structured_content", None)
    if getattr(result, "is_error", False) or not isinstance(structured, dict):
        return {"error": "The lookup failed"}
    return cast(Json, structured)


def gateway_tool(lambda_context: str) -> str | None:
    """The lookup a gateway invocation names: Gateway puts <target>___<tool> in the client
    context's custom bedrockAgentCoreToolName; None when it isn't there."""
    try:
        context = json.loads(lambda_context)
    except ValueError:
        return None
    client = cast(Json, context).get("client_context") if isinstance(context, dict) else None
    custom = cast(Json, client).get("custom") if isinstance(client, dict) else None
    full = cast(Json, custom).get("bedrockAgentCoreToolName") if isinstance(custom, dict) else None
    if not isinstance(full, str) or not full:
        return None
    return full.split("___", 1)[-1]


def build_app() -> Starlette:
    """The server as an ASGI app, guarding against DNS rebinding with the allowed hosts."""
    allowed = os.environ.get("CONTEXT_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS)
    # "*" on Lambda (tier 2): its URL is generated, and rebinding only threatens a laptop's server.
    if allowed.strip() == "*":
        security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    else:
        hosts = [host.strip() for host in allowed.split(",")]
        security = TransportSecuritySettings(allowed_hosts=hosts)
    return build_server().streamable_http_app(
        stateless_http=True, json_response=True, transport_security=security
    )
