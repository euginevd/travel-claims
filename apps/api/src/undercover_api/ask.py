"""Ask UnderCover: the customers' assistant. The api gives it only the signed-in customer's own
policies and claims, with customer-facing reasons only, and checks what comes back."""

import logging
import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import insert, select

from undercover_api.account import my_cover
from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SignedInCustomer, SignedInEngineer
from undercover_api.claims import claim_trace
from undercover_api.db import assistant_calls, claims, now
from undercover_api.models import QuestionAnswer, QuestionRequest
from undercover_api.notices import first_name
from undercover_api.portal import DraftLimiter, claim_for_customer

log = logging.getLogger(__name__)

ask_router = APIRouter(prefix="/api/customer")
engineer_ask_router = APIRouter(prefix="/api/engineering")
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
        # Only a claim of the customer's own: anything else is ignored, never looked up.
        "about": body.about if any(c["claim_id"] == body.about for c in mine) else "",
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
    db.execute(
        insert(assistant_calls).values(agent="wattle", model_calls=1, cost=0, created_at=now())
    )
    # A claim the model names is shown only if it's the customer's own.
    if found.claim_id and not any(c["claim_id"] == found.claim_id for c in mine):
        found = found.model_copy(update={"claim_id": "", "action": "show_claims"})
    log.info(
        "customer question answered (%d characters, screened=%s)",
        len(body.question),
        found.screened,
    )
    return found


MAX_TRACES = 3
CLAIM_ID = re.compile(r"\bCLM-\d{4,6}\b", re.IGNORECASE)


@engineer_ask_router.post("/ask", operation_id="ask_wattle_engineering")
def ask_engineering(
    body: QuestionRequest, engineer: SignedInEngineer, db: Database, tools: Asking
) -> QuestionAnswer:
    """Wattle AI for the AI engineers: read-only answers from the runs, rounds, red team, threat
    coverage, the live numbers and the traces of any claims named in the question."""
    # Imported here: these modules import the routers this module sits beside.
    from undercover_api.evaluations import list_runs  # noqa: PLC0415
    from undercover_api.improvement import list_rounds  # noqa: PLC0415
    from undercover_api.live import live_summary  # noqa: PLC0415
    from undercover_api.redteam import status_of  # noqa: PLC0415
    from undercover_api.threats import threat_coverage  # noqa: PLC0415

    service, limiter = tools
    if not limiter.allow(f"eng:{engineer.engineer_id}", datetime.now(UTC).timestamp()):
        raise HTTPException(429, "That's a lot of questions in an hour. Please try again later.")
    said = " ".join([body.question, *(turn.text for turn in body.history)])
    traces: dict[str, object] = {}
    for found in dict.fromkeys(m.upper() for m in CLAIM_ID.findall(said)):
        if len(traces) == MAX_TRACES:
            break
        try:
            traces[found] = claim_trace(db, found).model_dump(mode="json")
        except HTTPException:
            continue
    request: dict[str, object] = {
        "first_name": engineer.name.split()[0],
        "question": body.question,
        "history": [turn.model_dump() for turn in body.history],
        "runs": [r.model_dump(mode="json") for r in list_runs(engineer, db)[:10]],
        "rounds": [r.model_dump(mode="json") for r in list_rounds(engineer, db)[:8]],
        "redteam": status_of(db).model_dump(mode="json"),
        "threats": threat_coverage(engineer, db).model_dump(mode="json"),
        "traces": traces,
        "live": live_summary(db),
    }
    try:
        answer = service.explain(request)
    except AgentUnavailableError as error:
        log.warning("an engineer's question couldn't be answered: %s", error)
        raise HTTPException(503, "The assistant isn't available right now") from error
    try:
        found_answer = QuestionAnswer.model_validate(answer)
    except ValidationError as error:
        raise HTTPException(502, "The assistant's answer didn't make sense") from error
    log.info("engineer question answered (%d characters)", len(body.question))
    return found_answer
