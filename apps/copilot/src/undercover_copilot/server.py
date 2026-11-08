# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""The Copilot's HTTP service at /api/copilot. Every request carries the handler's own staff
token; the Copilot checks it with the api and acts with it, one turn at a time per
conversation."""

import threading
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command
from pydantic import BaseModel, ConfigDict, StringConstraints

from undercover_copilot.graph import CopilotState, Handler
from undercover_copilot.staff_api import ApiError, StaffApi
from undercover_copilot.store import Conversation, Store

Json = dict[str, Any]
Graph = CompiledStateGraph[CopilotState, Handler, CopilotState, CopilotState]
ConversationId = Annotated[str, StringConstraints(pattern=r"^conv-[0-9a-f]{16}$")]
UNAUTHORISED = 401


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: Literal["sign_off", "cancel"]


class ConversationSummary(BaseModel):
    conversation_id: str
    title: str
    created_at: str


class ConversationView(ConversationSummary):
    transcript: list[Json]
    pending: Json | None


@dataclass(frozen=True)
class Caller:
    handler_id: str
    api: StaffApi


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
        status = error.status if error.status == UNAUTHORISED else 403
        raise HTTPException(status, error.detail) from error
    return Caller(str(handler["handler_id"]), api)


Signed = Annotated[Caller, Depends(caller)]


def create_app(  # noqa: C901, PLR0915 - the routes are closures over the graph and store
    make_graph: Callable[[], Graph],
    store: Callable[[], Store],
    make_api: Callable[[str], StaffApi],
) -> FastAPI:
    """The service, with how to build its graph and store and an api client for a token."""
    ready: dict[str, Any] = {}
    busy: set[str] = set()
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        ready["graph"] = make_graph()
        ready["store"] = store()
        yield

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
        )

    def run(conversation: Conversation, payload: Any, who: Caller) -> ConversationView:
        key = conversation.conversation_id
        with lock:
            if key in busy:
                raise HTTPException(409, "The Copilot is still answering in this conversation")
            busy.add(key)
        try:
            graph = cast(Graph, ready["graph"])
            graph.invoke(payload, config_for(key), context=Handler(who.api))
        finally:
            with lock:
                busy.discard(key)
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
        current = view(conversation)
        if current.pending:
            raise HTTPException(409, "Confirm or cancel the sign-off first")
        if not current.transcript:
            cast(Store, ready["store"]).retitle(conversation_id, request.text)
        start = {
            "messages": [{"role": "user", "content": request.text}],
            "transcript": [{"role": "user", "text": request.text}],
            "pending": {},
            "held_results": [],
            "turn_calls": 0,
        }
        return run(conversation, start, who)

    @router.post("/conversations/{conversation_id}/confirm", operation_id="confirm_sign_off")
    def confirm_sign_off(  # pyright: ignore[reportUnusedFunction]
        conversation_id: ConversationId, request: ConfirmRequest, who: Signed
    ) -> ConversationView:
        """The handler's answer on a sign-off card: only Sign off and pay pays."""
        conversation = owned(conversation_id, who)
        if view(conversation).pending is None:
            raise HTTPException(409, "No sign-off is waiting")
        return run(conversation, Command(resume=request.answer), who)

    app.include_router(router)

    @app.get("/health", operation_id="health")
    def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        """Say the Copilot is up."""
        return {"status": "ok"}

    return app


def config_for(conversation_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": conversation_id}, "recursion_limit": 60}


def build_app() -> FastAPI:
    """The service wired to the real api, Claude and PostgreSQL."""
    from langgraph.checkpoint.postgres import PostgresSaver  # noqa: PLC0415
    from psycopg.rows import dict_row  # noqa: PLC0415
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    from undercover_copilot.claude import AnthropicClaude  # noqa: PLC0415
    from undercover_copilot.graph import build_graph  # noqa: PLC0415
    from undercover_copilot.settings import get_settings  # noqa: PLC0415
    from undercover_copilot.store import PostgresStore  # noqa: PLC0415

    settings = get_settings()
    pool = ConnectionPool(
        settings.checkpoint_database_url.get_secret_value(),
        max_size=6,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )

    def make_graph() -> Graph:
        pool.open()
        saver = PostgresSaver(pool)  # pyright: ignore[reportArgumentType]
        saver.setup()
        return build_graph(AnthropicClaude(settings), saver, settings.max_model_calls)

    return create_app(
        make_graph,
        lambda: PostgresStore(pool),
        lambda token: StaffApi(settings.undercover_api, token),
    )
