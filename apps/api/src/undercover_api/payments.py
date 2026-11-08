"""Paying claims. The limit is checked before the claim is even read, any doubt refuses, and
the payments table's key means a claim is paid once at most."""

from fastapi import HTTPException
from sqlalchemy import Connection, insert
from sqlalchemy.exc import IntegrityError

from undercover_api.claims import approval_limit, find_claim, find_decision, find_payment
from undercover_api.db import now, payments
from undercover_api.kill_switch import refuse_while_paused
from undercover_api.models import DecisionKind, Status
from undercover_api.payout import dollars, needs_sign_off


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
    try:
        with db.begin_nested():
            db.execute(
                insert(payments).values(
                    claim_id=claim_id,
                    amount=amount,
                    paid_at=now(),
                    signed_off_by=signed_off_by,
                    signed_off_by_id=signed_off_by_id,
                )
            )
    except IntegrityError as error:
        raise HTTPException(409, f"Claim {claim_id} has already been paid") from error


def pay(db: Connection, claim_id: str, amount: float) -> bool:
    """Pay an approved claim its payout, the agent's way: never over the limit. Says whether it
    paid now (False when the same payment was already made)."""
    refuse_while_paused(db)
    limit = approval_limit(db)
    if needs_sign_off(amount, limit):
        raise over_the_limit(limit)
    claim = find_claim(db, claim_id)
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
