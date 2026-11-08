"""What claims manual section 14 asks of a decision record. Each refusal is a 422 naming
section 14 and what's missing."""

from fastapi import HTTPException

from undercover_api.models import Calculation, DecisionKind, DecisionRequest
from undercover_api.payout import dollars

NO_REASON = "a decision record needs a reason in plain language"
NO_SECTION = "a decision record needs the section relied on"
SCREENING_ONLY_REFERS = "the hidden-instruction check may only refer a claim"
NOTHING_APPROVED = "an approval needs a payout above zero"
SOMETHING_PAID = "a decline or a referral has a payout of zero"
NO_CALCULATION = (
    "an approval needs the calculation of its payout for this attempt. "
    "Work it out with calculate_payout"
)


def falls_short(missing: str) -> HTTPException:
    """A refusal of a decision record, naming section 14 and what's missing."""
    return HTTPException(422, f"Claims manual section 14: {missing}")


def check_request(request: DecisionRequest) -> None:
    """Refuse a decision that leaves out what section 14 asks for. Needs nothing from the
    claim, so it runs before the claim is read."""
    for text, missing in ((request.reason, NO_REASON), (request.section, NO_SECTION)):
        if not text.strip():
            raise falls_short(missing)
    if request.maker == "hidden_instruction_check" and request.decision != DecisionKind.REFER:
        raise falls_short(SCREENING_ONLY_REFERS)
    approval = request.decision == DecisionKind.APPROVE
    if approval and request.payout <= 0:
        raise falls_short(NOTHING_APPROVED)
    if not approval and request.payout != 0:
        raise falls_short(SOMETHING_PAID)


def check_calculation(payout: float, calculation: Calculation | None) -> Calculation:
    """The calculation on file for an approval's attempt, or a refusal when there is none or
    the payout isn't the calculation's."""
    if calculation is None:
        raise falls_short(NO_CALCULATION)
    if payout != calculation.payout:
        raise falls_short(f"the payout must be the calculation's {dollars(calculation.payout)}")
    return calculation
