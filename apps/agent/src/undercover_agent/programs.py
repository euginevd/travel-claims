"""Code execution with MCP (plan phase 5, on AWS): the agent may write one short program that calls
the context layer's lookups as functions, and AgentCore Code Interpreter runs it, so only the
program's printed result comes back to Claude instead of one model turn per lookup.

The program runs as the Code Interpreter's own role, which may call only the context gateway, and
reading or deciding the claim stays with the agent's own tools (R3, decision 4). But the model has
read the claim when it writes a program, and the sandbox's network is public, so a program could
send out anything the model knows (R24): this stays off until the sandbox's egress is limited."""

import logging
from dataclasses import dataclass
from typing import Any, Protocol, cast

from undercover_agent.tools import TEXT, Json, tool

log = logging.getLogger(__name__)

# Seconds a session may live, seconds to wait for a program, and the most output Claude gets.
SESSION_SECONDS = 120
RUN_SECONDS = 60
MAX_OUTPUT = 8_000
MAX_PROGRAM = 4_000
HELPER_FILE = "context_tools.py"

PROGRAM_TOOL = tool(
    "run_lookup_program",
    "Run a short Python program that combines several context lookups in one step. These "
    "functions are already imported, each returning a dict: lookup_term(term), "
    "describe_fields(record), get_plan(plan), get_claim_rules(), search_reference_data(query), "
    "search_documents(query), read_section(document, number). Print only what you need. The "
    "program can't read or change the claim; use your other tools for that.",
    {"program": TEXT | {"description": "Python 3 source, at most 4,000 characters"}},
)

# The context's lookups as functions in the sandbox, each an MCP tools/call to the gateway.
HELPER = '''"""The context layer's lookups through the gateway, signed as this sandbox's role."""
import itertools
import json
import urllib.error
import urllib.request

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

_URL = {url!r}
_REGION = {region!r}
_PREFIX = {prefix!r}
_ids = itertools.count(1)
_session = {{}}


def _post(body):
    data = json.dumps(body).encode()
    headers = {{
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **_session,
    }}
    signed = AWSRequest(method="POST", url=_URL, data=data, headers=headers)
    credentials = boto3.Session().get_credentials().get_frozen_credentials()
    SigV4Auth(credentials, "bedrock-agentcore", _REGION).add_auth(signed)
    request = urllib.request.Request(_URL, data=data, headers=dict(signed.headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.headers.get("Mcp-Session-Id"):
                _session["Mcp-Session-Id"] = response.headers["Mcp-Session-Id"]
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        return {{"error": {{"message": f"The gateway answered {{error.code}}"}}}}
    if not text.strip():
        return {{}}
    if text.lstrip().startswith("{{"):
        return json.loads(text)
    # A stream: the message answering this request, by its id.
    for line in text.splitlines():
        if line.startswith("data:"):
            message = json.loads(line[5:])
            if message.get("id") == body.get("id"):
                return message
    raise RuntimeError("The gateway gave no answer")


def _start():
    if _session:
        return
    _post({{
        "jsonrpc": "2.0",
        "id": next(_ids),
        "method": "initialize",
        "params": {{
            "protocolVersion": "2025-11-25",
            "capabilities": {{}},
            "clientInfo": {{"name": "undercover-program", "version": "1"}},
        }},
    }})
    _session.setdefault("MCP-Protocol-Version", "2025-11-25")
    _post({{"jsonrpc": "2.0", "method": "notifications/initialized"}})


def _call(name, **arguments):
    _start()
    reply = _post({{
        "jsonrpc": "2.0",
        "id": next(_ids),
        "method": "tools/call",
        "params": {{"name": _PREFIX + name, "arguments": arguments}},
    }})
    if "error" in reply:
        return {{"error": str(reply["error"].get("message", "The lookup failed"))}}
    result = reply.get("result", {{}})
    if result.get("isError"):
        text = " ".join(block.get("text", "") for block in result.get("content", []))
        return {{"error": text or "The lookup failed"}}
    if result.get("structuredContent") is not None:
        return result["structuredContent"]
    text = " ".join(block.get("text", "") for block in result.get("content", []))
    try:
        return json.loads(text)
    except ValueError:
        return {{"error": text or "The lookup failed"}}


def lookup_term(term):
    return _call("lookup_term", term=term)


def describe_fields(record):
    return _call("describe_fields", record=record)


def get_plan(plan):
    return _call("get_plan", plan=plan)


def get_claim_rules():
    return _call("get_claim_rules")


def search_reference_data(query):
    return _call("search_reference_data", query=query)


def search_documents(query):
    return _call("search_documents", query=query)


def read_section(document, number):
    return _call("read_section", document=document, number=int(number))
'''


@dataclass(frozen=True)
class ProgramResult:
    text: str
    is_error: bool


class ProgramRunner(Protocol):
    def run(self, program: str) -> ProgramResult: ...


class CodeInterpreterRunner:
    """Runs one program per session on AgentCore Code Interpreter and always ends the session."""

    def __init__(
        self,
        interpreter_id: str,
        gateway_url: str,
        tool_prefix: str,
        region: str | None,
        client: Any = None,
    ) -> None:
        self._id = interpreter_id
        self._helper = HELPER.format(url=gateway_url, region=region or "", prefix=tool_prefix)
        if client is None:
            import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]
            from botocore.config import Config  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

            # A program that runs longer than this is cut off: the wait is the limit.
            limits = cast(Any, Config)(read_timeout=RUN_SECONDS, retries={"max_attempts": 1})
            client = cast(Any, boto3).client("bedrock-agentcore", region_name=region, config=limits)
        self._client = client

    def run(self, program: str) -> ProgramResult:
        if len(program) > MAX_PROGRAM:
            return ProgramResult(f"The program is over {MAX_PROGRAM} characters", is_error=True)
        try:
            started = self._client.start_code_interpreter_session(
                codeInterpreterIdentifier=self._id, sessionTimeoutSeconds=SESSION_SECONDS
            )
        except Exception as error:  # noqa: BLE001 - the agent's own lookups still work
            log.warning("code interpreter unavailable: %s", type(error).__name__)
            return ProgramResult("Programs can't run now; use the lookups directly", True)
        session = str(started["sessionId"])
        try:
            written = self._invoke(
                session, "writeFiles", {"content": [{"path": HELPER_FILE, "text": self._helper}]}
            )
            if written.get("isError"):
                return ProgramResult("The lookups couldn't be set up in the sandbox", True)
            code = f"from context_tools import *  # noqa\n{program}"
            done = self._invoke(session, "executeCode", {"language": "python", "code": code})
        except Exception as error:  # noqa: BLE001 - a failed program is the model's to read
            log.warning("program failed: %s", type(error).__name__)
            return ProgramResult(f"The program couldn't run ({type(error).__name__})", True)
        finally:
            self._stop(session)
        return outcome(done)

    def _invoke(self, session: str, name: str, arguments: Json) -> Json:
        reply = self._client.invoke_code_interpreter(
            codeInterpreterIdentifier=self._id, sessionId=session, name=name, arguments=arguments
        )
        for event in reply["stream"]:
            if "result" in event:
                return cast(Json, event["result"])
        raise RuntimeError("no result")

    def _stop(self, session: str) -> None:
        try:
            self._client.stop_code_interpreter_session(
                codeInterpreterIdentifier=self._id, sessionId=session
            )
        except Exception as error:  # noqa: BLE001 - the session times out by itself
            log.warning("couldn't stop a code session: %s", type(error).__name__)


def outcome(result: Json) -> ProgramResult:
    """What the program printed, or its error, capped for Claude."""
    found = cast(Json, result.get("structuredContent") or {})
    stdout = str(found.get("stdout") or "")
    stderr = str(found.get("stderr") or "")
    failed = bool(result.get("isError")) or int(found.get("exitCode") or 0) != 0
    text = (stdout + ("\n" + stderr if failed and stderr else "")).strip()
    if not text:
        text = "The program printed nothing" if not failed else "The program failed"
    return ProgramResult(text[:MAX_OUTPUT], failed)
