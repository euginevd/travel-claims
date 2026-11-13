"""The agents' daily budget: what their model calls cost today, against a limit engineers set.

When today's spend reaches the limit, the agent switch turns off on its own (agent_switch
checks this each time the watcher asks for work), and the audit log says why. Evaluation runs
keep their own per-run spending limits, so only live and red-team calls count here."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, func, insert, select, update

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import claims, model_calls, now, setting_changes, settings
from undercover_api.dispatches import EVALUATION
from undercover_api.models import Strict

BUDGET = "agent_daily_budget"
DEFAULT_BUDGET = 5.0
# Above this share of the budget, the control plane warns before the agent stops.
WARN_SHARE = 0.8
BUDGET_GUARD = "Budget guard"

budget_router = APIRouter(prefix="/api/engineering/budget")


class ModelSpend(BaseModel):
    model: str
    calls: int
    cost: float


class Budget(BaseModel):
    limit: float
    spent_today: float
    share: float
    by_model: list[ModelSpend]
    changed_by: str | None
    changed_at: str | None


class BudgetRequest(Strict):
    limit: float = Field(ge=0.5, le=1000, description="Dollars a day for the agents' model calls")
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


def today() -> str:
    return datetime.now(UTC).date().isoformat()


def budget_limit(db: Connection) -> float:
    value = db.execute(select(settings.c.value).where(settings.c.key == BUDGET)).scalar()
    return float(value) if isinstance(value, int | float) else DEFAULT_BUDGET


def spend_today(db: Connection) -> list[ModelSpend]:
    """Today's model calls on live and red-team claims, by model, dearest first."""
    cost = func.sum(model_calls.c.cost)
    rows = db.execute(
        select(model_calls.c.model, func.count(model_calls.c.call_id), cost)
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(claims.c.source != EVALUATION, model_calls.c.created_at >= today())
        .group_by(model_calls.c.model)
        .order_by(cost.desc())
    ).all()
    return [
        ModelSpend(model=str(model), calls=int(calls), cost=round(float(spent or 0), 6))
        for model, calls, spent in rows
    ]


def spent_today(db: Connection) -> float:
    return round(sum(one.cost for one in spend_today(db)), 6)


def over_budget(db: Connection) -> bool:
    return spent_today(db) >= budget_limit(db)


def budget_of(db: Connection) -> Budget:
    limit = budget_limit(db)
    by_model = spend_today(db)
    spent = round(sum(one.cost for one in by_model), 6)
    last = (
        db.execute(
            select(setting_changes.c.changed_by, setting_changes.c.changed_at)
            .where(setting_changes.c.key == BUDGET)
            .order_by(setting_changes.c.change_id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    return Budget(
        limit=limit,
        spent_today=spent,
        share=round(spent / limit, 4) if limit else 0,
        by_model=by_model,
        changed_by=last["changed_by"] if last else None,
        changed_at=last["changed_at"] if last else None,
    )


@budget_router.get("", operation_id="get_budget")
def get_budget(_: SignedInEngineer, db: Database) -> Budget:
    """Today's model spend against the daily budget."""
    return budget_of(db)


@budget_router.put("", operation_id="set_budget")
def put_budget(request: BudgetRequest, engineer: SignedInEngineer, db: Database) -> Budget:
    """Set the daily budget; the change and its reason go in the audit log."""
    old = budget_limit(db)
    stamp = now()
    found = db.execute(select(settings.c.key).where(settings.c.key == BUDGET)).scalar()
    if found is None:
        db.execute(
            insert(settings).values(
                key=BUDGET, value=request.limit, changed_by=engineer.name, changed_at=stamp
            )
        )
    else:
        db.execute(
            update(settings)
            .where(settings.c.key == BUDGET)
            .values(value=request.limit, changed_by=engineer.name, changed_at=stamp)
        )
    db.execute(
        insert(setting_changes).values(
            key=BUDGET,
            value=request.limit,
            old_value=old,
            reason=request.reason or None,
            changed_by=engineer.name,
            changed_by_id=engineer.engineer_id,
            changed_at=stamp,
        )
    )
    return budget_of(db)
