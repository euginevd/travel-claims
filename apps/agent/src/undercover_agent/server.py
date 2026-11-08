"""The agent's HTTP service, which the api calls to work or resume a claim, to the contract in
undercover_api.agent_service. It answers at once and works in the background."""

import secrets
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from undercover_agent.runner import Busy, Runner

ClaimId = Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")]
ThreadId = Annotated[str, StringConstraints(min_length=1, max_length=100)]


class WorkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: ClaimId
    thread_id: ThreadId


class ResumeRequest(WorkRequest):
    outcome: Literal["signed_off", "sent_back"]


def create_app(make_runner: Callable[[], Runner], key: Callable[[], str]) -> FastAPI:
    """The service, with how to build its runner and read the agent's key."""
    runner: dict[str, Runner] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        runner["claims"] = make_runner()
        yield

    app = FastAPI(title="UnderCover agent", lifespan=lifespan)

    def agents_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
        if x_api_key is None or not secrets.compare_digest(x_api_key, key()):
            raise HTTPException(401, "The agent's key is needed")

    @app.get("/health", operation_id="health")
    def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        """Say the agent is up."""
        return {"status": "ok"}

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

    return app


def start(begin: Callable[[], object]) -> JSONResponse:
    try:
        begin()
    except Busy as busy:
        return JSONResponse({"refused": str(busy)}, status_code=409)
    return JSONResponse({"accepted": True}, status_code=202)


def build_app() -> FastAPI:
    """The service wired to the real api, Claude, the context layer and PostgreSQL."""
    from langgraph.checkpoint.postgres import PostgresSaver  # noqa: PLC0415
    from psycopg.rows import dict_row  # noqa: PLC0415
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    from undercover_agent.api_client import ApiClient  # noqa: PLC0415
    from undercover_agent.graph import build_graph  # noqa: PLC0415
    from undercover_agent.models import AnthropicClaude  # noqa: PLC0415
    from undercover_agent.settings import get_settings  # noqa: PLC0415
    from undercover_agent.tools import McpContext  # noqa: PLC0415

    settings = get_settings()

    def make_runner() -> Runner:
        pool = ConnectionPool(
            settings.checkpoint_database_url.get_secret_value(),
            max_size=8,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        )
        saver = PostgresSaver(pool)  # pyright: ignore[reportArgumentType]
        saver.setup()
        api = ApiClient(settings.undercover_api, settings.undercover_api_key.get_secret_value())
        graph = build_graph(
            api,
            AnthropicClaude(settings),
            McpContext(settings.undercover_context),
            saver,
            settings.max_model_calls,
        )
        return Runner(graph, api)

    return create_app(make_runner, settings.undercover_api_key.get_secret_value)
