"""The payouts kill switch: a senior handler can stop every payment while the app keeps working.
The agent still decides, and each approval holds until payouts are back on. When the switch
can't be read, payouts count as paused."""

from fastapi import HTTPException
from sqlalchemy import Connection, insert, select, update

from undercover_api.db import now, setting_changes, settings
from undercover_api.models import Handler, PayoutSwitch

PAYOUTS_PAUSED = "payouts_paused"
PAUSED_REASON = "Payouts are paused by a senior handler"


def payout_switch(db: Connection, lock: bool = False) -> PayoutSwitch:
    """Whether payouts are paused, who last changed it, when and why. Missing or malformed
    reads as paused, so a fault never lets money out. A payment reads it locked, so a pause
    landing at the same moment either waits for the payment or refuses it, never misses it."""
    query = select(settings).where(settings.c.key == PAYOUTS_PAUSED)
    row = db.execute(query.with_for_update() if lock else query).mappings().first()
    if row is None or not isinstance(row["value"], dict):
        return PayoutSwitch(paused=True, changed_by=None, changed_at=None, reason=None)
    value = row["value"]
    paused = value.get("paused")
    return PayoutSwitch(
        paused=paused is not False,
        changed_by=row["changed_by"],
        changed_at=row["changed_at"],
        reason=value.get("reason") if isinstance(value.get("reason"), str) else None,
    )


def payouts_paused(db: Connection) -> bool:
    return payout_switch(db).paused


def refuse_while_paused(db: Connection) -> None:
    """Refuse any payment while payouts are paused. Called before anything else is read."""
    if payout_switch(db, lock=True).paused:
        raise HTTPException(423, f"{PAUSED_REASON}; nothing can be paid until they're back on")


def set_payouts(db: Connection, paused: bool, reason: str, handler: Handler) -> PayoutSwitch:
    """Turn payouts off or on, keeping every change in the audit history."""
    stamp = now()
    value = {"paused": paused, "reason": reason}
    changed = db.execute(
        update(settings)
        .where(settings.c.key == PAYOUTS_PAUSED)
        .values(value=value, changed_by=handler.name, changed_at=stamp)
    ).rowcount
    if not changed:
        db.execute(
            insert(settings).values(
                key=PAYOUTS_PAUSED, value=value, changed_by=handler.name, changed_at=stamp
            )
        )
    db.execute(
        insert(setting_changes).values(
            key=PAYOUTS_PAUSED,
            value=value,
            changed_by=handler.name,
            changed_by_id=handler.handler_id,
            changed_at=stamp,
        )
    )
    return payout_switch(db)
