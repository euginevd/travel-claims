"""Evaluations: copies of a labelled set worked by the dispatcher, scored against the handlers'
decisions, and the claim agent's configuration in versions.

A copy lives in the claims table with source "evaluation" and its run: it never shows in the
queue or a customer's claims, an approval on it settles as decided without paying, and nobody
signs it off. The labels never reach the agent, except the evaluation set's misses the improver
reads (improvement.py); the held-out set's never leave the api.
"""

import logging
from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, CursorResult, RowMapping, func, insert, select, update

from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SeniorHandler, SignedIn, require_agent
from undercover_api.claims import find_claim, find_decision
from undercover_api.db import (
    claims,
    configurations,
    labelled_claims,
    model_calls,
    now,
    runs,
    settings,
    steps,
)
from undercover_api.models import ClaimId, DecisionKind, Status, Strict

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

AGENT = [Depends(require_agent)]
staff_eval_router = APIRouter(prefix="/api/staff")
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


class RunClaim(BaseModel):
    claim_id: str
    original_claim_id: str
    summary: str
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


@staff_eval_router.get("/configuration", operation_id="list_configurations")
def list_configurations(_: SignedIn, db: Database) -> list[Configuration]:
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


def create_run(
    db: Connection, body: StartRunRequest, version: int, by: str, round_id: int | None = None
) -> tuple[int, list[str]]:
    """A new run with its copies, waiting for the dispatcher."""
    chosen = labelled(db, body.label_set, body.size)
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
    body: StartRunRequest, handler: SeniorHandler, db: Database, service: AgentCalls
) -> Run:
    """Start an evaluation of the current configuration on a labelled set."""
    run_id, ids = create_run(db, body, need_current(db), handler.name)
    dispatch(db, service, run_id, ids, body.concurrency)
    return run_of(run_row(db, run_id))


@staff_eval_router.post("/runs/{run_id}/resume", operation_id="resume_run")
def resume_run(run_id: int, _: SeniorHandler, db: Database, service: AgentCalls) -> Run:
    """Hand a run's unfinished copies to the dispatcher again, after a restart: each carries on
    from its saved progress, and nothing is decided twice."""
    row = run_row(db, run_id)
    left = unfinished(db, run_id)
    if row["status"] == "finished" or not left:
        raise HTTPException(409, f"Run {run_id} has nothing left to work")
    db.execute(update(runs).where(runs.c.run_id == run_id).values(status="running"))
    dispatch(db, service, run_id, left, row["concurrency"])
    return run_of(run_row(db, run_id))


def run_row(db: Connection, run_id: int) -> RowMapping:
    row = db.execute(select(runs).where(runs.c.run_id == run_id)).mappings().first()
    if row is None:
        raise HTTPException(404, f"Run {run_id} not found")
    return row


def run_of(row: RowMapping) -> Run:
    return Run.model_validate(dict(row))


def labels_of(db: Connection, original_ids: list[str]) -> dict[str, dict[str, Any]]:
    rows = db.execute(
        select(labelled_claims.c.claim_id, labelled_claims.c.label).where(
            labelled_claims.c.claim_id.in_(original_ids)
        )
    )
    return {claim_id: dict(label) for claim_id, label in rows}


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
            )
        )
    return found, times


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
def list_runs(_: SignedIn, db: Database) -> list[Run]:
    """Every run, newest first, with its scores once finished."""
    rows = db.execute(select(runs).order_by(runs.c.run_id.desc())).mappings()
    return [run_of(r) for r in rows]


@staff_eval_router.get("/runs/{run_id}", operation_id="get_run")
def get_run(run_id: int, _: SignedIn, db: Database) -> RunInFull:
    """A run with each copy beside the handler's decision, and live scores."""
    row = run_row(db, run_id)
    found, times = run_claims(db, run_id)
    scores = Scores.model_validate(row["scores"]) if row["scores"] else score(found, times)
    return RunInFull.model_validate(dict(row) | {"scores": scores, "claims": found})


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
    return run_of(run_row(db, run_id))


@agent_eval_router.post("/runs/{run_id}/finish", operation_id="finish_run")
def finish_run(run_id: int, db: Database, service: AgentCalls) -> Run:
    """The dispatcher has worked every copy it was given: score the run, and move on any
    improvement round waiting for it."""
    from undercover_api.improvement import after_run  # noqa: PLC0415 - improvement imports this

    run = finish(db, run_id)
    if run.round_id is not None:
        after_run(db, run.round_id, service)
    return run


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
    return current_version(db)
