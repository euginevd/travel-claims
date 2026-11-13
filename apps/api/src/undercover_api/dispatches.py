"""Dispatches: a senior handler sends claim agents, 1 to 25 at once, through the claims waiting in
the queue, oldest first. The agent's dispatcher starts each one with start_claim's compare-and-set,
so a handler's Work this claim or a retry at the same moment starts it once (threat model R25).
Payments are unchanged: code pays an approval under the limit and the kill switch still holds.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Connection, RowMapping, insert, select, update

from undercover_api.agent_service import AgentUnavailableError
from undercover_api.auth import Database, SeniorHandler, SignedIn, require_agent
from undercover_api.claims import find_decision
from undercover_api.db import claims, dispatches, now, runs
from undercover_api.evaluations import AgentCalls, costs_of, new_id
from undercover_api.models import DecisionKind, Status, Strict
from undercover_api.redteam import REDTEAM_CUSTOMER

log = logging.getLogger(__name__)

EVALUATION = "evaluation"
RUNNING = "running"
# The most claims one dispatch takes, oldest first, as the agent's /dispatch accepts.
MAX_CLAIMS = 50

staff_dispatch_router = APIRouter(prefix="/api/staff/dispatches")
agent_dispatch_router = APIRouter(
    prefix="/api/agent/dispatches", dependencies=[Depends(require_agent)]
)


class StartDispatchRequest(Strict):
    concurrency: int = Field(ge=1, le=25)


class DispatchClaim(BaseModel):
    claim_id: str
    summary: str
    status: Status
    decision: DecisionKind | None
    payout: float | None
    cost: float


class Dispatch(BaseModel):
    dispatch_id: int
    concurrency: int
    status: str
    started_by: str
    started_at: str
    finished_at: str | None
    stopped_reason: str | None
    claims: list[DispatchClaim]
    worked: int = Field(description="Claims no longer waiting or in progress")
    decided: int
    waiting_for_sign_off: int
    referred: int
    not_started: int
    total_cost: float


class LatestDispatch(BaseModel):
    """The newest dispatch, if any, and how many live claims are waiting now."""

    waiting: int
    dispatch: Dispatch | None


def waiting_claims(db: Connection) -> list[str]:
    """Live claims waiting in the queue, oldest first: never evaluation copies or the red team's."""
    return list(
        db.execute(
            select(claims.c.claim_id)
            .where(
                claims.c.status == Status.WAITING,
                claims.c.source != EVALUATION,
                claims.c.customer_id != REDTEAM_CUSTOMER,
            )
            .order_by(claims.c.submitted_on, claims.c.claim_id)
        ).scalars()
    )


# A dispatch that hasn't reported back by then, with none of its claims still being worked, has
# lost its agent (a restart, a failed call): it's stopped, so it can't block every later one.
STALE_AFTER = timedelta(minutes=30)


def stop_stale(db: Connection) -> None:
    """Stop a running dispatch that started long ago and has no claim in progress."""
    cutoff = (datetime.now(UTC) - STALE_AFTER).isoformat(timespec="seconds")
    for row in db.execute(
        select(dispatches.c.dispatch_id, dispatches.c.claim_ids).where(
            dispatches.c.status == RUNNING, dispatches.c.started_at < cutoff
        )
    ).mappings():
        ids = [str(i) for i in cast(list[object], row["claim_ids"] or [])]
        working = (
            ids
            and db.execute(
                select(claims.c.claim_id).where(
                    claims.c.claim_id.in_(ids), claims.c.status == Status.IN_PROGRESS
                )
            ).first()
        )
        if not working:
            db.execute(
                update(dispatches)
                .where(
                    dispatches.c.dispatch_id == row["dispatch_id"], dispatches.c.status == RUNNING
                )
                .values(
                    status="stopped",
                    finished_at=now(),
                    stopped_reason="The agent never reported back",
                )
            )


def something_running(db: Connection) -> str | None:
    """What's already going, if anything: one dispatch or evaluation run at a time."""
    stop_stale(db)
    if db.execute(select(dispatches.c.dispatch_id).where(dispatches.c.status == RUNNING)).first():
        return "A dispatch is already running"
    if db.execute(select(runs.c.run_id).where(runs.c.status == RUNNING)).first():
        return "An evaluation run is going. Start the dispatch when it finishes"
    return None


def dispatch_row(db: Connection, dispatch_id: int) -> RowMapping:
    row = (
        db.execute(select(dispatches).where(dispatches.c.dispatch_id == dispatch_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, f"Dispatch {dispatch_id} not found")
    return row


def dispatch_of(db: Connection, row: RowMapping) -> Dispatch:
    """A dispatch with where each of its claims is now, and its cost so far."""
    ids = [str(i) for i in row["claim_ids"]]
    found = {
        r["claim_id"]: r
        for r in db.execute(
            select(claims.c.claim_id, claims.c.summary, claims.c.status).where(
                claims.c.claim_id.in_(ids)
            )
        ).mappings()
    }
    costs = costs_of(db, ids)
    listed: list[DispatchClaim] = []
    for claim_id in ids:
        claim = found.get(claim_id)
        if claim is None:
            continue
        decision = find_decision(db, claim_id)
        listed.append(
            DispatchClaim(
                claim_id=claim_id,
                summary=claim["summary"],
                status=claim["status"],
                decision=decision.decision if decision else None,
                payout=decision.payout if decision else None,
                cost=round(costs.get(claim_id, 0.0), 6),
            )
        )

    def count(*statuses: Status) -> int:
        return sum(1 for c in listed if c.status in statuses)

    return Dispatch.model_validate(
        dict(row)
        | {
            "claims": listed,
            "worked": len(listed) - count(Status.WAITING, Status.IN_PROGRESS),
            "decided": count(Status.DECIDED),
            "waiting_for_sign_off": count(Status.WAITING_FOR_SIGN_OFF),
            "referred": sum(
                1
                for c in listed
                if c.decision == DecisionKind.REFER or c.status == Status.LEFT_FOR_HANDLER
            ),
            "not_started": count(Status.WAITING),
            "total_cost": round(sum(c.cost for c in listed), 6),
        }
    )


@staff_dispatch_router.post("", operation_id="start_dispatch", status_code=201)
def start_dispatch(
    body: StartDispatchRequest,
    handler: SeniorHandler,
    db: Database,
    service: AgentCalls,
) -> Dispatch:
    """Send claim agents through the claims waiting now, oldest first."""
    going = something_running(db)
    if going:
        raise HTTPException(409, going)
    ids = waiting_claims(db)[:MAX_CLAIMS]
    if not ids:
        raise HTTPException(409, "Nothing is waiting, so there's nothing to dispatch")
    dispatch_id = new_id(
        db.execute(
            insert(dispatches).values(
                concurrency=body.concurrency,
                claim_ids=ids,
                status=RUNNING,
                started_by=handler.name,
                started_at=now(),
            )
        )
    )
    db.commit()
    try:
        service.dispatch(dispatch_id, ids, body.concurrency, kind="dispatch")
    except AgentUnavailableError as error:
        db.execute(
            update(dispatches)
            .where(dispatches.c.dispatch_id == dispatch_id)
            .values(status="stopped", finished_at=now(), stopped_reason=str(error)[:500])
        )
        db.commit()
        raise HTTPException(503, f"The dispatch couldn't start: {error}") from error
    log.info("dispatch %s started with %s claims", dispatch_id, len(ids))
    return dispatch_of(db, dispatch_row(db, dispatch_id))


@staff_dispatch_router.get("/latest", operation_id="get_latest_dispatch")
def get_latest_dispatch(_: SignedIn, db: Database) -> LatestDispatch:
    """The newest dispatch with its progress, for every handler, and how many claims wait now."""
    row = (
        db.execute(select(dispatches).order_by(dispatches.c.dispatch_id.desc()).limit(1))
        .mappings()
        .first()
    )
    return LatestDispatch(
        waiting=len(waiting_claims(db)),
        dispatch=dispatch_of(db, row) if row else None,
    )


@agent_dispatch_router.post("/{dispatch_id}/finish", operation_id="finish_dispatch")
def finish_dispatch(dispatch_id: int, db: Database) -> Dispatch:
    """The dispatcher has worked every claim it was given."""
    row = dispatch_row(db, dispatch_id)
    if row["status"] == RUNNING:
        db.execute(
            update(dispatches)
            .where(dispatches.c.dispatch_id == dispatch_id)
            .values(status="finished", finished_at=now())
        )
    return dispatch_of(db, dispatch_row(db, dispatch_id))
