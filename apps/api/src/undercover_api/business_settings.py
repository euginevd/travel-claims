"""The settings a senior handler changes on the dashboard's Settings page: the approval limit,
a round's spending limit, the agent's two objectives and how many claim agents work at once.

Every handler reads them, and the AI engineers read them in the console; only a handler who can
sign off over the approval limit changes them, within fixed ranges, and each changed value is
kept in the audit history with who, when, the value before and the reason.

A new approval limit applies to decisions made after it. Each decision records the limit it was
made under, a payout held for sign-off stays held whatever the limit becomes, and nothing
already paid is touched (payments.py).
"""

import logging
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, insert, select, update

from undercover_api.auth import Database, SeniorHandler, SignedIn, SignedInEngineer
from undercover_api.claims import APPROVAL_LIMIT, approval_limit
from undercover_api.db import now, setting_changes, settings
from undercover_api.improvement import SPEND_LIMIT, spend_limit
from undercover_api.models import Handler, Strict

log = logging.getLogger(__name__)

ACCURACY_OBJECTIVE = "accuracy_objective"
STRAIGHT_THROUGH_OBJECTIVE = "straight_through_objective"
AGENTS_AT_ONCE = "agents_at_once"
DEFAULTS: dict[str, float] = {
    ACCURACY_OBJECTIVE: 0.8,
    STRAIGHT_THROUGH_OBJECTIVE: 0.7,
    AGENTS_AT_ONCE: 5,
}
# The lowest and highest value each setting takes; the pages show the same ranges.
RANGES: dict[str, tuple[float, float]] = {
    APPROVAL_LIMIT: (100, 5000),
    SPEND_LIMIT: (0.5, 10),
    ACCURACY_OBJECTIVE: (0.5, 1),
    STRAIGHT_THROUGH_OBJECTIVE: (0, 1),
    AGENTS_AT_ONCE: (1, 25),
}
# Money is kept to the cent and a share to a hundredth of a percent.
DECIMALS = {APPROVAL_LIMIT: 2, SPEND_LIMIT: 2, ACCURACY_OBJECTIVE: 4, STRAIGHT_THROUGH_OBJECTIVE: 4}
RECENT_CHANGES = 10

staff_settings_router = APIRouter(prefix="/api/staff/settings")
engineer_settings_router = APIRouter(prefix="/api/engineering/settings")


def within(key: str, *, whole: bool = False) -> Any:
    """A request field, optional, held to its setting's range; a whole number takes no float."""
    low, high = RANGES[key]
    if whole:
        return Field(default=None, ge=low, le=high, strict=True)
    return Field(default=None, ge=low, le=high, allow_inf_nan=False)


class SettingValues(BaseModel):
    approval_limit: float = Field(description="US dollars; a payout over it needs a sign-off")
    round_spend_limit: float = Field(description="US dollars an improvement round may spend")
    accuracy_objective: float = Field(description="The held-out accuracy the agent must meet")
    straight_through_objective: float = Field(description="The share decided without a referral")
    agents_at_once: int = Field(description="The number the dispatch and run forms start with")


class SettingsRequest(Strict):
    """The values to change; one left out stays as it is."""

    approval_limit: float | None = within(APPROVAL_LIMIT)
    round_spend_limit: float | None = within(SPEND_LIMIT)
    accuracy_objective: float | None = within(ACCURACY_OBJECTIVE)
    straight_through_objective: float | None = within(STRAIGHT_THROUGH_OBJECTIVE)
    agents_at_once: int | None = within(AGENTS_AT_ONCE, whole=True)
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


class Range(BaseModel):
    min: float
    max: float


class SettingChange(BaseModel):
    key: str
    old: float | None
    new: float
    changed_by: str
    changed_at: str
    reason: str | None


class SettingsView(BaseModel):
    values: SettingValues
    ranges: dict[str, Range]
    changes: list[SettingChange]


def stored(db: Connection, key: str) -> float:
    """A setting kept only here: its stored value, or its default when never changed."""
    value = db.execute(select(settings.c.value).where(settings.c.key == key)).scalar_one_or_none()
    return float(value) if value is not None else DEFAULTS[key]


def accuracy_objective(db: Connection) -> float:
    return stored(db, ACCURACY_OBJECTIVE)


def straight_through_objective(db: Connection) -> float:
    return stored(db, STRAIGHT_THROUGH_OBJECTIVE)


def setting_values(db: Connection) -> SettingValues:
    """The values in force, each read the way the code that enforces it reads it."""
    return SettingValues(
        approval_limit=approval_limit(db),
        round_spend_limit=spend_limit(db),
        accuracy_objective=accuracy_objective(db),
        straight_through_objective=straight_through_objective(db),
        agents_at_once=int(stored(db, AGENTS_AT_ONCE)),
    )


def recent_changes(db: Connection) -> list[SettingChange]:
    """The latest changes to these settings, newest first; never the payouts switch's."""
    rows = db.execute(
        select(setting_changes)
        .where(setting_changes.c.key.in_(RANGES))
        .order_by(setting_changes.c.change_id.desc())
        .limit(RECENT_CHANGES)
    ).mappings()
    return [
        SettingChange(
            key=row["key"],
            old=row["old_value"],
            new=row["value"],
            changed_by=row["changed_by"],
            changed_at=row["changed_at"],
            reason=row["reason"],
        )
        for row in rows
    ]


def settings_view(db: Connection) -> SettingsView:
    return SettingsView(
        values=setting_values(db),
        ranges={key: Range(min=low, max=high) for key, (low, high) in RANGES.items()},
        changes=recent_changes(db),
    )


def change_settings(db: Connection, request: SettingsRequest, handler: Handler) -> list[str]:
    """Put the request's new values in place, one audit row per value that changed. Says which
    keys changed."""
    wanted = request.model_dump(exclude={"reason"}, exclude_none=True)
    # Hold the rows being changed, so two saves at once can't each record a stale value before.
    db.execute(select(settings.c.key).where(settings.c.key.in_(wanted)).with_for_update()).all()
    current = setting_values(db).model_dump()
    stamp = now()
    changed: list[str] = []
    for key, value in wanted.items():
        new = round(value, DECIMALS[key]) if key in DECIMALS else value
        if new == current[key]:
            continue
        values = {"value": new, "changed_by": handler.name, "changed_at": stamp}
        if not db.execute(update(settings).where(settings.c.key == key).values(**values)).rowcount:
            db.execute(insert(settings).values(key=key, **values))
        db.execute(
            insert(setting_changes).values(
                key=key,
                value=new,
                old_value=current[key],
                reason=request.reason or None,
                changed_by=handler.name,
                changed_by_id=handler.handler_id,
                changed_at=stamp,
            )
        )
        changed.append(key)
    return changed


@staff_settings_router.get("", operation_id="get_settings")
def get_settings_for_staff(_: SignedIn, db: Database) -> SettingsView:
    """The settings in force, their ranges and the latest changes."""
    return settings_view(db)


@staff_settings_router.put("", operation_id="change_settings")
def put_settings(request: SettingsRequest, handler: SeniorHandler, db: Database) -> SettingsView:
    """Change settings as the senior handler signed in. A new approval limit applies to
    decisions made from now on: nothing held is released and nothing paid is touched."""
    changed = change_settings(db, request, handler)
    if changed:
        log.warning("settings %s changed by handler %s", ", ".join(changed), handler.handler_id)
    return settings_view(db)


@engineer_settings_router.get("", operation_id="get_settings_for_engineers")
def get_settings_for_engineers(_: SignedInEngineer, db: Database) -> SettingsView:
    """The settings in force, read-only, for the AI engineers' console."""
    return settings_view(db)
