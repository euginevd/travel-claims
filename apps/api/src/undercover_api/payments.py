"""Paying claims. The limit is checked before the claim is even read, any doubt refuses, and
the payments table's key means a claim is paid once at most."""

from fastapi import HTTPException
from sqlalchemy import Connection, insert, select, update
from sqlalchemy.exc import IntegrityError

from undercover_api.claims import (
    approval_limit,
    find_claim,
    find_decision,
    find_payment,
    move_claim,
)
from undercover_api.db import customers, decisions, now, payments
from undercover_api.kill_switch import refuse_while_paused
from undercover_api.models import DecisionKind, Status
from undercover_api.notices import announce
from undercover_api.payout import dollars, needs_sign_off

LIMIT_LOWERED_REASON = "The approval limit was lowered after this claim was approved"


def mask_payid(payid: str) -> str:
    """A PayID with most of it hidden: o***@example.com, 04** *** 678 or ABN ********901."""
    if "@" in payid:
        name, domain = payid.split("@", 1)
        return f"{name[:1]}***@{domain}"
    digits = payid.replace(" ", "")
    if digits.startswith(("04", "+614")):
        return f"04** *** {digits[-3:]}"
    return f"ABN ********{digits[-3:]}"


def over_the_limit(limit: float) -> HTTPException:
    return HTTPException(
        403, f"A payout over the approval limit of {dollars(limit)} needs a handler's sign-off"
    )


def record_payment(
    db: Connection,
    claim_id: str,
    amount: float,
    signed_off_by: str | None = None,
    signed_off_by_id: str | None = None,
) -> None:
    """Record a claim's one payment, with the handler who signed it off, if one did. A second,
    however it races in, is refused. Nothing is paid while payouts are paused."""
    refuse_while_paused(db)
    claim = find_claim(db, claim_id)
    if claim["source"] == "evaluation":
        raise HTTPException(409, f"Claim {claim_id} is an evaluation's copy and is never paid")
    payid = db.execute(
        select(customers.c.payid).where(customers.c.customer_id == claim["customer_id"])
    ).scalar_one_or_none()
    try:
        with db.begin_nested():
            db.execute(
                insert(payments).values(
                    claim_id=claim_id,
                    amount=amount,
                    paid_at=now(),
                    signed_off_by=signed_off_by,
                    signed_off_by_id=signed_off_by_id,
                    paid_to=f"PayID {mask_payid(payid)}" if payid else None,
                )
            )
    except IntegrityError as error:
        raise HTTPException(409, f"Claim {claim_id} has already been paid") from error
    announce(db, find_claim(db, claim_id))


def pay(db: Connection, claim_id: str, amount: float) -> bool:
    """Pay an approved claim its payout, the agent's way: never over the limit. Says whether it
    paid now (False when the same payment was already made, or it's held for a sign-off)."""
    refuse_while_paused(db)
    limit = approval_limit(db)
    if needs_sign_off(amount, limit):
        if hold_after_limit_lowered(db, claim_id, amount):
            return False
        raise over_the_limit(limit)
    claim = find_claim(db, claim_id)
    if claim["source"] == "evaluation":
        raise HTTPException(409, f"Claim {claim_id} is an evaluation's copy and is never paid")
    decision = find_decision(db, claim_id)
    if decision is None or decision.decision != DecisionKind.APPROVE:
        raise HTTPException(409, f"Claim {claim_id} has no approval to pay")
    paid = find_payment(db, claim_id)
    if paid is not None:
        if paid.amount == amount:
            return False
        raise HTTPException(409, f"Claim {claim_id} has already been paid")
    if claim["status"] == Status.WAITING_FOR_SIGN_OFF or needs_sign_off(
        amount, decision.approval_limit
    ):
        raise over_the_limit(decision.approval_limit)
    if claim["status"] != Status.IN_PROGRESS:
        raise HTTPException(409, f"Claim {claim_id} isn't in progress")
    if amount != decision.payout:
        raise HTTPException(
            422, f"The amount must be the approved payout of {dollars(decision.payout)}"
        )
    record_payment(db, claim_id, amount)
    return True


def hold_after_limit_lowered(db: Connection, claim_id: str, amount: float) -> bool:
    """An approval made under a higher limit that a senior handler has since lowered waits for
    a sign-off, instead of staying in progress, unpaid, where no handler sees it."""
    decision = find_decision(db, claim_id)
    if (
        decision is None
        or decision.decision != DecisionKind.APPROVE
        or decision.payout != amount
        or needs_sign_off(amount, decision.approval_limit)
    ):
        return False
    if not move_claim(db, claim_id, Status.IN_PROGRESS, Status.WAITING_FOR_SIGN_OFF):
        return False
    db.execute(
        update(decisions)
        .where(decisions.c.claim_id == claim_id)
        .values(hold_reason=LIMIT_LOWERED_REASON)
    )
    return True
