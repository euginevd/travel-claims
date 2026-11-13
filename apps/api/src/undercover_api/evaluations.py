"""Evaluations: copies of a labelled set worked by the dispatcher, scored against the handlers'
decisions, and the claim agent's configuration in versions.

A copy lives in the claims table with source "evaluation" and its run: it never shows in the
queue or a customer's claims, an approval on it settles as decided without paying, and nobody
signs it off. The labels never reach the agent, except the evaluation set's misses the improver
reads (improvement.py); the held-out set's never leave the api.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, CursorResult, RowMapping, func, insert, select, update

from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SignedInEngineer, require_agent
from undercover_api.claims import claim_trace, find_claim, find_decision
from undercover_api.db import (
    claims,
    configurations,
    decisions,
    dispatches,
    grades,
    labelled_claims,
    model_calls,
    now,
    runs,
    settings,
    steps,
)
from undercover_api.logs import redact_people
from undercover_api.models import (
    MAX_COST,
    ClaimId,
    DecisionKind,
    Engineer,
    EngineerTrace,
    Status,
    Strict,
    TraceOutcome,
)
from undercover_api.pii import scrub

log = logging.getLogger(__name__)

EVALUATION = "evaluation"
CURRENT_VERSION = "current_configuration"
LabelSet = Literal["evaluation", "held_out"]
Size = Literal["tiny", "whole"]
# Models and efforts the claim agent may use; the improver chooses only from these.
MODELS = ("claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5")
EFFORTS = ("low", "medium", "high")
Model = Literal["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]
Effort = Literal["low", "medium", "high"]
Instructions = Annotated[str, StringConstraints(min_length=50, max_length=20_000)]
# A run still shows as grading for this long after the judge took it, then stops waiting.
JUDGE_WAIT = timedelta(minutes=10)
ClaimIdText = Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")]

AGENT = [Depends(require_agent)]
staff_eval_router = APIRouter(prefix="/api/engineering")
agent_eval_router = APIRouter(prefix="/api/agent", dependencies=AGENT)


# --- Models ---


class Configuration(BaseModel):
    version: int
    instructions: str
    model: str
    effort: str
    reason: str
    diff: str
    status: str
    parent_version: int | None
    proposed_by: str
    reviewed_by: str | None
    created_at: str
    current: bool


class InitialConfiguration(Strict):
    instructions: Instructions
    model: Model
    effort: Effort


class StartRunRequest(Strict):
    label_set: LabelSet
    size: Size
    concurrency: int = Field(ge=1, le=25)


class Scores(BaseModel):
    claims: int
    decided: int
    accuracy: float = Field(description="Share whose decision matches the handler's")
    payout_accuracy: float = Field(description="Share whose decision and payout both match")
    straight_through: float = Field(description="Share decided without a referral")
    cost_per_claim: float
    seconds_per_claim: float
    total_cost: float
    grade: float | None = Field(
        default=None, description="The judge's mean grade of the graded copies, 0 to 3"
    )
    graded: int = Field(default=0, description="How many copies the judge graded")
    judge_cost: float = 0.0


class RunClaim(BaseModel):
    claim_id: str
    original_claim_id: str
    summary: str
    claim_type: str = ""
    status: Status
    decision: DecisionKind | None
    payout: float | None
    reason: str | None
    handler_decision: str | None
    handler_payout: float | None
    handler_reason: str | None
    matched: bool
    payout_matched: bool
    cost: float
    judged: bool = Field(default=False, description="Whether the judge answered for this copy")
    grade: int | None = None
    same_grounds: bool | None = None
    same_section: bool | None = None
    grade_note: str | None = None


class Run(BaseModel):
    run_id: int
    label_set: str
    size: str
    concurrency: int
    config_version: int
    round_id: int | None
    status: str
    started_by: str
    started_at: str
    finished_at: str | None
    scores: Scores | None
    grading: bool = Field(default=False, description="Whether the judge is still grading it")


class GradeIn(Strict):
    """The judge's grade of one copy; a null score means it couldn't grade it."""

    claim_id: ClaimIdText
    score: int | None = Field(ge=0, le=3)
    same_grounds: bool | None
    same_section: bool | None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
    cost: float = Field(ge=0, le=MAX_COST)


class GradesIn(Strict):
    grades: list[GradeIn] = Field(min_length=1, max_length=50)


class RunInFull(Run):
    claims: list[RunClaim]


# --- Configuration ---


def current_version(db: Connection) -> int | None:
    value = db.execute(
        select(settings.c.value).where(settings.c.key == CURRENT_VERSION)
    ).scalar_one_or_none()
    return int(value) if value is not None else None


def set_current_version(db: Connection, version: int, by: str) -> None:
    exists = db.execute(select(settings.c.key).where(settings.c.key == CURRENT_VERSION)).first()
    values = {"value": version, "changed_by": by, "changed_at": now()}
    if exists:
        db.execute(update(settings).where(settings.c.key == CURRENT_VERSION).values(**values))
    else:
        db.execute(insert(settings).values(key=CURRENT_VERSION, **values))


def configuration(db: Connection, version: int) -> Configuration:
    row = db.execute(select(configurations).where(configurations.c.version == version)).mappings()
    found = row.first()
    if found is None:
        raise HTTPException(404, f"Configuration version {version} not found")
    return Configuration.model_validate(dict(found) | {"current": current_version(db) == version})


def need_current(db: Connection) -> int:
    version = current_version(db)
    if version is None:
        raise HTTPException(409, "The claim agent hasn't registered its first configuration yet")
    return version


@agent_eval_router.post("/configuration/initial", operation_id="register_first_configuration")
def register_first_configuration(body: InitialConfiguration, db: Database) -> Configuration:
    """Register the claim agent's built-in configuration as version 1, once; later calls get
    the current version back unchanged."""
    version = current_version(db)
    if version is not None:
        return configuration(db, version)
    db.execute(
        insert(configurations).values(
            version=1,
            instructions=body.instructions,
            model=body.model,
            effort=body.effort,
            reason="The claim agent's first configuration",
            diff="",
            status="kept",
            parent_version=None,
            proposed_by="UnderCover Agent",
            created_at=now(),
        )
    )
    set_current_version(db, 1, "UnderCover Agent")
    return configuration(db, 1)


@agent_eval_router.get("/claims/{claim_id}/configuration", operation_id="get_claims_configuration")
def get_claims_configuration(claim_id: ClaimId, db: Database) -> Configuration:
    """The configuration the claim's current attempt works with."""
    version = find_claim(db, claim_id)["config_version"] or need_current(db)
    return configuration(db, version)


@staff_eval_router.get("/me", operation_id="get_signed_in_engineer")
def me_engineer(engineer: SignedInEngineer) -> Engineer:
    """The AI engineer signed in."""
    return engineer


# How far back the average cost per live claim reaches.
AVERAGE_DAYS = 30


def average_live_cost(db: Connection) -> float | None:
    """The mean of each live claim's model-call cost, over the last AVERAGE_DAYS."""
    from undercover_api.redteam import REDTEAM_CUSTOMER  # noqa: PLC0415 - redteam imports this

    since = (datetime.now(UTC) - timedelta(days=AVERAGE_DAYS)).isoformat()
    per_claim = (
        select(func.sum(model_calls.c.cost).label("cost"))
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(
            claims.c.source != EVALUATION,
            claims.c.customer_id != REDTEAM_CUSTOMER,
            model_calls.c.created_at >= since,
        )
        .group_by(model_calls.c.claim_id)
        .subquery()
    )
    mean = db.execute(select(func.avg(per_claim.c.cost))).scalar_one_or_none()
    return None if mean is None else round(float(mean), 6)


def private(text: str) -> str:
    """A trace's text with the customer's personal details masked."""
    return scrub(redact_people(text))[0]


@staff_eval_router.get("/claims/{claim_id}/trace", operation_id="get_trace_for_engineer")
def engineer_trace(claim_id: ClaimId, _: SignedInEngineer, db: Database) -> EngineerTrace:
    """A claim's steps and model calls with tokens and cost, its outcome and agent version, and
    the average live claim's cost to compare it with, for the AI engineers."""
    claim = find_claim(db, claim_id)
    decision = find_decision(db, claim_id)
    trace = claim_trace(db, claim_id)
    # Engineers read how the agent worked, not who the customer is: names, card, phone and tax
    # file numbers and email addresses are masked in what they see.
    steps = [step.model_copy(update={"content": private(step.content)}) for step in trace.steps]
    return EngineerTrace(
        **trace.model_copy(update={"steps": steps}).model_dump(),
        summary=private(claim["summary"]),
        status=claim["status"],
        outcome=(
            TraceOutcome.model_validate(decision.model_dump()) if decision is not None else None
        ),
        config_version=claim["config_version"],
        average_cost=average_live_cost(db),
    )


class TraceSuggestion(BaseModel):
    claim_id: str | None
    model_calls: int


# How far back the suggested trace may come from.
SUGGESTION_DAYS = 90


@staff_eval_router.get("/trace-suggestion", operation_id="suggest_trace")
def suggest_trace(_: SignedInEngineer, db: Database) -> TraceSuggestion:
    """A live claim worth tracing: the one with the most model calls lately, so the most steps
    to read. Never an evaluation copy or a red-team claim."""
    from undercover_api.redteam import REDTEAM_CUSTOMER  # noqa: PLC0415 - redteam imports this

    since = (datetime.now(UTC) - timedelta(days=SUGGESTION_DAYS)).isoformat()
    calls = func.count(model_calls.c.call_id)
    row = db.execute(
        select(model_calls.c.claim_id, calls)
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(
            claims.c.source != EVALUATION,
            claims.c.customer_id != REDTEAM_CUSTOMER,
            model_calls.c.created_at >= since,
        )
        .group_by(model_calls.c.claim_id)
        .order_by(calls.desc(), model_calls.c.claim_id.desc())
        .limit(1)
    ).first()
    if row is None:
        return TraceSuggestion(claim_id=None, model_calls=0)
    return TraceSuggestion(claim_id=str(row[0]), model_calls=int(row[1]))


class TraceRow(BaseModel):
    """One claim's trace in the list: like LangSmith's or Langfuse's, the run at a glance."""

    claim_id: str
    summary: str
    status: str
    red_team: bool
    model_calls: int
    tokens: int
    cost: float
    seconds: float
    started_at: str


# The newest traces listed, enough to pick from.
TRACES_LISTED = 25


@staff_eval_router.get("/traces", operation_id="list_traces")
def list_traces(_: SignedInEngineer, db: Database) -> list[TraceRow]:
    """The newest claims the agent worked, live and red-team, with their calls, tokens, cost and
    time; never an evaluation copy."""
    from undercover_api.redteam import REDTEAM_CUSTOMER  # noqa: PLC0415 - redteam imports this

    since = (datetime.now(UTC) - timedelta(days=SUGGESTION_DAYS)).isoformat()
    first = func.min(model_calls.c.created_at)
    rows = db.execute(
        select(
            model_calls.c.claim_id,
            claims.c.summary,
            claims.c.status,
            claims.c.customer_id,
            func.count(model_calls.c.call_id),
            func.sum(model_calls.c.input_tokens + model_calls.c.output_tokens),
            func.sum(model_calls.c.cost),
            func.sum(func.coalesce(model_calls.c.latency_ms, 0)),
            first,
        )
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(claims.c.source != EVALUATION, model_calls.c.created_at >= since)
        .group_by(model_calls.c.claim_id, claims.c.summary, claims.c.status, claims.c.customer_id)
        .order_by(first.desc())
        .limit(TRACES_LISTED)
    ).all()
    return [
        TraceRow(
            claim_id=str(claim_id),
            summary=private(str(summary or "")),
            status=str(status),
            red_team=customer == REDTEAM_CUSTOMER,
            model_calls=int(calls),
            tokens=int(tokens or 0),
            cost=round(float(cost or 0), 6),
            seconds=round(int(ms or 0) / 1000, 1),
            started_at=str(started),
        )
        for claim_id, summary, status, customer, calls, tokens, cost, ms, started in rows
    ]


@staff_eval_router.get("/configuration", operation_id="list_configurations")
def list_configurations(_: SignedInEngineer, db: Database) -> list[Configuration]:
    """Every version of the claim agent's configuration, newest first."""
    rows = db.execute(select(configurations).order_by(configurations.c.version.desc()))
    current = current_version(db)
    return [
        Configuration.model_validate(dict(r) | {"current": r["version"] == current})
        for r in rows.mappings()
    ]


# --- Runs ---


def labelled(db: Connection, label_set: str, size: str) -> list[RowMapping]:
    query = select(labelled_claims).where(labelled_claims.c.label_set == label_set)
    if size == "tiny":
        query = query.where(labelled_claims.c.tiny.is_(True))
    return list(db.execute(query.order_by(labelled_claims.c.claim_id)).mappings())


def new_id(result: CursorResult[Any]) -> int:
    """The primary key an insert just made."""
    key = result.inserted_primary_key
    if key is None:
        raise RuntimeError("The insert made no key")
    return int(cast(int, key[0]))


def copy_id(run_id: int, number: int) -> str:
    """An evaluation copy's claim id: CLM-9, the run in five digits, then the claim's number."""
    return f"CLM-9{run_id:05d}{number:02d}"


COPIED = (
    "policy_id",
    "customer_id",
    "claim_type",
    "submitted_on",
    "incident_date",
    "incident_location",
    "summary",
    "story",
    "items",
    "amount_claimed",
    "documents",
)


def create_run(  # noqa: PLR0913 - which claims to copy is the one extra choice
    db: Connection,
    body: StartRunRequest,
    version: int,
    by: str,
    *,
    round_id: int | None = None,
    chosen: list[dict[str, Any]] | None = None,
) -> tuple[int, list[str]]:
    """A new run with its copies, waiting for the dispatcher: of the labelled set, or of the
    claims given (a shadow run's live claims)."""
    from undercover_api.dispatches import stop_stale  # noqa: PLC0415 - dispatches imports this

    # One the agent never finished mustn't block every run after it.
    stop_stale(db)
    if db.execute(select(dispatches.c.dispatch_id).where(dispatches.c.status == "running")).first():
        raise HTTPException(
            409, "A dispatch of the queue is running. Start the run when it finishes"
        )
    if chosen is None:
        chosen = [dict(row) for row in labelled(db, body.label_set, body.size)]
    if not chosen:
        raise HTTPException(409, f"No labelled claims in the {body.label_set} set")
    run_id = new_id(
        db.execute(
            insert(runs).values(
                label_set=body.label_set,
                size=body.size,
                concurrency=body.concurrency,
                config_version=version,
                round_id=round_id,
                status="running",
                started_by=by,
                started_at=now(),
            )
        )
    )
    ids = [copy_id(run_id, number) for number in range(1, len(chosen) + 1)]
    db.execute(
        insert(claims),
        [
            {k: row["claim"][k] for k in COPIED}
            | {
                "claim_id": claim_id,
                "status": Status.WAITING,
                "attempts": 0,
                "source": EVALUATION,
                "run_id": run_id,
                "original_claim_id": row["claim_id"],
                "config_version": version,
            }
            for claim_id, row in zip(ids, chosen, strict=True)
        ],
    )
    return run_id, ids


def dispatch(db: Connection, service: AgentService, run_id: int, ids: list[str], n: int) -> None:
    """Commit the run, then hand it to the dispatcher; a run it won't take is stopped."""
    db.commit()
    try:
        service.dispatch(run_id, ids, n)
    except AgentUnavailableError as error:
        db.execute(update(runs).where(runs.c.run_id == run_id).values(status="stopped"))
        db.commit()
        raise HTTPException(503, f"The run couldn't start: {error}") from error


def agent(request: Request) -> AgentService:
    service: AgentService = request.app.state.agent
    return service


AgentCalls = Annotated[AgentService, Depends(agent)]


@staff_eval_router.post("/runs", operation_id="start_run", status_code=201)
def start_run(
    body: StartRunRequest, engineer: SignedInEngineer, db: Database, service: AgentCalls
) -> Run:
    """Start a practice run of the current configuration on the evaluation set. The held-out
    set is the exam: only an improvement round runs it, so it isn't worn out by hand."""
    if body.label_set != "evaluation":
        raise HTTPException(409, "The held-out set is the exam: only an improvement round runs it")
    run_id, ids = create_run(db, body, need_current(db), engineer.name)
    dispatch(db, service, run_id, ids, body.concurrency)
    return run_of(db, run_row(db, run_id))


class ShadowRequest(Strict):
    version: int = Field(ge=1)
    claims: int = Field(default=10, ge=3, le=25)


# The live claims a shadow run copies: decided ones, newest first.
SHADOW_STATUSES = ("decided", "paid", "waiting_for_sign_off")


@staff_eval_router.post("/shadow", operation_id="start_shadow_run", status_code=201)
def start_shadow_run(
    body: ShadowRequest, engineer: SignedInEngineer, db: Database, service: AgentCalls
) -> Run:
    """A shadow run: another version decides copies of the newest live claims, beside what was
    decided on each (copies are never paid). It answers "would this version have decided our
    real claims the same way?" before it goes live."""
    from undercover_api.redteam import REDTEAM_CUSTOMER  # noqa: PLC0415 - redteam imports this

    if body.version == current_version(db):
        raise HTTPException(409, "That version is the one in use: shadow another version")
    exists = db.execute(
        select(configurations.c.version).where(configurations.c.version == body.version)
    ).first()
    if exists is None:
        raise HTTPException(404, f"No version {body.version}")
    rows = (
        db.execute(
            select(claims)
            .select_from(claims.join(decisions, decisions.c.claim_id == claims.c.claim_id))
            .where(
                claims.c.source != EVALUATION,
                claims.c.customer_id != REDTEAM_CUSTOMER,
                claims.c.status.in_(SHADOW_STATUSES),
            )
            .order_by(decisions.c.decided_at.desc())
            .limit(body.claims)
        )
        .mappings()
        .all()
    )
    if len(rows) < 3:  # noqa: PLR2004 - fewer says nothing
        raise HTTPException(409, "A shadow run needs at least 3 decided live claims")
    chosen = [{"claim_id": r["claim_id"], "claim": {k: r[k] for k in COPIED}} for r in rows]
    request = StartRunRequest.model_construct(label_set="shadow", size="whole", concurrency=3)
    run_id, ids = create_run(db, request, body.version, engineer.name, chosen=chosen)
    dispatch(db, service, run_id, ids, request.concurrency)
    return run_of(db, run_row(db, run_id))


@staff_eval_router.post("/runs/{run_id}/resume", operation_id="resume_run")
def resume_run(run_id: int, _: SignedInEngineer, db: Database, service: AgentCalls) -> Run:
    """Hand a run's unfinished copies to the dispatcher again, after a restart: each carries on
    from its saved progress, and nothing is decided twice."""
    row = run_row(db, run_id)
    left = unfinished(db, run_id)
    if row["status"] == "finished" or not left:
        raise HTTPException(409, f"Run {run_id} has nothing left to work")
    db.execute(update(runs).where(runs.c.run_id == run_id).values(status="running"))
    dispatch(db, service, run_id, left, row["concurrency"])
    return run_of(db, run_row(db, run_id))


def run_row(db: Connection, run_id: int) -> RowMapping:
    row = db.execute(select(runs).where(runs.c.run_id == run_id)).mappings().first()
    if row is None:
        raise HTTPException(404, f"Run {run_id} not found")
    return row


def run_of(db: Connection, row: RowMapping) -> Run:
    """A run, with the judge's grades added to its scores once it has some."""
    stored = Scores.model_validate(row["scores"]) if row["scores"] else None
    scores, grading = judged(db, row, stored)
    return Run.model_validate(dict(row) | {"scores": scores, "grading": grading})


def judged(db: Connection, row: RowMapping, scores: Scores | None) -> tuple[Scores | None, bool]:
    """A run's scores with the judge's mean grade, graded count and cost, and whether the judge
    is still grading: it took the run within JUDGE_WAIT and hasn't answered for every copy."""
    answered, graded, mean, cost = db.execute(
        select(
            func.count(grades.c.claim_id),
            func.count(grades.c.score),
            func.avg(grades.c.score),
            func.sum(grades.c.cost),
        ).where(grades.c.run_id == row["run_id"])
    ).one()
    since = row["grading_since"]
    grading = (
        since is not None
        and scores is not None
        and answered < scores.decided
        and datetime.now(UTC) - datetime.fromisoformat(since) < JUDGE_WAIT
    )
    if scores is None:
        return None, grading
    with_grade = scores.model_copy(
        update={
            "grade": round(float(mean), 2) if mean is not None else None,
            "graded": graded,
            "judge_cost": round(float(cost or 0), 6),
        }
    )
    return with_grade, grading


def labels_of(db: Connection, original_ids: list[str]) -> dict[str, dict[str, Any]]:
    rows = db.execute(
        select(labelled_claims.c.claim_id, labelled_claims.c.label).where(
            labelled_claims.c.claim_id.in_(original_ids)
        )
    )
    found = {claim_id: dict(label) for claim_id, label in rows}
    missing = [claim_id for claim_id in original_ids if claim_id not in found]
    if missing:
        # A shadow run's copies: the answer is what was decided on the live claim, after any
        # handler's override.
        for claim_id, decision, payout, reason in db.execute(
            select(
                decisions.c.claim_id, decisions.c.decision, decisions.c.payout, decisions.c.reason
            ).where(decisions.c.claim_id.in_(missing))
        ):
            found[claim_id] = {"decision": decision, "payout": float(payout), "reason": reason}
    return found


def costs_of(db: Connection, ids: list[str]) -> dict[str, float]:
    rows = db.execute(
        select(model_calls.c.claim_id, func.sum(model_calls.c.cost))
        .where(model_calls.c.claim_id.in_(ids))
        .group_by(model_calls.c.claim_id)
    )
    return {claim_id: float(total or 0) for claim_id, total in rows}


def seconds_of(db: Connection, row: RowMapping, decided_at: str | None) -> float | None:
    """How long the agent took on a copy: its first step to its decision."""
    if decided_at is None:
        return None
    first = db.execute(
        select(func.min(steps.c.created_at)).where(steps.c.claim_id == row["claim_id"])
    ).scalar_one_or_none()
    if first is None:
        return None
    return (datetime.fromisoformat(decided_at) - datetime.fromisoformat(first)).total_seconds()


def run_claims(db: Connection, run_id: int) -> tuple[list[RunClaim], list[float]]:
    """A run's copies beside the handlers' decisions, and each decided one's time."""
    rows = list(
        db.execute(select(claims).where(claims.c.run_id == run_id).order_by(claims.c.claim_id))
        .mappings()
        .all()
    )
    labels = labels_of(db, [r["original_claim_id"] for r in rows])
    costs = costs_of(db, [r["claim_id"] for r in rows])
    graded = {
        g["claim_id"]: g
        for g in db.execute(select(grades).where(grades.c.run_id == run_id)).mappings()
    }
    found: list[RunClaim] = []
    times: list[float] = []
    for row in rows:
        decision = find_decision(db, row["claim_id"])
        label = labels.get(row["original_claim_id"], {})
        matched = decision is not None and decision.decision == label.get("decision")
        payout_matched = (
            matched
            and decision is not None
            and abs(decision.payout - float(label.get("payout") or 0)) < 0.01  # noqa: PLR2004
        )
        took = seconds_of(db, row, decision.decided_at if decision else None)
        if took is not None:
            times.append(took)
        found.append(
            RunClaim(
                claim_id=row["claim_id"],
                original_claim_id=row["original_claim_id"],
                summary=row["summary"],
                claim_type=row["claim_type"],
                status=row["status"],
                decision=decision.decision if decision else None,
                payout=decision.payout if decision else None,
                reason=decision.reason if decision else None,
                handler_decision=label.get("decision"),
                handler_payout=label.get("payout"),
                handler_reason=label.get("reason"),
                matched=matched,
                payout_matched=payout_matched,
                cost=round(costs.get(row["claim_id"], 0.0), 6),
                **grade_of(graded.get(row["claim_id"])),
            )
        )
    return found, times


def grade_of(row: RowMapping | None) -> dict[str, Any]:
    """A copy's grade fields, empty until the judge answers for it."""
    if row is None:
        return {}
    return {
        "judged": True,
        "grade": row["score"],
        "same_grounds": row["same_grounds"],
        "same_section": row["same_section"],
        "grade_note": row["note"],
    }


def score(found: list[RunClaim], times: list[float]) -> Scores:
    """A run's measures. A copy left undecided counts as a miss."""
    total = len(found) or 1
    decided = [c for c in found if c.decision is not None]
    cost = sum(c.cost for c in found)
    return Scores(
        claims=len(found),
        decided=len(decided),
        accuracy=round(sum(c.matched for c in found) / total, 4),
        payout_accuracy=round(sum(c.payout_matched for c in found) / total, 4),
        straight_through=round(
            sum(c.decision not in (None, DecisionKind.REFER) for c in found) / total, 4
        ),
        cost_per_claim=round(cost / total, 6),
        seconds_per_claim=round(sum(times) / len(times), 1) if times else 0.0,
        total_cost=round(cost, 6),
    )


def run_cost(db: Connection, run_id: int | None) -> float:
    if run_id is None:
        return 0.0
    total = db.execute(
        select(func.sum(model_calls.c.cost))
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(claims.c.run_id == run_id)
    ).scalar_one_or_none()
    return float(total or 0)


@staff_eval_router.get("/runs", operation_id="list_runs")
def list_runs(_: SignedInEngineer, db: Database) -> list[Run]:
    """Every run, newest first, with its scores once finished."""
    rows = db.execute(select(runs).order_by(runs.c.run_id.desc())).mappings().all()
    return [run_of(db, r) for r in rows]


@staff_eval_router.get("/runs/{run_id}", operation_id="get_run")
def get_run(run_id: int, _: SignedInEngineer, db: Database) -> RunInFull:
    """A run with each copy beside the handler's decision, and live scores."""
    row = run_row(db, run_id)
    found, times = run_claims(db, run_id)
    stored = Scores.model_validate(row["scores"]) if row["scores"] else score(found, times)
    scores, grading = judged(db, row, stored)
    return RunInFull.model_validate(
        dict(row) | {"scores": scores, "grading": grading, "claims": found}
    )


def finish(db: Connection, run_id: int) -> Run:
    """Score a run and mark it finished, once."""
    row = run_row(db, run_id)
    if row["status"] != "finished":
        found, times = run_claims(db, run_id)
        db.execute(
            update(runs)
            .where(runs.c.run_id == run_id)
            .values(
                status="finished",
                finished_at=now(),
                scores=score(found, times).model_dump(),
            )
        )
    return run_of(db, run_row(db, run_id))


@agent_eval_router.post("/runs/{run_id}/finish", operation_id="finish_run")
def finish_run(run_id: int, db: Database, service: AgentCalls) -> Run:
    """The dispatcher has worked every copy it was given: score the run, and move on any
    improvement round waiting for it."""
    from undercover_api.improvement import after_run  # noqa: PLC0415 - improvement imports this

    run = finish(db, run_id)
    ask_the_judge(db, service, run_id)
    if run.round_id is not None:
        after_run(db, run.round_id, service)
    return run_of(db, run_row(db, run_id))


def pairs_for(db: Connection, run_id: int) -> list[dict[str, object]]:
    """Each decided copy's explanation beside its handler's, for the judge: the decisions,
    sections and reasons only, never the claim the customer wrote."""
    rows = db.execute(
        select(claims.c.claim_id, claims.c.original_claim_id)
        .where(claims.c.run_id == run_id)
        .order_by(claims.c.claim_id)
    ).all()
    labels = labels_of(db, [original for _, original in rows])
    pairs: list[dict[str, object]] = []
    for claim_id, original in rows:
        decision = find_decision(db, claim_id)
        label = labels.get(original)
        if decision is None or label is None:
            continue
        pairs.append(
            {
                "claim_id": claim_id,
                "agent_decision": str(decision.decision),
                "agent_payout": decision.payout,
                "agent_section": decision.section,
                "agent_reason": decision.reason,
                "handler_decision": str(label.get("decision", "")),
                "handler_payout": float(label.get("payout") or 0),
                "handler_section": str(label.get("reference", "")),
                "handler_reason": str(label.get("reason", "")),
            }
        )
    return pairs


def ask_the_judge(db: Connection, service: AgentService, run_id: int) -> None:
    """Hand a finished run's explanations to the judge, once. The run is already scored, so a
    judge that can't be reached only means no grades."""
    if run_row(db, run_id)["grading_since"] is not None:
        return
    pairs = pairs_for(db, run_id)
    if not pairs:
        return
    db.execute(update(runs).where(runs.c.run_id == run_id).values(grading_since=now()))
    db.commit()
    try:
        service.judge(run_id, pairs)
    except AgentUnavailableError as error:
        log.warning("run %s: the judge couldn't be asked: %s", run_id, error)
        db.execute(update(runs).where(runs.c.run_id == run_id).values(grading_since=None))
        db.commit()


@agent_eval_router.post("/runs/{run_id}/grades", operation_id="record_grades")
def record_grades(run_id: int, body: GradesIn, db: Database) -> Run:
    """Keep the judge's grades for a run's copies. A copy already graded keeps its first grade;
    a grade for a claim outside the run is refused."""
    row = run_row(db, run_id)
    ids = set(db.execute(select(claims.c.claim_id).where(claims.c.run_id == run_id)).scalars())
    outside = [g.claim_id for g in body.grades if g.claim_id not in ids]
    if outside:
        raise HTTPException(422, f"Not copies in run {run_id}: {', '.join(outside[:5])}")
    known = set(db.execute(select(grades.c.claim_id).where(grades.c.run_id == run_id)).scalars())
    fresh = {g.claim_id: g for g in body.grades if g.claim_id not in known}
    if fresh:
        db.execute(
            insert(grades),
            [
                {
                    "claim_id": g.claim_id,
                    "run_id": run_id,
                    "score": g.score,
                    "same_grounds": g.same_grounds if g.score is not None else None,
                    "same_section": g.same_section if g.score is not None else None,
                    "note": g.note,
                    "cost": round(g.cost, 6),
                    "graded_at": now(),
                }
                for g in fresh.values()
            ],
        )
    return run_of(db, row)


def unfinished(db: Connection, run_id: int) -> list[str]:
    rows = db.execute(
        select(claims.c.claim_id).where(
            claims.c.run_id == run_id,
            claims.c.status.in_([Status.WAITING, Status.IN_PROGRESS]),
        )
    )
    return [str(claim_id) for (claim_id,) in rows]


def is_evaluation(db: Connection, claim_id: str) -> bool:
    return find_claim(db, claim_id)["source"] == EVALUATION


def version_for_attempt(db: Connection, claim_id: str) -> int | None:
    """The configuration a new attempt works with: its run's for a copy, else the current."""
    row = find_claim(db, claim_id)
    if row["source"] == EVALUATION:
        return row["config_version"]
    from undercover_api.redteam import REDTEAM_CUSTOMER, gate_version  # noqa: PLC0415

    gated = gate_version(db) if row["customer_id"] == REDTEAM_CUSTOMER else None
    return gated or current_version(db)
