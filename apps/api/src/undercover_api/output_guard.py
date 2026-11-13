"""The output guard: personal data the agent writes is removed before anyone reads it.

The agent's reason reaches handlers, and its requests reach the customer. A model can copy a
card number, an email address, a phone number or a tax file number out of a receipt into them.
This checks each text in code (never by a model) and replaces what it finds, so the record
never holds it; the claim's trace notes what was removed."""

from sqlalchemy import Connection, insert

from undercover_api.db import now, steps
from undercover_api.live import FLAGGED
from undercover_api.models import DecisionRequest
from undercover_api.pii import scrub
from undercover_api.posture import OUTPUT_CHECK


def guarded(request: DecisionRequest) -> tuple[DecisionRequest, list[str]]:
    """The decision with its reason and its requests to the customer scrubbed."""
    reason, removed = scrub(request.reason)
    asks: list[str] = []
    for ask in request.customer_requests:
        clean, found = scrub(ask)
        asks.append(clean)
        removed.extend(kind for kind in found if kind not in removed)
    return request.model_copy(update={"reason": reason, "customer_requests": asks}), removed


def note_removed(db: Connection, claim_id: str, removed: list[str]) -> None:
    """A step on the claim's trace saying what the guard removed; nothing when it found none."""
    if not removed:
        return
    db.execute(
        insert(steps).values(
            claim_id=claim_id,
            kind=OUTPUT_CHECK,
            content=f"{FLAGGED}. The output guard removed a {' and a '.join(removed)} from what "
            "the agent wrote, before anyone read it.",
            sources=[],
            created_at=now(),
        )
    )
