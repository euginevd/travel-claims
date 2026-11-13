"""Decision letters: the assistant drafts the customer's letter about an approval or a decline,
and the handler edits and sends it. It reaches the customer's claim and their Updates."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError
from sqlalchemy import Connection, delete, insert

from undercover_api.agent_service import AgentUnavailableError
from undercover_api.auth import Database, SignedIn
from undercover_api.claims import claim_in_full, find_claim, find_decision, find_payment
from undercover_api.db import letters, now
from undercover_api.models import (
    Claim,
    ClaimId,
    DecisionKind,
    LetterDraft,
    SendLetter,
    Status,
)
from undercover_api.notices import EMAIL, first_name, send
from undercover_api.portal import Drafting

log = logging.getLogger(__name__)

letters_router = APIRouter(prefix="/api/staff")
SUBJECT_LIMIT = 200
BODY_LIMIT = 4000


def decided(db: Connection, claim_id: str) -> tuple[DecisionKind, float]:
    """A claim's approval or decline, or a 409: referrals and open claims get no letter."""
    claim = find_claim(db, claim_id)
    decision = find_decision(db, claim_id)
    if (
        claim["status"] != Status.DECIDED
        or claim["source"] == "evaluation"
        or decision is None
        or decision.decision == DecisionKind.REFER
    ):
        raise HTTPException(409, "A letter is for an approved or declined claim")
    return decision.decision, decision.payout


@letters_router.post("/claims/{claim_id}/letter/draft", operation_id="draft_letter")
def draft_letter(claim_id: ClaimId, _: SignedIn, db: Database, tools: Drafting) -> LetterDraft:
    """The assistant's draft of the customer's letter about the decision, never sent by itself."""
    kind, payout = decided(db, claim_id)
    claim = find_claim(db, claim_id)
    decision = find_decision(db, claim_id)
    payment = find_payment(db, claim_id)
    service, _limiter = tools
    request: dict[str, object] = {
        "first_name": first_name(db, claim["customer_id"]),
        "claim_id": claim_id,
        "summary": claim["summary"][:200],
        "decision": str(kind),
        "payout": payment.amount if payment else payout,
        "paid_to": (payment.paid_to or "") if payment else "",
        "section": (decision.section if decision else "")[:500],
        "reason": (decision.reason if decision else "")[:4000],
    }
    try:
        answer = service.letter(request)
    except AgentUnavailableError as error:
        log.warning("claim %s: the letter couldn't be drafted: %s", claim_id, error)
        raise HTTPException(
            503, "The assistant isn't available; write the letter yourself"
        ) from error
    try:
        found = LetterDraft.model_validate(answer)
    except ValidationError as error:
        raise HTTPException(
            502, "The assistant's letter didn't make sense; write it yourself"
        ) from error
    return LetterDraft(
        subject=found.subject[:SUBJECT_LIMIT], body=found.body[:BODY_LIMIT], note=found.note[:500]
    )


@letters_router.put("/claims/{claim_id}/letter", operation_id="send_letter")
def send_letter(claim_id: ClaimId, body: SendLetter, handler: SignedIn, db: Database) -> Claim:
    """Send the customer the letter as the handler signed in: it goes on their claim and to their
    Updates by email. Sending again replaces it."""
    decided(db, claim_id)
    claim = find_claim(db, claim_id)
    db.execute(delete(letters).where(letters.c.claim_id == claim_id))
    db.execute(
        insert(letters).values(
            claim_id=claim_id,
            subject=body.subject,
            body=body.body,
            drafted_by_ai=body.drafted_by_ai,
            sent_by=handler.name,
            sent_at=now(),
        )
    )
    send(db, claim["customer_id"], claim_id, EMAIL, body.subject, body.body)
    log.info("claim %s: decision letter sent", claim_id)
    return claim_in_full(db, claim_id)
