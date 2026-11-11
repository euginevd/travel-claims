"""The success criteria: whether the agent is meeting its objectives, worked out in code from
the latest held-out run's stored scores and the payments table. No model is asked.
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import Connection, RowMapping, select

from undercover_api.auth import Database, SignedIn, SignedInEngineer
from undercover_api.business_settings import accuracy_objective, straight_through_objective
from undercover_api.db import claims, decisions, handlers, payments, runs
from undercover_api.evaluations import EVALUATION, Scores, current_version
from undercover_api.payout import needs_sign_off

HELD_OUT = "held_out"
NO_RUN = "No held-out run of the version in use yet"

staff_success_router = APIRouter(prefix="/api/staff/success-criteria")
engineer_success_router = APIRouter(prefix="/api/engineering/success-criteria")


class Criterion(BaseModel):
    key: str
    label: str
    unit: Literal["share", "count"]
    target: float
    actual: float | None
    met: bool | None = Field(description="None when there is nothing yet to measure")
    detail: str


class SuccessCriteria(BaseModel):
    met: bool = Field(description="Whether every criterion is met; one with no data isn't")
    criteria: list[Criterion]


def latest_held_out_run(db: Connection) -> RowMapping | None:
    """The newest finished run on the held-out set that has its scores, of the version in use,
    so a candidate tried but not kept never grades the agent that's working claims."""
    query = select(runs).where(runs.c.label_set == HELD_OUT, runs.c.status == "finished")
    current = current_version(db)
    if current is not None:
        query = query.where(runs.c.config_version == current)
    row = db.execute(query.order_by(runs.c.run_id.desc()).limit(1)).mappings().first()
    return row if row is not None and row["scores"] else None


def run_detail(db: Connection, run: RowMapping, scores: Scores) -> str:
    """Which run a figure comes from, and whether it's the version now in use."""
    detail = (
        f"Run {run['run_id']}, held-out set ({run['size']}), "
        f"v{run['config_version']}, {scores.claims} claims"
    )
    current = current_version(db)
    if current is not None and current != run["config_version"]:
        detail += f"; the version in use is v{current}"
    return detail


def objective(key: str, label: str, target: float, actual: float | None, detail: str) -> Criterion:
    return Criterion(
        key=key,
        label=label,
        unit="share",
        target=target,
        actual=actual,
        met=None if actual is None else actual >= target,
        detail=detail,
    )


def unsigned_payments(db: Connection) -> tuple[int, int]:
    """How many live claims were paid over the approval limit their decision was made under,
    and how many of those no handler signed off. A payment with no decision counts as over."""
    rows = db.execute(
        select(payments.c.amount, payments.c.signed_off_by_id, decisions.c.approval_limit)
        .select_from(
            payments.join(claims, claims.c.claim_id == payments.c.claim_id).outerjoin(
                decisions, decisions.c.claim_id == payments.c.claim_id
            )
        )
        .where(claims.c.source != EVALUATION)
    ).all()
    people = set(db.execute(select(handlers.c.handler_id)).scalars())
    over = [
        signed_off_by_id
        for amount, signed_off_by_id, limit in rows
        if limit is None or needs_sign_off(amount, limit)
    ]
    return len(over), sum(1 for signed_off_by_id in over if signed_off_by_id not in people)


def sign_off_criterion(db: Connection) -> Criterion:
    over, unsigned = unsigned_payments(db)
    if over == 0:
        detail = "No payment has gone over the approval limit yet"
    elif unsigned == 0:
        detail = f"{over} paid over the approval limit, each signed off by a person"
    else:
        detail = f"{unsigned} of {over} paid over the approval limit with no person's sign-off"
    return Criterion(
        key="signed_off",
        label="Payments over the limit without a person's sign-off",
        unit="count",
        target=0,
        actual=unsigned,
        met=unsigned == 0,
        detail=detail,
    )


def success_criteria(db: Connection) -> SuccessCriteria:
    run = latest_held_out_run(db)
    scores = Scores.model_validate(run["scores"]) if run is not None else None
    detail = run_detail(db, run, scores) if run is not None and scores is not None else NO_RUN
    criteria = [
        objective(
            "straight_through",
            "Straight through",
            straight_through_objective(db),
            scores.straight_through if scores else None,
            detail,
        ),
        objective(
            "accuracy",
            "Held-out accuracy",
            accuracy_objective(db),
            scores.accuracy if scores else None,
            detail,
        ),
        sign_off_criterion(db),
    ]
    return SuccessCriteria(met=all(c.met is True for c in criteria), criteria=criteria)


@staff_success_router.get("", operation_id="get_success_criteria")
def get_success_criteria(_: SignedIn, db: Database) -> SuccessCriteria:
    """Whether the agent is meeting its objectives, for handlers."""
    return success_criteria(db)


@engineer_success_router.get("", operation_id="get_success_criteria_for_engineers")
def get_success_criteria_for_engineers(_: SignedInEngineer, db: Database) -> SuccessCriteria:
    """Whether the agent is meeting its objectives, for the AI engineers' console."""
    return success_criteria(db)
