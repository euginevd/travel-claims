"""The agent's HTTP service, which the api calls to work or resume a claim, to the contract in
undercover_api.agent_service. It answers at once and works in the background."""

import logging
import os
import secrets
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from undercover_agent import redteam
from undercover_agent.customer_facing import customer_facing
from undercover_agent.dispatcher import Dispatcher
from undercover_agent.improver import RoundImprover
from undercover_agent.models import Draft, Drafter
from undercover_agent.redteam import RedTeamBusyError, RedTeamUnavailableError
from undercover_agent.runner import Busy, Runner
from undercover_agent.tools import receipt_block

log = logging.getLogger(__name__)

ClaimId = Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")]
ThreadId = Annotated[str, StringConstraints(min_length=1, max_length=100)]


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


def create_app(  # noqa: C901, PLR0913 - the routes are closures over what they work with
    make_runner: Callable[[], Runner],
    key: Callable[[], str],
    make_drafter: Callable[[], Drafter] | None = None,
    make_dispatcher: Callable[[Runner], Dispatcher] | None = None,
    make_improver: Callable[[], RoundImprover] | None = None,
    *,
    start_redteam: Callable[[], None] | None = None,
) -> FastAPI:
    """The service, with how to build its runner, dispatcher, improver and drafter, and read
    the agent's key."""
    runner: dict[str, Runner] = {}
    drafter: dict[str, Drafter] = {}
    dispatcher: dict[str, Dispatcher] = {}
    improver: dict[str, RoundImprover] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        runner["claims"] = make_runner()
        if make_drafter is not None:
            drafter["claims"] = make_drafter()
        if make_dispatcher is not None:
            dispatcher["runs"] = make_dispatcher(runner["claims"])
        if make_improver is not None:
            improver["rounds"] = make_improver()
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

    @app.post("/dispatch", operation_id="dispatch", dependencies=[Depends(agents_key)])
    def dispatch(request: DispatchRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Work an evaluation run's copies, up to its concurrency at once."""
        if "runs" not in dispatcher:
            return JSONResponse({"refused": "The dispatcher isn't set up"}, status_code=409)
        dispatcher["runs"].dispatch(request.run_id, request.claim_ids, request.concurrency)
        return JSONResponse({"accepted": True}, status_code=202)

    @app.post("/improve", operation_id="improve", dependencies=[Depends(agents_key)])
    def improve(request: ImproveRequest) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        """Ask the improver for a proposal for an improvement round."""
        if "rounds" not in improver:
            return JSONResponse({"refused": "The improver isn't set up"}, status_code=409)
        improver["rounds"].improve(request.round_id)
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
    from langgraph.store.postgres import PostgresStore  # noqa: PLC0415
    from psycopg.rows import dict_row  # noqa: PLC0415
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    from undercover_agent.api_client import ApiClient, ApiError  # noqa: PLC0415
    from undercover_agent.graph import INSTRUCTIONS, build_graph  # noqa: PLC0415
    from undercover_agent.memory import StoreMemory  # noqa: PLC0415
    from undercover_agent.models import AnthropicClaude  # noqa: PLC0415
    from undercover_agent.redteam import RedTeamStarter  # noqa: PLC0415
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
        store = PostgresStore(pool)  # pyright: ignore[reportArgumentType]
        store.setup()
        api = ApiClient(settings.undercover_api, settings.undercover_api_key.get_secret_value())
        first = {
            "instructions": INSTRUCTIONS,
            "model": settings.claim_model,
            "effort": settings.claim_effort,
        }
        try:
            api.register_configuration(first)
        except ApiError:
            log.warning("couldn't register the first configuration; using the built-in one")
        graph = build_graph(
            api,
            AnthropicClaude(settings),
            McpContext(settings.undercover_context),
            saver,
            max_model_calls=settings.max_model_calls,
            memory=StoreMemory(store),
        )
        return Runner(graph, api)

    def api_client() -> ApiClient:
        return ApiClient(settings.undercover_api, settings.undercover_api_key.get_secret_value())

    return create_app(
        make_runner,
        settings.undercover_api_key.get_secret_value,
        lambda: AnthropicClaude(settings),
        lambda runner: Dispatcher(runner, api_client()),
        lambda: RoundImprover(AnthropicClaude(settings), api_client()),
        start_redteam=RedTeamStarter(
            settings.undercover_api,
            Path(os.environ.get("REDTEAM_DATA", "/app/data/redteam")),
            os.environ.get("REDTEAM_POLICY", redteam.POLICY),
        ).start,
    )
