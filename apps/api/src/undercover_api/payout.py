"""UnderCover's payout rules for an approved claim: policy wording section 10, the plans, and
claims manual sections 6, 7 and 10. Deterministic code, so no model can talk a payout up."""

from dataclasses import dataclass
from math import ceil, inf

from undercover_api.models import Benefit, CalculationStep, Line, Payout, PayoutRequest, Plans

CASH_LIMIT = 100.0
HOTEL_NIGHT_LIMIT = 350.0
MEALS_PER_TRAVELER_PER_DAY = 35.0
ELECTRONICS_PLUS = "electronics_plus"

# The plan field holding each benefit's maximum.
BENEFIT_MAXIMUM: dict[Benefit, str] = {
    "trip_cancellation": "trip_cancellation_max",
    "trip_interruption": "trip_cancellation_max",
    "trip_delay": "trip_delay_max",
    "baggage_delay": "baggage_delay_max",
    "baggage": "baggage_max",
    "passport": "passport_max",
    "emergency_medical": "emergency_medical_max",
}
CAPPED_AT_TRIP_COST: set[Benefit] = {"trip_cancellation", "trip_interruption"}


@dataclass(frozen=True)
class PolicyTerms:
    """What the payout rules need from a policy."""

    plan: str
    add_ons: list[str]
    travelers: int
    trip_cost: float


@dataclass(frozen=True)
class Limits:
    per_item: float
    electronics_per_item: float
    travelers: int


def dollars(amount: float) -> str:
    """An amount as people write it: $1,234.50."""
    return f"${amount:,.2f}"


def needs_sign_off(payout: float, approval_limit: float) -> bool:
    """Whether a payout is over the limit, and so needs a handler's sign-off."""
    return payout > approval_limit


def step(description: str, amount: float) -> CalculationStep:
    return CalculationStep(step=description, amount=round(amount, 2))


def limit_for(line: Line, limits: Limits) -> float:
    """The most UnderCover pays for one line, or infinity when there's no line limit."""
    match line.kind:
        case "item":
            return limits.per_item * line.quantity
        case "electronics":
            return limits.electronics_per_item * line.quantity
        case "hotel":
            return HOTEL_NIGHT_LIMIT * ceil(limits.travelers / 2) * line.nights
        case "meals_without_receipts":
            return MEALS_PER_TRAVELER_PER_DAY * limits.travelers * ceil(line.hours / 24)
        case _:
            return inf


def eligible(line: Line, limits: Limits) -> CalculationStep:
    """A line at the amount claimed, or at its limit when that's lower."""
    limit = limit_for(line, limits)
    if line.amount > limit:
        return step(f"{line.description}, limited to {dollars(limit)}", limit)
    return step(line.description, line.amount)


def work_out_payout(
    policy: PolicyTerms, plans: Plans, request: PayoutRequest, approval_limit: float
) -> Payout:
    """Work out an approved claim's payout step by step, and whether it needs a sign-off."""
    plan = next(p for p in plans.plans if p.plan == policy.plan)
    electronics = plan.per_item_limit
    if ELECTRONICS_PLUS in policy.add_ons:
        add_on = next(a for a in plans.add_ons if a.add_on == ELECTRONICS_PLUS)
        electronics = add_on.electronics_per_item_limit or electronics
    limits = Limits(plan.per_item_limit, electronics, policy.travelers)

    calculation = [eligible(line, limits) for line in request.lines if line.kind != "cash"]
    cash = sum(line.amount for line in request.lines if line.kind == "cash")
    if cash:
        calculation.append(step(f"Cash, up to ${CASH_LIMIT:,.0f} in all", min(cash, CASH_LIMIT)))
    total = sum(entry.amount for entry in calculation)

    if request.paid_by_others:
        calculation.append(step("Less what others have paid or refunded", -request.paid_by_others))
        total -= request.paid_by_others

    if request.benefit in plans.deductible_applies_to and total > 0:
        deductible = min(plan.deductible, total)
        if deductible:
            calculation.append(step("Less the deductible", -deductible))
            total -= deductible

    maximum: float = getattr(plan, BENEFIT_MAXIMUM[request.benefit])
    if request.benefit in CAPPED_AT_TRIP_COST:
        maximum = min(maximum, policy.trip_cost)
    if total > maximum:
        calculation.append(
            step(f"Less the amount over the maximum of ${maximum:,.0f}", maximum - total)
        )
        total = maximum

    if total < 0:
        calculation.append(step("Nothing is left to pay", -total))
        total = 0.0

    payout = round(total, 2)
    return Payout(
        calculation=calculation,
        payout=payout,
        needs_sign_off=needs_sign_off(payout, approval_limit),
    )
