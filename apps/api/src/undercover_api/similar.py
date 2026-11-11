"""Similar past claims for the handler's claim page: decided live claims of the same type,
closest in amount first. Worked out in code, with no model; a guide, never a decision."""

from statistics import median

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from undercover_api.auth import Database, SignedIn
from undercover_api.claims import find_claim
from undercover_api.db import claims, decisions, policies
from undercover_api.evaluations import EVALUATION
from undercover_api.models import ClaimId, DecisionKind, Status
from undercover_api.redteam import REDTEAM_CUSTOMER

similar_router = APIRouter(prefix="/api/staff")
MOST = 5
REASON_LENGTH = 160
NONE_YET = "No similar decided claims yet"


class SimilarClaim(BaseModel):
    claim_id: str
    decided_at: str
    amount_claimed: float
    outcome: DecisionKind
    payout: float
    section: str
    reason: str = Field(description="The decision's reason, or the override's note, in a line")
    overridden: bool = Field(description="Whether a person put their decision in the agent's place")
    same_plan: bool
    same_destination: bool


class SimilarClaims(BaseModel):
    claim_id: str
    claim_type: str
    summary: str
    similar: list[SimilarClaim]


def one_line(reason: str) -> str:
    """A reason's first line, cut short."""
    line = " ".join(reason.split())
    return line if len(line) <= REASON_LENGTH else line[: REASON_LENGTH - 1].rstrip() + "…"


def summarise(found: list[SimilarClaim]) -> str:
    if not found:
        return NONE_YET
    approved = [c.payout for c in found if c.outcome == DecisionKind.APPROVE]
    claims_were = "claim was" if len(found) == 1 else "claims were"
    line = f"{len(approved)} of {len(found)} similar {claims_were} approved"
    if approved:
        line += f"; typical payout ${median(approved):,.0f}"
    return line


@similar_router.get("/claims/{claim_id}/similar", operation_id="get_similar_claims")
def similar_claims(claim_id: ClaimId, _: SignedIn, db: Database) -> SimilarClaims:
    """Up to five approved or declined live claims of the same type, the closest amount claimed
    first, then the same plan, the same destination and the newest decision. Never an
    evaluation's copy, a red-team claim or the claim itself."""
    row = find_claim(db, claim_id)
    mine = db.execute(
        select(policies.c.record).where(policies.c.policy_id == row["policy_id"])
    ).scalar_one()
    rows = db.execute(
        select(
            claims.c.claim_id,
            claims.c.amount_claimed,
            policies.c.record.label("policy"),
            decisions.c.decision,
            decisions.c.payout,
            decisions.c.section,
            decisions.c.reason,
            decisions.c.decided_at,
            decisions.c.override,
        )
        .join(decisions, decisions.c.claim_id == claims.c.claim_id)
        .join(policies, policies.c.policy_id == claims.c.policy_id)
        .where(
            claims.c.claim_type == row["claim_type"],
            claims.c.claim_id != claim_id,
            claims.c.source != EVALUATION,
            claims.c.customer_id != REDTEAM_CUSTOMER,
            claims.c.status == Status.DECIDED,
            decisions.c.decision.in_([DecisionKind.APPROVE, DecisionKind.DECLINE]),
        )
    ).mappings()
    found = [
        SimilarClaim(
            claim_id=r["claim_id"],
            decided_at=r["decided_at"],
            amount_claimed=r["amount_claimed"],
            outcome=r["decision"],
            payout=r["payout"],
            section=r["section"],
            # An overridden decision's reason is the handler's note, not the agent's.
            reason=one_line(r["override"]["note"] if r["override"] else r["reason"]),
            overridden=r["override"] is not None,
            same_plan=r["policy"]["plan"] == mine["plan"],
            same_destination=r["policy"]["trip"]["destination"] == mine["trip"]["destination"],
        )
        for r in rows
    ]
    amount = float(row["amount_claimed"])
    # Newest first, then a stable sort on closeness, so the newest wins a tie.
    found.sort(key=lambda c: c.decided_at, reverse=True)
    found.sort(
        key=lambda c: (abs(c.amount_claimed - amount), not c.same_plan, not c.same_destination)
    )
    closest = found[:MOST]
    return SimilarClaims(
        claim_id=claim_id,
        claim_type=row["claim_type"],
        summary=summarise(closest),
        similar=closest,
    )
