"""Live numbers for the local demo home page: counts only, never a customer's details. Served
only where the local sign-in stand-in runs, so it never reaches a deployment."""

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from undercover_api.auth import Database
from undercover_api.db import claims, decisions, model_calls
from undercover_api.redteam import latest_report

demo_router = APIRouter(prefix="/api/demo")


class DemoStats(BaseModel):
    claims: int
    decided: int
    decided_by_agent: int
    average_cost: float
    redteam_held: int
    redteam_attacks: int


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
    report = latest_report(db)
    results = report.results if report else []
    return DemoStats(
        claims=total,
        decided=decided,
        decided_by_agent=by_agent,
        average_cost=round(float(spend[0]) / spend[1], 4) if spend[1] else 0.0,
        redteam_held=sum(1 for r in results if r.passed),
        redteam_attacks=len(results),
    )
