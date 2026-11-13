"""Trends: what each agent did day by day, and live quality week by week.

Per agent, its model calls and cost a day over the last fortnight, and whether today is
unusual against its own daily average (an alert when it's several times more). Week by week, the
live numbers an engineer watches for drift: claims decided, decided without a person, how often
a handler disagreed, and cost per claim. Worked out in code from the records."""

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Connection, func, select

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import assistant_calls, claims, model_calls, steps
from undercover_api.dispatches import EVALUATION
from undercover_api.live import live
from undercover_api.redteam import REDTEAM_CUSTOMER

trends_router = APIRouter(prefix="/api/engineering")

TREND_DAYS = 14
WEEKS = 8
# Today is unusual at this many times the agent's usual day, and at least this many calls.
UNUSUAL_TIMES = 3
UNUSUAL_AT_LEAST = 10


class AgentDay(BaseModel):
    day: str
    calls: int
    cost: float


class AgentTrend(BaseModel):
    key: str
    label: str
    days: list[AgentDay]
    today: int
    usual: float
    unusual: bool


class Week(BaseModel):
    week_of: str
    decided: int
    straight_through_share: float | None
    disagreement_rate: float | None
    cost_per_claim: float | None


class Trends(BaseModel):
    agents: list[AgentTrend]
    weeks: list[Week]


def _days() -> list[str]:
    today = datetime.now(UTC).date()
    return [(today - timedelta(days=back)).isoformat() for back in range(TREND_DAYS - 1, -1, -1)]


def _trend(key: str, label: str, rows: list[tuple[str, int, float]]) -> AgentTrend:
    by_day = {day: (calls, cost) for day, calls, cost in rows}
    days = [
        AgentDay(day=d, calls=by_day.get(d, (0, 0.0))[0], cost=round(by_day.get(d, (0, 0.0))[1], 6))
        for d in _days()
    ]
    today = days[-1].calls
    usual = sum(d.calls for d in days[:-1]) / (len(days) - 1)
    unusual = today >= UNUSUAL_AT_LEAST and today >= UNUSUAL_TIMES * max(usual, 1)
    return AgentTrend(
        key=key, label=label, days=days, today=today, usual=round(usual, 1), unusual=unusual
    )


def agent_trends(db: Connection) -> list[AgentTrend]:
    since = _days()[0]
    day = func.substr(model_calls.c.created_at, 1, 10)
    live_claim = (claims.c.source != EVALUATION) & (claims.c.customer_id != REDTEAM_CUSTOMER)
    agent_rows = db.execute(
        select(day, func.count(model_calls.c.call_id), func.sum(model_calls.c.cost))
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(live_claim, model_calls.c.created_at >= since)
        .group_by(day)
    ).all()
    screen_day = func.substr(steps.c.created_at, 1, 10)
    screen_rows = db.execute(
        select(screen_day, func.count(steps.c.step_id), func.sum(0))
        .select_from(steps.join(claims, claims.c.claim_id == steps.c.claim_id))
        .where(live_claim, steps.c.kind == "screening", steps.c.created_at >= since)
        .group_by(screen_day)
    ).all()

    def assistant(agent: str) -> list[tuple[str, int, float]]:
        a_day = func.substr(assistant_calls.c.created_at, 1, 10)
        rows = db.execute(
            select(a_day, func.sum(assistant_calls.c.model_calls), func.sum(assistant_calls.c.cost))
            .where(assistant_calls.c.agent == agent, assistant_calls.c.created_at >= since)
            .group_by(a_day)
        ).all()
        return [(str(d), int(c or 0), float(s or 0)) for d, c, s in rows]

    def plain(rows: list[tuple[object, object, object]]) -> list[tuple[str, int, float]]:
        return [(str(d), int(c or 0), float(s or 0)) for d, c, s in rows]  # type: ignore[arg-type]

    return [
        _trend("claim_agent", "Claim agent", plain(list(agent_rows))),
        _trend("screening", "Hidden-instruction check", plain(list(screen_rows))),
        _trend("wattle", "Wattle", assistant("wattle")),
        _trend("copilot", "Copilot", assistant("copilot")),
    ]


def weekly(db: Connection) -> list[Week]:
    """The last WEEKS weeks of live claims, oldest first, each Monday to Sunday."""
    found = live(db, WEEKS * 7)
    weeks: dict[str, list[int | float]] = {}
    for one in found.series:
        monday = date.fromisoformat(one.day)
        monday -= timedelta(days=monday.weekday())
        totals = weeks.setdefault(monday.isoformat(), [0, 0, 0, 0, 0.0])
        totals[0] += one.decided
        totals[1] += one.straight_through
        totals[2] += one.reviewed
        totals[3] += one.disagreements
        totals[4] += one.cost
    return [
        Week(
            week_of=monday,
            decided=int(decided),
            straight_through_share=round(through / decided, 4) if decided else None,
            disagreement_rate=round(disagreed / reviewed, 4) if reviewed else None,
            cost_per_claim=round(cost / decided, 6) if decided else None,
        )
        for monday, (decided, through, reviewed, disagreed, cost) in sorted(weeks.items())
    ][-WEEKS:]


@trends_router.get("/trends", operation_id="get_trends")
def get_trends(_: SignedInEngineer, db: Database) -> Trends:
    """Each agent's day by day and live quality week by week."""
    return Trends(agents=agent_trends(db), weeks=weekly(db))
