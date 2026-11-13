"""The guardian: watches what the claim agent does as it works, and stops an approval that
doesn't add up before any money moves.

Gartner calls this a guardian agent: it observes the agent's actions at the point they take
effect and enforces policy there, apart from the agent itself. Ours is code, not a model, so a
claim's text can't talk it round. When an approval breaks a rule, it isn't paid: it waits for a
senior handler's sign-off with the guardian's reason, and the claim's trace says so.

The rules, each a sign the agent was misled or went wrong:
- it approved although one of its own checks failed;
- it approved a claim the hidden-instruction check flagged;
- it pays more than the customer claimed;
- it made far more model calls than any claim needs (a loop, or a tool being abused)."""

from sqlalchemy import Connection, func, insert, select, update

from undercover_api.db import claims, decisions, model_calls, now, steps
from undercover_api.kill_switch import PAUSED_REASON, payouts_paused
from undercover_api.models import DecisionKind, DecisionRequest

GUARDIAN_STEP = "guardian"
# A claim takes a dozen or so model calls; past this the agent is going round in circles.
MOST_MODEL_CALLS = 40
FLAGGED_PREFIX = "Instructions found"


def concern_of(db: Connection, claim_id: str, request: DecisionRequest) -> str | None:
    """Why the guardian would stop this decision, or None when it adds up."""
    if request.decision != DecisionKind.APPROVE:
        return None
    failed = [check.label for check in request.checklist if check.result == "fail"]
    if failed:
        return f"approved although its own check failed: {failed[0]}"
    flagged = db.execute(
        select(steps.c.step_id).where(
            steps.c.claim_id == claim_id,
            steps.c.kind == "screening",
            steps.c.content.like(f"{FLAGGED_PREFIX}%"),
        )
    ).first()
    if flagged is not None:
        return "approved a claim the hidden-instruction check flagged"
    claimed = db.execute(
        select(claims.c.amount_claimed).where(claims.c.claim_id == claim_id)
    ).scalar_one_or_none()
    if claimed is not None and request.payout > float(claimed) + 0.01:  # noqa: PLR2004
        return f"pays ${request.payout:,.2f}, more than the ${float(claimed):,.2f} claimed"
    calls = int(
        db.execute(
            select(func.count(model_calls.c.call_id)).where(model_calls.c.claim_id == claim_id)
        ).scalar_one()
    )
    if calls > MOST_MODEL_CALLS:
        return f"made {calls} model calls on one claim, far more than any needs"
    return None


def held_by(db: Connection, claim_id: str, request: DecisionRequest) -> str | None:
    """Why an approval under the limit is held for a sign-off: the guardian's concern, which it
    notes on the claim's trace, or paused payouts; None when it can be paid."""
    return noted_concern(db, claim_id, request) or (PAUSED_REASON if payouts_paused(db) else None)


def noted_concern(db: Connection, claim_id: str, request: DecisionRequest) -> str | None:
    """The guardian's concern about an approval, noted on the claim's trace, or None. Asked for
    an approval over the limit too, so the senior handler signing it off sees the concern."""
    concern = concern_of(db, claim_id, request)
    if concern is not None:
        db.execute(
            insert(steps).values(
                claim_id=claim_id,
                kind=GUARDIAN_STEP,
                content=f"Held. The guardian stopped the payment: the agent {concern}.",
                sources=[],
                created_at=now(),
            )
        )
        return f"The guardian held it: the agent {concern}"
    return None


def hold(db: Connection, claim_id: str, reason: str) -> None:
    db.execute(update(decisions).where(decisions.c.claim_id == claim_id).values(hold_reason=reason))
