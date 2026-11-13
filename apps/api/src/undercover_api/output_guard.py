"""The output guard: personal data the agent writes is removed before anyone reads it.

The agent's reason reaches handlers, and its requests reach the customer. A model can copy a
card number, an email address, a phone number or a tax file number out of a receipt into them.
This checks each text in code (never by a model) and replaces what it finds, so the record
never holds it; the claim's trace notes what was removed."""

from sqlalchemy import Connection, insert

from undercover_api.db import now, steps
from undercover_api.live import FLAGGED
from undercover_api.models import Check, DecisionRequest
from undercover_api.pii import scrub
from undercover_api.posture import OUTPUT_CHECK


def guarded(request: DecisionRequest) -> tuple[DecisionRequest, list[str]]:
    """The decision with its reason and its requests to the customer scrubbed."""
    reason, removed = scrub(request.reason)
    asks: list[str] = []
    for ask in request.customer_requests:
        clean, found = scrub(ask)
        # A replacement can be longer than what it replaced: held to the column's length.
        asks.append(clean[:REQUEST_LENGTH])
        removed.extend(kind for kind in found if kind not in removed)
    checks: list[Check] = []
    for check in request.checklist:
        # A check's detail is shown to handlers on the queue, so it's scrubbed too.
        clean, found = scrub(check.detail)
        checks.append(check.model_copy(update={"detail": clean[:DETAIL_LENGTH]}))
        removed.extend(kind for kind in found if kind not in removed)
    update = {"reason": reason[:REASON_LENGTH], "customer_requests": asks, "checklist": checks}
    return request.model_copy(update=update), removed


REQUEST_LENGTH = 300
DETAIL_LENGTH = 500
REASON_LENGTH = 4000


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
