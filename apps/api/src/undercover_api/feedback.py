"""Customers' feedback: a thumbs up or down on one of Wattle's answers or on a decision's
explanation. The customer is the one signed in, never one named in the body. The comment and
question are the customer's own words: kept and shown as plain text, never sent to a model."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, RowMapping, insert, select, update

from undercover_api.auth import Database, SignedInCustomer
from undercover_api.db import feedback, now
from undercover_api.evaluations import new_id
from undercover_api.models import ClaimId, Status, Strict
from undercover_api.portal import DraftLimiter, own_claim

feedback_router = APIRouter(prefix="/api/customer")
FEEDBACK_PER_HOUR = 30
ANSWER = "answer"
DECISION = "decision"
Words = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class FeedbackRequest(Strict):
    subject: Literal["answer", "decision"]
    claim_id: Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")] | None = None
    helpful: bool
    comment: Words = Field(default="", description="Why it didn't help; kept only with a no")
    question: Words = Field(default="", description="The question the answer was to")
    feedback_id: int | None = Field(
        default=None, ge=1, le=2**31 - 1, description="An answer's earlier vote, to change it"
    )


class Feedback(BaseModel):
    feedback_id: int
    subject: str
    claim_id: str | None
    helpful: bool
    comment: str | None


def limiter(request: Request) -> DraftLimiter:
    state = request.app.state
    if not hasattr(state, "feedback_limiter"):
        state.feedback_limiter = DraftLimiter(FEEDBACK_PER_HOUR)
    return state.feedback_limiter


Limiter = Annotated[DraftLimiter, Depends(limiter)]


def earlier_vote(db: Connection, customer_id: str, body: FeedbackRequest) -> RowMapping | None:
    """The customer's own vote this one replaces: the one on the same decision, or the answer's
    vote they named. Never anyone else's."""
    mine = select(feedback).where(
        feedback.c.customer_id == customer_id, feedback.c.subject == body.subject
    )
    if body.subject == DECISION:
        mine = mine.where(feedback.c.claim_id == body.claim_id)
    elif body.feedback_id is not None:
        mine = mine.where(feedback.c.feedback_id == body.feedback_id)
    else:
        return None
    return db.execute(mine.order_by(feedback.c.feedback_id)).mappings().first()


@feedback_router.post("/feedback", operation_id="give_feedback")
def give_feedback(
    body: FeedbackRequest, customer: SignedInCustomer, db: Database, limit: Limiter
) -> Feedback:
    """Keep the signed-in customer's vote on an answer or on their own decided claim's
    explanation. Voting again on the same one changes the vote."""
    if not limit.allow(customer.customer_id, datetime.now(UTC).timestamp()):
        raise HTTPException(429, "That's a lot of feedback in an hour. Please try again later.")
    if body.subject == DECISION and body.claim_id is None:
        raise HTTPException(422, "Feedback on a decision needs its claim")
    if body.claim_id is not None:
        claim = own_claim(db, customer, body.claim_id)
        if body.subject == DECISION and claim["status"] != Status.DECIDED:
            raise HTTPException(409, "You can rate the explanation once your claim has a decision")
    values = {
        "claim_id": body.claim_id,
        "helpful": body.helpful,
        "comment": None if body.helpful else body.comment or None,
        "question": body.question or None,
    }
    earlier = earlier_vote(db, customer.customer_id, body)
    if earlier is None:
        if body.feedback_id is not None:
            raise HTTPException(404, "Feedback not found")
        feedback_id = new_id(
            db.execute(
                insert(feedback).values(
                    customer_id=customer.customer_id,
                    subject=body.subject,
                    created_at=now(),
                    **values,
                )
            )
        )
    else:
        feedback_id = int(earlier["feedback_id"])
        if body.subject == ANSWER:
            # An answer's vote keeps the question and claim it was first given with.
            values = {k: values[k] for k in ("helpful", "comment")}
        db.execute(update(feedback).where(feedback.c.feedback_id == feedback_id).values(**values))
    row = db.execute(select(feedback).where(feedback.c.feedback_id == feedback_id)).mappings().one()
    return Feedback.model_validate(dict(row))


@feedback_router.get("/claims/{claim_id}/feedback", operation_id="get_my_decision_feedback")
def my_decision_feedback(
    claim_id: ClaimId, customer: SignedInCustomer, db: Database
) -> Feedback | None:
    """The signed-in customer's vote on their own claim's explanation, if they gave one."""
    own_claim(db, customer, claim_id)
    row = (
        db.execute(
            select(feedback)
            .where(
                feedback.c.customer_id == customer.customer_id,
                feedback.c.subject == DECISION,
                feedback.c.claim_id == claim_id,
            )
            .order_by(feedback.c.feedback_id)
        )
        .mappings()
        .first()
    )
    return None if row is None else Feedback.model_validate(dict(row))
