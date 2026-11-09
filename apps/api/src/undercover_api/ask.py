"""Ask UnderCover: the customers' assistant. The api gives it only the signed-in customer's own
policies and claims, with customer-facing reasons only, and checks what comes back."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import select

from undercover_api.account import my_cover
from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SignedInCustomer
from undercover_api.db import claims
from undercover_api.models import QuestionAnswer, QuestionRequest
from undercover_api.notices import first_name
from undercover_api.portal import DraftLimiter, claim_for_customer

log = logging.getLogger(__name__)

ask_router = APIRouter(prefix="/api/customer")
QUESTIONS_PER_HOUR = 20


def asking(request: Request) -> tuple[AgentService, DraftLimiter]:
    state = request.app.state
    if not hasattr(state, "ask_limiter"):
        state.ask_limiter = DraftLimiter(QUESTIONS_PER_HOUR)
    return state.agent, state.ask_limiter


Asking = Annotated[tuple[AgentService, DraftLimiter], Depends(asking)]


@ask_router.post("/ask", operation_id="ask_undercover")
def ask_undercover(
    body: QuestionRequest, customer: SignedInCustomer, db: Database, tools: Asking
) -> QuestionAnswer:
    """Answer a question about the customer's own policy and claims. It explains and cites the
    policy wording but never promises cover or payment."""
    service, limiter = tools
    if not limiter.allow(customer.customer_id, datetime.now(UTC).timestamp()):
        raise HTTPException(429, "That's a lot of questions in an hour. Please try again later.")
    rows = db.execute(
        select(claims)
        .where(claims.c.customer_id == customer.customer_id, claims.c.source != "evaluation")
        .order_by(claims.c.submitted_on.desc())
        .limit(20)
    ).mappings()
    mine: list[dict[str, object]] = []
    for row in rows:
        claim = claim_for_customer(db, row)
        mine.append(
            {
                "claim_id": claim.claim_id,
                "summary": claim.summary,
                "claim_type": claim.claim_type,
                "status": claim.status_text,
                "amount_claimed": claim.amount_claimed,
                "reason": claim.reason or "",
                "paid": claim.paid,
                "waiting_on_you": [r.text for r in claim.requests if r.fulfilled_at is None],
            }
        )
    request: dict[str, object] = {
        "first_name": first_name(db, customer.customer_id),
        "question": body.question,
        "history": [turn.model_dump() for turn in body.history],
        "policies": [cover.model_dump() for cover in my_cover(customer, db)],
        "claims": mine,
    }
    try:
        answer = service.ask(request)
    except AgentUnavailableError as error:
        log.warning("a question couldn't be answered: %s", error)
        raise HTTPException(503, "The assistant isn't available right now") from error
    try:
        found = QuestionAnswer.model_validate(answer)
    except ValidationError as error:
        raise HTTPException(502, "The assistant's answer didn't make sense") from error
    log.info(
        "customer question answered (%d characters, screened=%s)",
        len(body.question),
        found.screened,
    )
    return found
