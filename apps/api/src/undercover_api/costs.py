"""Cost: where the model spend goes, day by day and by what spent it.

Model calls on claims are split by the kind of claim (live, red team, evaluation copies), and
Wattle's and the Copilot's calls come from assistant_calls. The month so far, a straight-line
projection for the month, cost per live claim decided, and the dearest claims round it out.
Worked out in code from the records, as the budget is."""

import calendar
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import Connection, case, func, select

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import assistant_calls, claims, model_calls
from undercover_api.dispatches import EVALUATION
from undercover_api.live import live
from undercover_api.redteam import REDTEAM_CUSTOMER

costs_router = APIRouter(prefix="/api/engineering")

SOURCES = {
    "live": "Live claims",
    "redteam": "Red team",
    "evaluation": "Evaluations",
    "wattle": "Wattle",
    "copilot": "Copilot",
}
DEAREST = 5


class CostDay(BaseModel):
    day: str
    live: float
    redteam: float
    evaluation: float
    assistants: float
    total: float


class CostSource(BaseModel):
    key: str
    label: str
    calls: int
    cost: float


class DearClaim(BaseModel):
    claim_id: str
    kind: str
    calls: int
    cost: float


class Costs(BaseModel):
    days: list[CostDay]
    by_source: list[CostSource]
    period_total: float
    today: float
    month_to_date: float
    projected_month: float
    cost_per_claim: float | None
    dearest: list[DearClaim]


def _kind():
    return case(
        (claims.c.source == EVALUATION, "evaluation"),
        (claims.c.customer_id == REDTEAM_CUSTOMER, "redteam"),
        else_="live",
    )


def _claim_spend(db: Connection, since: str) -> list[tuple[str, str, int, float]]:
    """(day, kind, calls, cost) for model calls on claims since a day."""
    day = func.substr(model_calls.c.created_at, 1, 10)
    kind = _kind()
    rows = db.execute(
        select(day, kind, func.count(model_calls.c.call_id), func.sum(model_calls.c.cost))
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(model_calls.c.created_at >= since)
        .group_by(day, kind)
    ).all()
    return [(str(d), str(k), int(n or 0), float(c or 0)) for d, k, n, c in rows]


def _assistant_spend(db: Connection, since: str) -> list[tuple[str, str, int, float]]:
    day = func.substr(assistant_calls.c.created_at, 1, 10)
    rows = db.execute(
        select(
            day,
            assistant_calls.c.agent,
            func.sum(assistant_calls.c.model_calls),
            func.sum(assistant_calls.c.cost),
        )
        .where(assistant_calls.c.created_at >= since)
        .group_by(day, assistant_calls.c.agent)
    ).all()
    return [(str(d), str(a), int(n or 0), float(c or 0)) for d, a, n, c in rows]


def costs_of(db: Connection, days: int) -> Costs:
    today = datetime.now(UTC).date()
    first = today - timedelta(days=days - 1)
    month_start = today.replace(day=1)
    since = min(first, month_start).isoformat()
    rows = _claim_spend(db, since) + _assistant_spend(db, since)

    by_day: dict[str, dict[str, float]] = {}
    sources: dict[str, list[float]] = {key: [0, 0.0] for key in SOURCES}
    for day, key, calls, cost in rows:
        slot = by_day.setdefault(day, {})
        bucket = "assistants" if key in ("wattle", "copilot") else key
        slot[bucket] = slot.get(bucket, 0.0) + cost
        if day >= first.isoformat() and key in sources:
            sources[key][0] += calls
            sources[key][1] += cost

    series: list[CostDay] = []
    for back in range(days - 1, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        slot = by_day.get(day, {})
        parts = {
            name: round(slot.get(name, 0.0), 6)
            for name in ("live", "redteam", "evaluation", "assistants")
        }
        series.append(CostDay(day=day, total=round(sum(parts.values()), 6), **parts))

    month = sum(
        sum(slot.values()) for day, slot in by_day.items() if day >= month_start.isoformat()
    )
    in_month = calendar.monthrange(today.year, today.month)[1]
    found = live(db, days)
    decided = found.totals.decided
    live_cost = sources["live"][1]
    return Costs(
        days=series,
        by_source=sorted(
            (
                CostSource(key=key, label=SOURCES[key], calls=int(calls), cost=round(cost, 6))
                for key, (calls, cost) in sources.items()
            ),
            key=lambda one: one.cost,
            reverse=True,
        ),
        period_total=round(sum(one.total for one in series), 6),
        today=series[-1].total,
        month_to_date=round(month, 6),
        projected_month=round(month / today.day * in_month, 2),
        cost_per_claim=round(live_cost / decided, 6) if decided else None,
        dearest=_dearest(db, first.isoformat()),
    )


def _dearest(db: Connection, since: str) -> list[DearClaim]:
    """The claims whose model calls cost most in the period, evaluation copies left out."""
    cost = func.sum(model_calls.c.cost)
    kind = _kind()
    rows = db.execute(
        select(model_calls.c.claim_id, kind, func.count(model_calls.c.call_id), cost)
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(model_calls.c.created_at >= since, claims.c.source != EVALUATION)
        .group_by(model_calls.c.claim_id, kind)
        .order_by(cost.desc())
        .limit(DEAREST)
    ).all()
    return [
        DearClaim(claim_id=str(c), kind=str(k), calls=int(n), cost=round(float(s or 0), 6))
        for c, k, n, s in rows
    ]


@costs_router.get("/costs", operation_id="get_costs")
def get_costs(
    _: SignedInEngineer, db: Database, days: Annotated[int, Query(ge=7, le=30)] = 14
) -> Costs:
    """Where the model spend goes: a day at a time, by what spent it, and the month so far."""
    return costs_of(db, days)
