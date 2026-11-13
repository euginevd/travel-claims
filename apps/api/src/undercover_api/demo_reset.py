"""Reset the demo: a senior handler starts it fresh from the dashboard's Settings, ticking what to
clear. Served only where the demo sign-in is on (a laptop, or the AWS demo), never otherwise.

- Claims and decisions: every live claim back to waiting, with nothing decided, paid, asked or
  sent; the claims customers made in testing removed; customers' saved drafts gone.
- Evaluations: every run, its copies and grades, and the improvement rounds. The agent's versions
  and the labelled claims stay, so the agent in use never changes.
- Red team: its reports and its attack claims.
- Agent off: switched off first. Payouts off: paused. Each recorded like any switch.

Refused while the agent is on or anything is still being worked, so nothing is cut off halfway.
Receipt files of removed rows stay in the store, unreachable.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Connection, Table, delete, func, insert, select, update

from undercover_api.agent_switch import agent_on, set_agent
from undercover_api.auth import Database, SeniorHandler
from undercover_api.claims import is_stalled
from undercover_api.db import (
    calculations,
    claim_drafts,
    claims,
    configurations,
    customer_requests,
    decisions,
    dispatches,
    feedback,
    grades,
    letters,
    model_calls,
    notices,
    now,
    payments,
    receipts,
    redteam_reports,
    rounds,
    runs,
    sent_back,
    setting_changes,
    spot_checks,
    steps,
)
from undercover_api.dispatches import EVALUATION
from undercover_api.kill_switch import payouts_paused, set_payouts
from undercover_api.models import Status, Strict
from undercover_api.portal import SOURCE_CUSTOMER
from undercover_api.redteam import REDTEAM_CUSTOMER

log = logging.getLogger(__name__)

# Everything that hangs off a claim, removed before the claim itself or its reset.
CLAIM_TABLES = (
    steps,
    model_calls,
    calculations,
    payments,
    decisions,
    sent_back,
    receipts,
    customer_requests,
    notices,
    letters,
    feedback,
    spot_checks,
    grades,
)

DEMO_RESET = "demo_reset"

demo_reset_router = APIRouter(prefix="/api/staff/demo/reset")


class ResetRequest(Strict):
    claims: bool = True
    evaluations: bool = False
    red_team: bool = False
    agent_off: bool = True
    payouts_off: bool = True


class ResetView(BaseModel):
    """What each tick would clear, and why a reset can't run now, if it can't."""

    claims_worked: int
    customer_claims: int
    evaluation_runs: int
    red_team_runs: int
    agent_on: bool
    payouts_paused: bool
    blocked: str | None
    evaluations_blocked: str | None
    red_team_blocked: str | None


def _count(db: Connection, table: Table, *where: ColumnElement[bool]) -> int:
    return int(db.execute(select(func.count()).select_from(table).where(*where)).scalar_one())


def _live(db: Connection) -> list[str]:
    return list(
        db.scalars(
            select(claims.c.claim_id).where(
                claims.c.source != EVALUATION, claims.c.customer_id != REDTEAM_CUSTOMER
            )
        )
    )


def _working(db: Connection, *where: ColumnElement[bool]) -> int:
    """Claims the agent is really working; a stalled one (no heartbeat) is reset with the rest."""
    rows = db.execute(
        select(claims.c.status, claims.c.heartbeat_at).where(
            claims.c.status == Status.IN_PROGRESS, *where
        )
    ).all()
    return sum(1 for status, beat in rows if not is_stalled(status, beat))


def blocked(db: Connection) -> str | None:
    """Why the claims can't be reset now, if they can't: claims being worked first, then the
    agent being on (which the reset's Agent off tick clears)."""
    working = _working(db, claims.c.source != EVALUATION, claims.c.customer_id != REDTEAM_CUSTOMER)
    if working:
        return f"wait for the {working} claim{'s' if working != 1 else ''} being worked to finish."
    if agent_on(db):
        return "turn the agent off first."
    return None


def evaluations_blocked(db: Connection) -> str | None:
    if _working(db, claims.c.source == EVALUATION):
        return "wait for the evaluation run to finish."
    return None


def red_team_blocked(db: Connection) -> str | None:
    if _working(db, claims.c.customer_id == REDTEAM_CUSTOMER):
        return "wait for the red team to finish."
    return None


def reset_view(db: Connection) -> ResetView:
    live = (claims.c.source != EVALUATION, claims.c.customer_id != REDTEAM_CUSTOMER)
    return ResetView(
        claims_worked=_count(db, claims, *live, claims.c.status != Status.WAITING),
        customer_claims=_count(db, claims, *live, claims.c.source == SOURCE_CUSTOMER),
        evaluation_runs=_count(db, runs),
        red_team_runs=_count(db, redteam_reports),
        agent_on=agent_on(db),
        payouts_paused=payouts_paused(db),
        blocked=blocked(db),
        evaluations_blocked=evaluations_blocked(db),
        red_team_blocked=red_team_blocked(db),
    )


def _clear(db: Connection, ids: list[str]) -> None:
    for table in CLAIM_TABLES:
        db.execute(delete(table).where(table.c.claim_id.in_(ids)))


def _remove(db: Connection, ids: list[str]) -> None:
    if ids:
        _clear(db, ids)
        db.execute(delete(claims).where(claims.c.claim_id.in_(ids)))


def reset_claims(db: Connection) -> None:
    """Every live claim back to waiting; customers' own claims and drafts removed."""
    made = list(
        db.scalars(
            select(claims.c.claim_id).where(
                claims.c.source == SOURCE_CUSTOMER, claims.c.customer_id != REDTEAM_CUSTOMER
            )
        )
    )
    _remove(db, made)
    seeded = _live(db)
    if seeded:
        _clear(db, seeded)
        db.execute(
            update(claims)
            .where(claims.c.claim_id.in_(seeded))
            .values(
                status=Status.WAITING,
                thread_id=None,
                attempts=0,
                review_requested_at=None,
                review_note=None,
                config_version=None,
                heartbeat_at=None,
                recoveries=0,
                ready_at=None,
            )
        )
    db.execute(delete(claim_drafts))
    db.execute(delete(dispatches))


def reset_evaluations(db: Connection) -> None:
    """Every run with its copies and grades, and the improvement rounds; versions stay, and one
    still being tested is marked not taken."""
    _remove(db, list(db.scalars(select(claims.c.claim_id).where(claims.c.source == EVALUATION))))
    db.execute(delete(grades))
    db.execute(delete(rounds))
    db.execute(delete(runs))
    # A version still being tested lost its round with the rest: it was never taken.
    db.execute(
        update(configurations)
        .where(configurations.c.status.in_(("proposed", "candidate")))
        .values(status="rejected")
    )


def reset_red_team(db: Connection) -> None:
    red = claims.c.customer_id == REDTEAM_CUSTOMER
    ids = list(db.scalars(select(claims.c.claim_id).where(red)))
    _remove(db, ids)
    db.execute(delete(redteam_reports))


@demo_reset_router.get("", operation_id="get_demo_reset")
def get_demo_reset(_: SeniorHandler, db: Database) -> ResetView:
    """What a reset would clear, for the confirm card."""
    return reset_view(db)


@demo_reset_router.post("", operation_id="reset_demo")
def reset_demo(request: ResetRequest, handler: SeniorHandler, db: Database) -> ResetView:
    """Clear what's ticked, as the senior handler signed in, and start the agent switch fresh."""
    if not any(request.model_dump().values()):
        raise HTTPException(422, "Tick at least one thing to clear")
    if request.agent_off and agent_on(db):
        set_agent(db, handler, on=False, reason="Reset the demo")
        # Kept even if the reset must wait for claims being worked: the agent stays off.
        db.commit()
    reason = (
        (request.claims and blocked(db))
        or (request.evaluations and evaluations_blocked(db))
        or (request.red_team and red_team_blocked(db))
    )
    if reason:
        raise HTTPException(409, f"Not now: {reason}")
    if request.payouts_off and not payouts_paused(db):
        set_payouts(db, True, "Reset the demo", handler)
    if request.claims:
        reset_claims(db)
    if request.evaluations:
        reset_evaluations(db)
    if request.red_team:
        reset_red_team(db)
    db.execute(
        insert(setting_changes).values(
            key=DEMO_RESET,
            value=request.model_dump(),
            changed_by=handler.name,
            changed_by_id=handler.handler_id,
            changed_at=now(),
        )
    )
    log.warning(
        "demo reset by handler %s: %s",
        handler.handler_id,
        ", ".join(k for k, v in request.model_dump().items() if v),
    )
    return reset_view(db)
