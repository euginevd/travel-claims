"""The agent switch: a senior handler turns the claim agent on or off for the live queue.

Off, every claim waits until a handler presses Work this claim. On, the agent's watcher works
each waiting claim, a few at once, including those customers send while it's on; a customer's
claim is picked up once nothing has been added to it for a short while, so its receipts are in.
Off stops new work; claims already in progress finish. Payouts are unchanged: an approval over
the limit still waits for a sign-off, and paused payouts still hold.

A reset can turn it off as part of starting fresh.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import ColumnElement, Connection, insert, or_, select, update

from undercover_api.agent_service import AgentUnavailableError
from undercover_api.auth import Database, SeniorHandler, SignedIn, require_agent
from undercover_api.budget import BUDGET_GUARD, budget_limit, over_budget
from undercover_api.business_settings import AGENTS_AT_ONCE, stored
from undercover_api.db import claims, now, setting_changes, settings
from undercover_api.dispatches import EVALUATION
from undercover_api.evaluations import AgentCalls
from undercover_api.models import Handler, Status, Strict
from undercover_api.redteam import REDTEAM_CUSTOMER

log = logging.getLogger(__name__)

AGENT_SWITCH = "agent_switch"
WATCHER_SEEN = "agent_watcher_seen"
# A customer's claim is worked once nothing has been added to it for this long.
SETTLE_SECONDS = 20
# The watcher asks every few seconds; quiet for longer than this, it's started again.
WATCHER_LOST_SECONDS = 45
MOST_AT_ONCE = 50

staff_agent_router = APIRouter(prefix="/api/staff/agent")
agent_queue_router = APIRouter(prefix="/api/agent/queue", dependencies=[Depends(require_agent)])


class AgentSwitch(BaseModel):
    on: bool
    reason: str | None = Field(description="Why it was last switched")
    changed_by: str | None
    changed_at: str | None
    working: int = Field(description="Live claims the agent is working now")
    waiting: int = Field(description="Live claims waiting for the agent")


class AgentSwitchRequest(Strict):
    """A senior handler turning the agent on or off, with why."""

    on: bool
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


# Who the audit log names when the budget, not a person, turns the agent off.
BUDGET_HANDLER = Handler(
    handler_id="SYSTEM",
    name=BUDGET_GUARD,
    role="system",
    email="budget@undercover.example",
    can_approve_over_limit=False,
)


class ReadyQueue(BaseModel):
    on: bool
    concurrency: int
    claim_ids: list[str]


def _value(db: Connection) -> dict[str, object]:
    row: object = db.execute(
        select(settings.c.value).where(settings.c.key == AGENT_SWITCH)
    ).scalar()
    return cast("dict[str, object]", row) if isinstance(row, dict) else {}


def agent_on(db: Connection) -> bool:
    """Whether the agent works the live queue; missing or malformed reads as off."""
    return _value(db).get("on") is True


def live(status: Status) -> ColumnElement[bool]:
    return (
        (claims.c.status == status)
        & (claims.c.source != EVALUATION)
        & (claims.c.customer_id != REDTEAM_CUSTOMER)
    )


def agent_switch(db: Connection) -> AgentSwitch:
    value = _value(db)
    row = db.execute(select(settings).where(settings.c.key == AGENT_SWITCH)).mappings().first()

    def count(status: Status) -> int:
        return len(db.execute(select(claims.c.claim_id).where(live(status))).all())

    return AgentSwitch(
        on=value.get("on") is True,
        reason=reason if isinstance(reason := value.get("reason"), str) else None,
        changed_by=row["changed_by"] if row else None,
        changed_at=row["changed_at"] if row else None,
        working=count(Status.IN_PROGRESS),
        waiting=count(Status.WAITING),
    )


def _put(db: Connection, key: str, value: object, handler_name: str, at: str) -> None:
    values = {"value": value, "changed_by": handler_name, "changed_at": at}
    if not db.execute(update(settings).where(settings.c.key == key).values(**values)).rowcount:
        db.execute(insert(settings).values(key=key, **values))


def set_agent(db: Connection, handler: Handler, *, on: bool, reason: str) -> AgentSwitch:
    """Change the switch, keeping each change in the audit history."""
    value = _value(db)
    wanted = {"on": on, "reason": reason or None}
    stamp = now()
    _put(db, AGENT_SWITCH, wanted, handler.name, stamp)
    db.execute(
        insert(setting_changes).values(
            key=AGENT_SWITCH,
            value=wanted,
            old_value=value or None,
            reason=reason or None,
            changed_by=handler.name,
            changed_by_id=handler.handler_id,
            changed_at=stamp,
        )
    )
    return agent_switch(db)


def watcher_lost(db: Connection) -> bool:
    seen = db.execute(select(settings.c.value).where(settings.c.key == WATCHER_SEEN)).scalar()
    if not isinstance(seen, str):
        return True
    since = datetime.now(UTC) - datetime.fromisoformat(seen)
    return since > timedelta(seconds=WATCHER_LOST_SECONDS)


def start_watcher(db: Connection, service: AgentCalls) -> None:
    """Ask the agent to watch the queue; it keeps one watcher, so asking twice is harmless."""
    db.commit()
    service.watch(int(stored(db, AGENTS_AT_ONCE)))


@staff_agent_router.get("", operation_id="get_agent_switch")
def get_agent_switch(_: SignedIn, db: Database, service: AgentCalls) -> AgentSwitch:
    """Whether the agent works the live queue, and how many claims it's working. When it's on
    but its watcher has gone quiet (the agent restarted), the watcher is started again."""
    if agent_on(db) and watcher_lost(db):
        try:
            start_watcher(db, service)
        except AgentUnavailableError as error:
            log.warning("the agent's watcher couldn't be started again: %s", error)
    return agent_switch(db)


@staff_agent_router.put("", operation_id="set_agent_switch")
def put_agent_switch(
    request: AgentSwitchRequest, handler: SeniorHandler, db: Database, service: AgentCalls
) -> AgentSwitch:
    """Turn the agent on or off for the live queue, as the senior handler signed in."""
    was_on = agent_on(db)
    switch = set_agent(db, handler, on=request.on, reason=request.reason)
    if switch.on and not was_on:
        try:
            start_watcher(db, service)
        except AgentUnavailableError as error:
            set_agent(db, handler, on=False, reason="The agent couldn't start")
            db.commit()
            raise HTTPException(503, f"The agent couldn't start: {error}") from error
    log.warning("agent switched %s by handler %s", "on" if switch.on else "off", handler.handler_id)
    return switch


@agent_queue_router.get("/ready", operation_id="get_ready_claims")
def ready_claims(db: Database) -> ReadyQueue:
    """For the agent's watcher: whether the agent is on, how many to work at once, and the live
    claims ready to start, oldest first. Each ask also says the watcher is alive."""
    _put(db, WATCHER_SEEN, now(), "UnderCover Agent", now())
    if agent_on(db) and over_budget(db):
        # The day's model spend reached the budget: the agent stops taking new claims.
        set_agent(
            db,
            BUDGET_HANDLER,
            on=False,
            reason=f"Daily budget of ${budget_limit(db):,.2f} reached",
        )
    if not agent_on(db):
        return ReadyQueue(on=False, concurrency=0, claim_ids=[])
    settled = (datetime.now(UTC) - timedelta(seconds=SETTLE_SECONDS)).isoformat(timespec="seconds")
    ids = db.execute(
        select(claims.c.claim_id)
        .where(live(Status.WAITING), or_(claims.c.ready_at.is_(None), claims.c.ready_at <= settled))
        .order_by(claims.c.submitted_on, claims.c.claim_id)
        .limit(MOST_AT_ONCE)
    ).scalars()
    return ReadyQueue(on=True, concurrency=int(stored(db, AGENTS_AT_ONCE)), claim_ids=list(ids))
