"""The handler's risk panel on a claim: signals worth a second look, never automatic declines."""

from statistics import median

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from undercover_api.auth import Database, SignedIn
from undercover_api.claims import claim_history, find_claim
from undercover_api.db import claims
from undercover_api.models import ClaimId
from undercover_api.portal import duplicate_receipts

risk_router = APIRouter(prefix="/api/staff")
# An amount this many times the typical one for the claim type is worth a look.
HIGH_AMOUNT = 2.0


class SharedReceipt(BaseModel):
    receipt: int
    claim_id: str
    match: str


class Risk(BaseModel):
    shared_receipts: list[SharedReceipt]
    earlier_claims: int
    earlier_paid: float
    amount_claimed: float
    typical_amount: float | None
    high_amount: bool


@risk_router.get("/claims/{claim_id}/risk", operation_id="get_claim_risk")
def claim_risk(claim_id: ClaimId, _: SignedIn, db: Database) -> Risk:
    """Receipts seen on other claims, the customer's earlier claims, and the amount against the
    typical one for the claim type. Signals for the handler, not decisions."""
    row = find_claim(db, claim_id)
    shared = [
        SharedReceipt(receipt=found.receipt, claim_id=match.claim_id, match=match.match)
        for found in duplicate_receipts(claim_id, db)
        for match in found.matches
    ]
    history = claim_history(db, claim_id)
    others = db.execute(
        select(claims.c.amount_claimed).where(
            claims.c.claim_type == row["claim_type"],
            claims.c.claim_id != claim_id,
            claims.c.source != "evaluation",
        )
    ).scalars()
    amounts = [float(a) for a in others]
    typical = round(median(amounts), 2) if amounts else None
    return Risk(
        shared_receipts=shared,
        earlier_claims=len(history),
        earlier_paid=round(sum(c.amount_paid for c in history), 2),
        amount_claimed=float(row["amount_claimed"]),
        typical_amount=typical,
        high_amount=typical is not None and row["amount_claimed"] > typical * HIGH_AMOUNT,
    )
