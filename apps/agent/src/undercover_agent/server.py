"""The agent's HTTP service, which the api calls to work or resume a claim, to the contract in
undercover_api.agent_service. It answers at once and works in the background. On AgentCore
Runtime the same routes are reached through /invocations, and /ping tells Runtime to
keep the session while work is going."""

import json
import logging
import os
import re
import secrets
import threading
import time
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from undercover_agent import redteam
from undercover_agent.ask import Answer, Asker, AskRequest
from undercover_agent.customer_facing import customer_facing
from undercover_agent.dispatcher import Dispatcher
from undercover_agent.explain import Explainer, ExplainRequest, Explanation
from undercover_agent.improver import RoundImprover
from undercover_agent.judge import JudgeRequest, RunJudge
from undercover_agent.models import Draft, Drafter, Letter
from undercover_agent.reasoning import reasoning_check_for
from undercover_agent.receipts import reader_for
from undercover_agent.redteam import RedTeamBusyError, RedTeamUnavailableError
from undercover_agent.runner import Busy, Runner, Watchdog
from undercover_agent.tools import receipt_block

if TYPE_CHECKING:
    from psycopg_pool import ConnectionPool

log = logging.getLogger(__name__)

ClaimId = Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")]
ThreadId = Annotated[str, StringConstraints(min_length=1, max_length=100)]


# Routes /invocations may reach, and the thread names that mean work is going.
INVOCABLE = Literal[
    "/work",
    "/resume",
    "/carry-on",
    "/dispatch",
    "/improve",
    "/judge",
    "/redteam",
    "/draft",
    "/ask",
    "/explain",
    "/letter",
]
WORK_THREADS = ("CLM-", "run-", "round-", "redteam")


class Invocation(BaseModel):
    """What the api sends through AgentCore Runtime: the route and its body. Off Runtime the
    caller adds the agent's key; on Runtime AWS has already checked the caller's IAM role."""

    model_config = ConfigDict(extra="forbid")
    path: INVOCABLE
    body: dict[str, object]
    key: Annotated[str, StringConstraints(max_length=200)] = ""


def busy() -> bool:
    """Whether a claim, run, round or the red team is still working on a thread of its own."""
    return any(t.is_alive() and t.name.startswith(WORK_THREADS) for t in threading.enumerate())


async def call_route(
    app: FastAPI, path: str, body: dict[str, object], key: str
) -> tuple[int, object]:
    """POST to one of the app's own routes in this process, so its key check and validation run
    exactly as they do over HTTP."""
    payload = json.dumps(body).encode()
    scope: dict[str, object] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode()),
            (b"x-api-key", key.encode()),
        ],
        "client": ("127.0.0.1", 0),
        "server": ("127.0.0.1", 8080),
    }
    delivered = False
    status = 500
    chunks: list[bytes] = []

    async def receive() -> dict[str, object]:
        nonlocal delivered
        if delivered:
            return {"type": "http.disconnect"}
        delivered = True
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = int(str(message["status"]))
        elif message["type"] == "http.response.body":
            chunks.append(bytes(message.get("body", b"")))  # pyright: ignore[reportArgumentType]

    await app(scope, receive, send)  # pyright: ignore[reportArgumentType]
    raw = b"".join(chunks)
    return status, json.loads(raw) if raw else None


class WorkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: ClaimId
    thread_id: ThreadId


class ResumeRequest(WorkRequest):
    outcome: Literal["signed_off", "sent_back"]


class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: int = Field(ge=1)
    claim_ids: list[ClaimId] = Field(min_length=1, max_length=50)
    concurrency: int = Field(ge=1, le=25)
    kind: Literal["run", "dispatch"] = "run"


class WatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    concurrency: int = Field(ge=1, le=25)


class ImproveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    round_id: int = Field(ge=1)


class DraftTrip(BaseModel):
    destination: str
    departs_on: str
    returns_on: str
    trip_cost: float


class DraftReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    media_type: Literal["image/jpeg", "image/png", "application/pdf"]
    data: str


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(max_length=1000)]
    case: Annotated[str, StringConstraints(max_length=30)]
    trip: DraftTrip
    today: Annotated[str, StringConstraints(max_length=10)]
    receipts: list[DraftReceipt] = Field(max_length=5)


class LetterRequest(BaseModel):
    """The facts a decision letter is written from."""

    model_config = ConfigDict(extra="forbid")
    first_name: Annotated[str, StringConstraints(max_length=100)]
    claim_id: Annotated[str, StringConstraints(max_length=20)]
    summary: Annotated[str, StringConstraints(max_length=200)]
    decision: Literal["approve", "decline"]
    payout: float = Field(ge=0, le=1_000_000)
    paid_to: Annotated[str, StringConstraints(max_length=200)] = ""
    section: Annotated[str, StringConstraints(max_length=500)]
    reason: Annotated[str, StringConstraints(max_length=4000)]


def letter_content(request: LetterRequest) -> str:
    """What the letter is written from. The reason is the decision's own, for context."""
    outcome = (
        f"approved, paying ${request.payout:,.2f}"
        + (f" to their {request.paid_to}" if request.paid_to else "")
        if request.decision == "approve"
        else "declined"
    )
    return (
        f"Customer's first name: {request.first_name}\n"
        f"Claim {request.claim_id}: {request.summary}\n"
        f"Decision: {outcome}\n"
        f"Policy sections relied on: {request.section}\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"The decision's reason, between the markers:\n<reason>\n{request.reason}\n</reason>"
    )


class LaidOutLetter(BaseModel):
    """The letter as the handler sees it: one shape every time, and the model's note apart."""

    subject: str
    body: str
    note: str = ""


SIGN_OFF = "Kind regards,\nThe UnderCover claims team"
# Markdown a model writes out of habit, and a greeting or sign-off code adds itself.
MARKUP = re.compile(r"[*_#`]+")
GREETING = re.compile(r"^(dear|hi|hello)\b[^,\n]*,\s*", re.IGNORECASE)
CLOSING = re.compile(
    r"\s*((kind|warm|best)\s+regards|regards|sincerely|yours sincerely),?"
    r"(\s*the undercover claims team)?\.?\s*$|\s*the undercover claims team\.?\s*$",
    re.IGNORECASE,
)


def laid_out(letter: Letter, first_name: str) -> LaidOutLetter:
    """The model's paragraphs laid out as a letter: greeting, paragraphs, sign-off, in plain
    text with a blank line between, whatever shape the model's text came in."""
    paragraphs: list[str] = []
    for raw in letter.paragraphs:
        for part in re.split(r"\n\s*\n", raw.replace("\\n", "\n")):
            text = " ".join(MARKUP.sub("", part).split())
            text = CLOSING.sub("", GREETING.sub("", text)).strip()
            if text:
                paragraphs.append(text)
    name = first_name.strip() or "there"
    body = "\n\n".join([f"Dear {name},", *paragraphs, SIGN_OFF])
    subject = " ".join(MARKUP.sub("", letter.subject).split())
    note = " ".join(letter.note_for_handler.split())
    return LaidOutLetter(subject=subject, body=body, note=note)


def picked(case: str) -> str:
    """The tile the customer tapped, in words the assistant can act on."""
    if case == "other":
        return "something else, so work out which claim type fits from their words"
    return case or "(not picked)"


def draft_content(request: DraftRequest) -> list[dict[str, object]]:
    """What the drafting assistant reads: the facts, the customer's words, then each receipt
    labelled by number. All of it is data."""
    trip = request.trip
    facts = (
        f"Today is {request.today}. The customer's trip: {trip.destination}, "
        f"{trip.departs_on} to {trip.returns_on}.\n"
        f"What happened, as they picked it: {picked(request.case)}.\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"In their words, between the markers:\n<customer_words>\n{request.text}\n"
        "</customer_words>"
    )
    content: list[dict[str, object]] = [{"type": "text", "text": facts}]
    for number, receipt in enumerate(request.receipts, start=1):
        content.append({"type": "text", "text": f"Receipt {number}, customer-supplied data:"})
        content.append(receipt_block(receipt.model_dump()))
    return content


def create_app(  # noqa: C901, PLR0913, PLR0915 - the routes are closures over what they work with
    make_runner: Callable[[], Runner],
    key: Callable[[], str],
    make_drafter: Callable[[], Drafter] | None = None,
    make_dispatcher: Callable[[Runner], Dispatcher] | None = None,
    make_improver: Callable[[], RoundImprover] | None = None,
    *,
    start_redteam: Callable[[], None] | None = None,
    make_asker: Callable[[], Asker] | None = None,
    make_explainer: Callable[[], Explainer] | None = None,
    make_watchdog: Callable[[Runner], Watchdog] | None = None,
    make_judge: Callable[[], RunJudge] | None = None,
    on_runtime: bool = False,
) -> FastAPI:
    """The service, with how to build its runner, dispatcher, improver and drafter, and read
    the agent's key."""
    runner: dict[str, Runner] = {}
    drafter: dict[str, Drafter] = {}
    dispatcher: dict[str, Dispatcher] = {}
    improver: dict[str, RoundImprover] = {}
    asker: dict[str, Asker] = {}
    explainer: dict[str, Explainer] = {}
    judge: dict[str, RunJudge] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        runner["claims"] = make_runner()
        if make_drafter is not None:
            drafter["claims"] = make_drafter()
        if make_dispatcher is not None:
            dispatcher["runs"] = make_dispatcher(runner["claims"])
        if make_improver is not None:
            improver["rounds"] = make_improver()
        if make_asker is not None:
            asker["customers"] = make_asker()
        if make_explainer is not None:
            explainer["engineers"] = make_explainer()
        if make_judge is not None:
            judge["runs"] = make_judge()
        watchdog = make_watchdog(runner["claims"]) if make_watchdog is not None else None
        if watchdog is not None:
            watchdog.start()
        yield
        if watchdog is not None:
            watchdog.stop()

    app = FastAPI(title="UnderCover agent", lifespan=lifespan)

    def agents_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
        if x_api_key is None or not secrets.compare_digest(x_api_key, key()):
            raise HTTPException(401, "The agent's key is needed")

    @app.get("/health", operation_id="health")
    def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        """Say the agent is up."""
        return {"status": "ok"}

    @app.post("/invocations", operation_id="invocations")
    async def invocations(invocation: Invocation) -> dict[str, object]:  # pyright: ignore[reportUnusedFunction]
        """AgentCore Runtime's entry point: the route's own answer, wrapped with its status."""
        caller = key() if on_runtime else invocation.key
        status, body = await call_route(app, invocation.path, invocation.body, caller)
        return {"status": status, "body": body}

    @app.get("/ping", operation_id="ping")
    def ping() -> dict[str, object]:  # pyright: ignore[reportUnusedFunction]
        """AgentCore Runtime's health check: busy keeps the session while work is going."""
        return {
            "status": "HealthyBusy" if busy() else "Healthy",
            "time_of_last_update": int(time.time()),
        }

    @app.post("/work", operation_id="work", dependencies=[Depends(agents_key)])
    def work(request: WorkRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Start a new attempt at a claim the api has moved into progress."""
        return start(lambda: runner["claims"].work(request.claim_id, request.thread_id))

    @app.post("/resume", operation_id="resume", dependencies=[Depends(agents_key)])
    def resume(request: ResumeRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Carry a held claim on after a handler signed it off or sent it back."""
        return start(
            lambda: runner["claims"].resume(request.claim_id, request.thread_id, request.outcome)
        )

    @app.post("/carry-on", operation_id="carry_on", dependencies=[Depends(agents_key)])
    def carry_on(request: WorkRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Carry a stalled claim on from the last step saved on its thread."""
        return start(lambda: runner["claims"].carry_on_later(request.claim_id, request.thread_id))

    @app.post("/dispatch", operation_id="dispatch", dependencies=[Depends(agents_key)])
    def dispatch(request: DispatchRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Work an evaluation run's copies, or a dispatch of the queue's waiting claims, up to
        its concurrency at once."""
        if "runs" not in dispatcher:
            return JSONResponse({"refused": "The dispatcher isn't set up"}, status_code=409)
        dispatcher["runs"].dispatch(
            request.run_id, request.claim_ids, request.concurrency, request.kind
        )
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/watch", operation_id="watch", dependencies=[Depends(agents_key)])
    def watch(request: WatchRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Work the live queue while the agent switch is on; the api says how many at once."""
        if "runs" not in dispatcher:
            return JSONResponse({"refused": "The dispatcher isn't set up"}, status_code=409)
        dispatcher["runs"].watch()
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/improve", operation_id="improve", dependencies=[Depends(agents_key)])
    def improve(request: ImproveRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Ask the improver for a proposal for an improvement round."""
        if "rounds" not in improver:
            return JSONResponse({"refused": "The improver isn't set up"}, status_code=409)
        improver["rounds"].improve(request.round_id)
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/judge", operation_id="judge", dependencies=[Depends(agents_key)])
    def grade(request: JudgeRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Grade a finished run's explanations against the handlers' in the background."""
        if "runs" not in judge:
            return JSONResponse({"refused": "The judge isn't set up"}, status_code=409)
        judge["runs"].judge(request)
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/redteam", operation_id="redteam", dependencies=[Depends(agents_key)])
    def redteam() -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Run the red-team suite in the background; it reports to the api when done."""
        if start_redteam is None:
            return JSONResponse({"refused": "The red team isn't set up"}, status_code=409)
        try:
            start_redteam()
        except (RedTeamBusyError, RedTeamUnavailableError) as refused:
            return JSONResponse({"refused": str(refused)}, status_code=409)
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/draft", operation_id="draft", dependencies=[Depends(agents_key)])
    def draft(request: DraftRequest) -> Draft:  # pyright: ignore[reportUnusedFunction]
        """Draft a claim for a customer to check, from their words, case and receipts."""
        if "claims" not in drafter:
            raise HTTPException(503, "The drafting assistant isn't set up")
        found, _ = drafter["claims"].draft(draft_content(request))
        if found is None:
            raise HTTPException(502, "The drafting assistant couldn't draft this claim")
        return customer_facing(found)

    @app.post("/ask", operation_id="ask", dependencies=[Depends(agents_key)])
    def ask(request: AskRequest) -> Answer:  # pyright: ignore[reportUnusedFunction]
        """Answer a customer's question about their own policy and claims."""
        if "customers" not in asker:
            raise HTTPException(503, "The assistant isn't set up")
        return asker["customers"].ask(request)

    @app.post("/explain", operation_id="explain", dependencies=[Depends(agents_key)])
    def explain(request: ExplainRequest) -> Explanation:  # pyright: ignore[reportUnusedFunction]
        """Answer an AI engineer's question from the api's read-only snapshot."""
        if "engineers" not in explainer:
            raise HTTPException(503, "The assistant isn't set up")
        return explainer["engineers"].explain(request)

    @app.post("/letter", operation_id="letter", dependencies=[Depends(agents_key)])
    def letter(request: LetterRequest) -> LaidOutLetter:  # pyright: ignore[reportUnusedFunction]
        """Draft the customer's letter about a decision, for a handler to edit and send."""
        if "claims" not in drafter:
            raise HTTPException(503, "The drafting assistant isn't set up")
        found, _ = drafter["claims"].letter(letter_content(request))
        if found is None:
            raise HTTPException(502, "The assistant couldn't draft this letter")
        return laid_out(found, request.first_name)

    return app


def start(begin: Callable[[], object]) -> JSONResponse:
    try:
        begin()
    except Busy as busy:
        return JSONResponse({"refused": str(busy)}, status_code=409)
    return JSONResponse({"accepted": True}, status_code=202)


def set_up_tables(*steps: Callable[[], object], attempts: int = 3) -> None:
    """Create the checkpoint tables. The agent and the Copilot share a database and start
    together, and two `CREATE TABLE IF NOT EXISTS` at once can still collide in Postgres's
    catalogue; the loser tries again and finds the table there."""
    from psycopg import errors  # noqa: PLC0415

    for attempt in range(attempts):
        try:
            for step in steps:
                step()
            return
        except errors.UniqueViolation, errors.DuplicateTable, errors.DuplicateObject:
            if attempt == attempts - 1:
                raise
            time.sleep(0.5 * (attempt + 1))


def connection_pool(url: str, max_size: int) -> ConnectionPool[Any]:
    """PostgreSQL connections for checkpoints and the store, through Supabase's pooler.

    Idle connections die on the way (AWS's NAT drops idle TCP after 350 seconds; the pooler times
    out idle clients), so TCP keepalives hold them open and the pool tests each one before lending
    it, replacing a dead one instead of failing the claim with an SSL EOF.
    """
    from psycopg.rows import dict_row  # noqa: PLC0415
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    return ConnectionPool(
        url,
        min_size=1,
        max_size=max_size,
        max_idle=120,
        open=False,
        check=ConnectionPool.check_connection,
        kwargs={
            "autocommit": True,
            "prepare_threshold": None,  # no prepared statements, for the transaction pooler
            # A connection dropped without a reset fails in seconds, not a minute.
            "connect_timeout": 10,
            "tcp_user_timeout": 10_000,
            "row_factory": dict_row,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 3,
        },
    )


# A week of a claim's saved progress, compressed to stay under DynamoDB's item size.
CHECKPOINT_TTL_SECONDS = 7 * 24 * 3600


def checkpoints(settings: Any, region: str | None) -> tuple[Any, Any]:
    """The saver for each claim's progress, and the Postgres store when there is one:
    DynamoDB when CHECKPOINT_TABLE is set (AWS), PostgreSQL otherwise (locally)."""
    if settings.checkpoint_table:
        from langgraph_checkpoint_aws import DynamoDBSaver  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

        saver = DynamoDBSaver(
            table_name=settings.checkpoint_table,
            region_name=region,
            ttl_seconds=CHECKPOINT_TTL_SECONDS,
            enable_checkpoint_compression=True,
        )
        return saver, None
    if settings.checkpoint_database_url is None:
        raise RuntimeError("Set CHECKPOINT_TABLE or CHECKPOINT_DATABASE_URL")
    from langgraph.checkpoint.postgres import PostgresSaver  # noqa: PLC0415
    from langgraph.store.postgres import PostgresStore  # noqa: PLC0415

    pool = connection_pool(settings.checkpoint_database_url.get_secret_value(), max_size=8)
    pool.open()
    saver = PostgresSaver(pool)  # pyright: ignore[reportArgumentType]
    store = PostgresStore(pool)  # pyright: ignore[reportArgumentType]
    set_up_tables(saver.setup, store.setup)
    return saver, store


def build_app() -> FastAPI:
    """The service wired to the real api, Claude, the context layer and PostgreSQL."""
    from undercover_agent.api_client import ApiClient, ApiError  # noqa: PLC0415
    from undercover_agent.graph import INSTRUCTIONS, build_graph  # noqa: PLC0415
    from undercover_agent.guardrail import output_guardrail_for  # noqa: PLC0415
    from undercover_agent.identity import api_token  # noqa: PLC0415
    from undercover_agent.knowledge import KnowledgeBase  # noqa: PLC0415
    from undercover_agent.memory import AgentCoreMemory, Memory, StoreMemory  # noqa: PLC0415
    from undercover_agent.models import AnthropicClaude, plain_name  # noqa: PLC0415
    from undercover_agent.programs import CodeInterpreterRunner  # noqa: PLC0415
    from undercover_agent.redteam import RedTeamStarter  # noqa: PLC0415
    from undercover_agent.settings import get_settings  # noqa: PLC0415
    from undercover_agent.tools import McpContext  # noqa: PLC0415

    settings = get_settings()

    signer = None
    region = settings.aws_region or os.environ.get("AWS_REGION")
    if settings.context_aws_auth:
        from undercover_agent.aws_auth import SigV4Signer  # noqa: PLC0415

        signer = SigV4Signer(region or os.environ["AWS_REGION"], settings.context_aws_service)

    # On AWS one machine token, shared by every client and reused until it nearly expires.
    token = api_token(
        settings.workload_name, settings.api_token_provider, settings.api_token_scope, region
    )

    shared = settings.undercover_api_key
    # Without a shared key (on Runtime with the machine token) the routes behind /invocations take
    # a key made for this process alone: Runtime forwards only /invocations and /ping.
    inbound = shared.get_secret_value() if shared else secrets.token_hex(32)

    def api_client() -> ApiClient:
        return ApiClient(settings.undercover_api, inbound, token=token)

    def make_runner() -> Runner:
        saver, store = checkpoints(settings, region)
        api = api_client()
        first = {
            "instructions": INSTRUCTIONS,
            # Configurations hold the plain name, so they work on either provider.
            "model": plain_name(settings.claim_model),
            "effort": settings.claim_effort,
        }
        try:
            api.register_configuration(first)
        except ApiError:
            log.warning("couldn't register the first configuration; using the built-in one")
        # AgentCore Memory on AWS when named; the Postgres store otherwise (locally).
        if settings.memory_id:
            memory: Memory = AgentCoreMemory(settings.memory_id, region)
        elif store is not None:
            memory = StoreMemory(store)
        else:
            raise RuntimeError("Checkpoints in DynamoDB need MEMORY_ID for the customers' memory")
        graph = build_graph(
            api,
            AnthropicClaude(settings),
            McpContext(settings.undercover_context, signer, settings.context_tool_prefix),
            saver,
            max_model_calls=settings.max_model_calls,
            memory=memory,
            programs=CodeInterpreterRunner(
                settings.code_interpreter_id,
                settings.undercover_context,
                settings.context_tool_prefix,
                region,
            )
            if settings.code_interpreter_id
            else None,
            receipts=reader_for(
                settings.receipt_reader,
                settings.data_automation_project_arn,
                settings.data_automation_profile,
                region,
            ),
        )
        return Runner(graph, api)

    return create_app(
        make_runner,
        lambda: inbound,
        lambda: AnthropicClaude(settings),
        lambda runner: Dispatcher(runner, api_client()),
        lambda: RoundImprover(AnthropicClaude(settings), api_client()),
        make_asker=lambda: Asker(
            AnthropicClaude(settings),
            McpContext(settings.undercover_context, signer, settings.context_tool_prefix),
            settings.drafting_model,
            KnowledgeBase(settings.knowledge_base_id, region)
            if settings.knowledge_base_id
            else None,
            output_guardrail_for(
                settings.bedrock_answer_guardrail_id,
                settings.bedrock_answer_guardrail_version,
                region,
            ),
            reasoning_check_for(
                settings.bedrock_reasoning_guardrail_id,
                settings.bedrock_reasoning_guardrail_version,
                region,
            ),
        ),
        make_explainer=lambda: Explainer(AnthropicClaude(settings), settings.drafting_model),
        make_judge=lambda: RunJudge(AnthropicClaude(settings), api_client()),
        # On Runtime no agent lives long enough to watch; a handler retries a stalled claim.
        make_watchdog=None
        if settings.agentcore_runtime
        else lambda runner: Watchdog(runner, api_client()),
        on_runtime=settings.agentcore_runtime,
        start_redteam=RedTeamStarter(
            settings.undercover_api,
            Path(os.environ.get("REDTEAM_DATA", "/app/data/redteam")),
            os.environ.get("REDTEAM_POLICY", redteam.POLICY),
        ).start,
    )
