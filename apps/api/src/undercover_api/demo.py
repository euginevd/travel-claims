"""Live numbers for the local demo home page: counts only, never a customer's details. Served
only where the local sign-in stand-in runs, so it never reaches a deployment."""

from datetime import datetime
from statistics import median

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from undercover_api.auth import Database
from undercover_api.db import claims, decisions, model_calls, steps
from undercover_api.models import DecisionKind, Status
from undercover_api.redteam import latest_report

demo_router = APIRouter(prefix="/api/demo")


class DemoStats(BaseModel):
    claims: int
    decided: int
    decided_by_agent: int
    average_cost: float
    redteam_held: int
    redteam_attacks: int
    agent_seconds: int
    need_a_handler: int


@demo_router.get("/stats", operation_id="get_demo_stats")
def demo_stats(db: Database) -> DemoStats:
    """How much the agent has decided on its own, what a claim costs, and the red team's score."""
    real = claims.c.source != "evaluation"
    total = db.execute(select(func.count()).select_from(claims).where(real)).scalar_one()
    decided = db.execute(
        select(func.count()).select_from(decisions.join(claims)).where(real)
    ).scalar_one()
    by_agent = db.execute(
        select(func.count())
        .select_from(decisions.join(claims))
        .where(
            real, decisions.c.decided_by.like("UnderCover Agent%"), decisions.c.override.is_(None)
        )
    ).scalar_one()
    spend = db.execute(
        select(
            func.coalesce(func.sum(model_calls.c.cost), 0),
            func.count(func.distinct(model_calls.c.claim_id)),
        )
        .select_from(model_calls.join(claims))
        .where(real)
    ).one()
    # How long the agent takes on a claim it decides itself: its first step to its decision.
    timed = db.execute(
        select(decisions.c.decided_at, func.min(steps.c.created_at))
        .select_from(decisions.join(claims).join(steps, steps.c.claim_id == claims.c.claim_id))
        .where(real, decisions.c.decided_by.like("UnderCover Agent%"))
        .group_by(decisions.c.claim_id, decisions.c.decided_at)
    ).all()
    seconds = [
        (datetime.fromisoformat(done) - datetime.fromisoformat(first)).total_seconds()
        for done, first in timed
        if done and first
    ]
    # Claims waiting on a handler's judgement: sign-offs, referrals and review requests.
    waiting = db.execute(
        select(
            claims.c.claim_id, claims.c.status, claims.c.review_requested_at, decisions.c.decision
        )
        .select_from(claims.outerjoin(decisions))
        .where(real)
    ).all()
    need = sum(
        1
        for _, status, review, decision in waiting
        if status in (Status.WAITING_FOR_SIGN_OFF, Status.LEFT_FOR_HANDLER)
        or (status == Status.DECIDED and (decision == DecisionKind.REFER or review is not None))
    )
    report = latest_report(db)
    results = report.results if report else []
    return DemoStats(
        claims=total,
        decided=decided,
        decided_by_agent=by_agent,
        average_cost=round(float(spend[0]) / spend[1], 4) if spend[1] else 0.0,
        redteam_held=sum(1 for r in results if r.passed),
        redteam_attacks=len(results),
        agent_seconds=round(median(seconds)) if seconds else 0,
        need_a_handler=need,
    )
