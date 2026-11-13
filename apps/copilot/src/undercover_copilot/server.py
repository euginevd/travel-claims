# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""The Copilot's HTTP service at /api/copilot. Every request carries the handler's own staff
token; the Copilot checks it with the api and acts with it, one turn at a time per
conversation."""

import os
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command
from pydantic import BaseModel, ConfigDict, StringConstraints

from undercover_copilot.graph import CopilotState, Handler, user_turn
from undercover_copilot.staff_api import UNREACHABLE, ApiError, StaffApi
from undercover_copilot.store import Conversation, Store

if TYPE_CHECKING:
    from psycopg_pool import ConnectionPool

Json = dict[str, Any]
Graph = CompiledStateGraph[CopilotState, Handler, CopilotState, CopilotState]
ConversationId = Annotated[str, StringConstraints(pattern=r"^conv-[0-9a-f]{16}$")]
UNAUTHORISED = 401


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # "sign_off" confirms a sign-off card only; "confirm" confirms whichever card is waiting.
    answer: Literal["sign_off", "confirm", "cancel"]


class ConversationSummary(BaseModel):
    conversation_id: str
    title: str
    created_at: str


class ConversationView(ConversationSummary):
    transcript: list[Json]
    pending: Json | None
    # The last turn: its tool steps, model calls, seconds of work and cost in US dollars.
    steps: int
    model_calls: int
    seconds: float
    cost_usd: float


@dataclass(frozen=True)
class Caller:
    handler_id: str
    api: StaffApi
    # The handler's own token, which the context gateway checks on AWS.
    token: str = ""


def caller(request: Request, authorization: Annotated[str | None, Header()] = None) -> Caller:
    """The handler, checked by the api with their own token."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Sign in first")
    make_api = cast(Callable[[str], StaffApi], request.app.state.make_api)
    api = make_api(token)
    try:
        handler = api.me()
    except ApiError as error:
        status = error.status if error.status in {UNAUTHORISED, UNREACHABLE} else 403
        raise HTTPException(status, error.detail) from error
    return Caller(str(handler["handler_id"]), api, token)


Signed = Annotated[Caller, Depends(caller)]


def create_app(  # noqa: C901, PLR0915 - the routes are closures over the graph and store
    make_graph: Callable[[], Graph],
    store: Callable[[], Store],
    make_api: Callable[[str], StaffApi],
    close: Callable[[], None] = lambda: None,
) -> FastAPI:
    """The service, with how to build its graph and store, an api client for a token, and what
    to close when it stops."""
    ready: dict[str, Any] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        ready["graph"] = make_graph()
        ready["store"] = store()
        try:
            yield
        finally:
            close()

    app = FastAPI(title="UnderCover Copilot", lifespan=lifespan)
    app.state.make_api = make_api
    router = APIRouter(prefix="/api/copilot")

    def owned(conversation_id: str, who: Caller) -> Conversation:
        found = cast(Store, ready["store"]).find(conversation_id, who.handler_id)
        if found is None:
            raise HTTPException(404, "Conversation not found")
        return found

    def view(conversation: Conversation) -> ConversationView:
        graph = cast(Graph, ready["graph"])
        snapshot = graph.get_state(config_for(conversation.conversation_id))
        values = cast(Json, snapshot.values or {})
        pending = cast(Json, values.get("pending") or {})
        return ConversationView(
            conversation_id=conversation.conversation_id,
            title=conversation.title,
            created_at=conversation.created_at,
            transcript=cast(list[Json], values.get("transcript") or []),
            pending={k: v for k, v in pending.items() if k != "tool_use_id"} or None,
            steps=int(values.get("turn_steps") or 0),
            model_calls=int(values.get("turn_calls") or 0),
            seconds=round(float(values.get("turn_seconds") or 0), 1),
            cost_usd=round(float(values.get("turn_cost") or 0), 6),
        )

    def run(
        conversation: Conversation, payload: Callable[[], Any], who: Caller
    ) -> ConversationView:
        """One turn, holding the conversation in the database first so no other instance runs
        it; the payload is built after that, so its check of the pending card can't race."""
        key = conversation.conversation_id
        store = cast(Store, ready["store"])
        if not store.take(key):
            raise HTTPException(409, "The Copilot is still answering in this conversation")
        try:
            graph = cast(Graph, ready["graph"])
            graph.invoke(
                payload(), config_for(key), context=Handler(who.api, who.handler_id, who.token)
            )
        finally:
            store.free(key)
        return view(conversation)

    @router.get("/conversations", operation_id="list_conversations")
    def list_conversations(who: Signed) -> list[ConversationSummary]:  # pyright: ignore[reportUnusedFunction]
        """The signed-in handler's conversations, newest first."""
        rows = cast(Store, ready["store"]).mine(who.handler_id)
        return [ConversationSummary(**row.__dict__) for row in rows]

    @router.post("/conversations", operation_id="start_conversation", status_code=201)
    def start_conversation(who: Signed) -> ConversationView:  # pyright: ignore[reportUnusedFunction]
        """A new conversation for the signed-in handler."""
        return view(cast(Store, ready["store"]).create(who.handler_id))

    @router.get("/conversations/{conversation_id}", operation_id="get_conversation")
    def get_conversation(conversation_id: ConversationId, who: Signed) -> ConversationView:  # pyright: ignore[reportUnusedFunction]
        """One of the handler's conversations, with any sign-off waiting on them."""
        return view(owned(conversation_id, who))

    @router.post("/conversations/{conversation_id}/messages", operation_id="send_message")
    def send_message(  # pyright: ignore[reportUnusedFunction]
        conversation_id: ConversationId, request: MessageRequest, who: Signed
    ) -> ConversationView:
        """The handler's message, and the Copilot's turn in answer."""
        conversation = owned(conversation_id, who)

        def start() -> Json:
            current = view(conversation)
            if current.pending:
                raise HTTPException(409, "Confirm or cancel the card first")
            if not current.transcript:
                cast(Store, ready["store"]).retitle(conversation_id, request.text)
            graph = cast(Graph, ready["graph"])
            saved = cast(Json, graph.get_state(config_for(conversation_id)).values or {})
            return {
                "messages": [user_turn(saved.get("messages") or [], request.text)],
                "transcript": [{"role": "user", "text": request.text}],
                "pending": {},
                "held_results": [],
                "turn_calls": 0,
                "turn_steps": 0,
                "turn_cost": 0.0,
                "turn_seconds": 0.0,
            }

        return run(conversation, start, who)

    @router.post("/conversations/{conversation_id}/confirm", operation_id="confirm_sign_off")
    def confirm_sign_off(  # pyright: ignore[reportUnusedFunction]
        conversation_id: ConversationId, request: ConfirmRequest, who: Signed
    ) -> ConversationView:
        """The handler's answer on a card: only their confirmation pays, dispatches or sends
        back."""
        conversation = owned(conversation_id, who)

        def answer() -> Command[Any]:
            if view(conversation).pending is None:
                raise HTTPException(409, "Nothing is waiting to be confirmed")
            return Command(resume=request.answer)

        return run(conversation, answer, who)

    app.include_router(router)

    @app.get("/health", operation_id="health")
    def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        """Say the Copilot is up."""
        return {"status": "ok"}

    return app


def config_for(conversation_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": conversation_id}, "recursion_limit": 60}


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


def build_app() -> FastAPI:
    """The service wired to the real api, Claude and PostgreSQL."""
    import httpx2  # noqa: PLC0415
    from langgraph.checkpoint.postgres import PostgresSaver  # noqa: PLC0415

    from undercover_copilot.claude import AnthropicClaude  # noqa: PLC0415
    from undercover_copilot.context import McpContext  # noqa: PLC0415
    from undercover_copilot.graph import build_graph  # noqa: PLC0415
    from undercover_copilot.memory import PostgresMemory  # noqa: PLC0415
    from undercover_copilot.settings import get_settings  # noqa: PLC0415
    from undercover_copilot.store import PostgresStore  # noqa: PLC0415

    settings = get_settings()
    context = McpContext(settings.undercover_context)
    if settings.context_gateway:
        # On AWS: the context layer only through its gateway, as the handler who asked: the
        # gateway checks their own token and lets only handlers in.
        context = McpContext(settings.context_gateway, prefix="context___", bearer=True)
    # One client for every handler's requests, so connections are pooled, not opened per request
    # and left open; it closes when the service stops.
    http = httpx2.Client(base_url=settings.undercover_api, timeout=30.0)

    def staff_api(token: str) -> StaffApi:
        return StaffApi(settings.undercover_api, token, http)

    if settings.checkpoint_table and settings.copilot_table:
        return aws_app(settings, context, staff_api, http.close)
    if settings.checkpoint_database_url is None:
        raise RuntimeError("Set CHECKPOINT_TABLE and COPILOT_TABLE, or CHECKPOINT_DATABASE_URL")
    pool = connection_pool(settings.checkpoint_database_url.get_secret_value(), max_size=6)

    def make_graph() -> Graph:
        pool.open()
        saver = PostgresSaver(pool)  # pyright: ignore[reportArgumentType]
        saver.setup()
        return build_graph(
            AnthropicClaude(settings),
            saver,
            settings.max_model_calls,
            context,
            PostgresMemory(pool),
        )

    def close() -> None:
        http.close()
        pool.close()

    return create_app(make_graph, lambda: PostgresStore(pool), staff_api, close)


# A week of a conversation's saved progress, compressed to stay under DynamoDB's item size.
CHECKPOINT_TTL_SECONDS = 7 * 24 * 3600


def aws_app(
    settings: Any, context: Any, staff_api: Callable[[str], StaffApi], close: Callable[[], None]
) -> FastAPI:
    """The service on AWS: checkpoints, conversations and notes in DynamoDB."""
    from langgraph_checkpoint_aws import DynamoDBSaver  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    from undercover_copilot.claude import AnthropicClaude  # noqa: PLC0415
    from undercover_copilot.dynamo import DynamoMemory, DynamoStore, table  # noqa: PLC0415
    from undercover_copilot.graph import build_graph  # noqa: PLC0415

    region = settings.aws_region or os.environ.get("AWS_REGION")
    copilot = table(settings.copilot_table, region)

    def make_graph() -> Graph:
        saver = DynamoDBSaver(
            table_name=settings.checkpoint_table,
            region_name=region,
            ttl_seconds=CHECKPOINT_TTL_SECONDS,
            enable_checkpoint_compression=True,
        )
        return build_graph(
            AnthropicClaude(settings),
            saver,
            settings.max_model_calls,
            context,
            DynamoMemory(copilot),
        )

    return create_app(make_graph, lambda: DynamoStore(copilot), staff_api, close)
