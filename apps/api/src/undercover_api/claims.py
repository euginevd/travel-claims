"""Reading claims and moving them between statuses. Every move is a conditional update, so
two requests racing for the same claim can't both win."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Connection, RowMapping, delete, func, insert, select, update

from undercover_api.db import (
    calculations,
    claims,
    customer_requests,
    customers,
    decisions,
    letters,
    model_calls,
    now,
    payments,
    policies,
    receipts,
    reference,
    sent_back,
    settings,
    steps,
)
from undercover_api.models import (
    Calculation,
    Claim,
    ClaimRef,
    ClaimSummary,
    CustomerLetter,
    CustomerMatch,
    CustomerRequest,
    Decision,
    DecisionKind,
    ModelCall,
    NewStep,
    Payment,
    Payout,
    Plans,
    Policy,
    PreviousClaim,
    Receipt,
    SentBackDecision,
    Stages,
    Status,
    Step,
    Trace,
)
from undercover_api.notices import announce, announce_requests
from undercover_api.payout import PolicyTerms
from undercover_api.redteam import REDTEAM_CUSTOMER

APPROVAL_LIMIT = "approval_limit"
PLANS = "plans"
MANUAL_VERSION = "claims_manual_version"


def not_found(claim_id: str) -> HTTPException:
    return HTTPException(404, f"Claim {claim_id} not found")


# How long a claim in progress may go without a heartbeat from the agent before it's stalled.
STALLED_AFTER = timedelta(seconds=90)


def is_stalled(status: str, heartbeat_at: str | None, at: datetime | None = None) -> bool:
    """Whether the agent stopped working a claim in progress: no heartbeat for too long."""
    if status != Status.IN_PROGRESS:
        return False
    if heartbeat_at is None:
        return True
    return (at or datetime.now(UTC)) - datetime.fromisoformat(heartbeat_at) > STALLED_AFTER


def find_claim(db: Connection, claim_id: str) -> RowMapping:
    """A claim's row, or a 404."""
    row = db.execute(select(claims).where(claims.c.claim_id == claim_id)).mappings().first()
    if row is None:
        raise not_found(claim_id)
    return row


def move_claim(db: Connection, claim_id: str, start: Status, end: Status, **values: Any) -> bool:
    """Move a claim from one status to another only if it's still in the first, with any other
    values given. Says whether it moved. A claim moved into progress starts its heartbeat."""
    if end == Status.IN_PROGRESS:
        values.setdefault("heartbeat_at", now())
    moved = db.execute(
        update(claims)
        .where(claims.c.claim_id == claim_id, claims.c.status == start)
        .values(status=end, **values)
    )
    if moved.rowcount == 1:
        announce(db, find_claim(db, claim_id))
    return moved.rowcount == 1


def set_status(db: Connection, claim_id: str, status: Status) -> None:
    db.execute(update(claims).where(claims.c.claim_id == claim_id).values(status=status))
    announce(db, find_claim(db, claim_id))


def customer_name(db: Connection, customer_id: str) -> str:
    return db.execute(
        select(customers.c.name).where(customers.c.customer_id == customer_id)
    ).scalar_one()


def find_decision(db: Connection, claim_id: str) -> Decision | None:
    row = db.execute(select(decisions).where(decisions.c.claim_id == claim_id)).mappings().first()
    if row is None:
        return None
    values = {k: v for k, v in row.items() if k != "claim_id"}
    values["checklist"] = values.get("checklist") or []
    return Decision.model_validate(values)


def find_payment(db: Connection, claim_id: str) -> Payment | None:
    row = db.execute(select(payments).where(payments.c.claim_id == claim_id)).mappings().first()
    return Payment.model_validate(dict(row)) if row else None


def claim_in_full(db: Connection, claim_id: str) -> Claim:
    """A claim with its customer's name, decision, payment and sent-back decisions."""
    row = find_claim(db, claim_id)
    returned = db.execute(
        select(sent_back).where(sent_back.c.claim_id == claim_id).order_by(sent_back.c.sent_back_id)
    ).mappings()
    decision = find_decision(db, claim_id)
    payment = find_payment(db, claim_id)
    return Claim.model_validate(
        dict(row)
        | {
            "customer_name": customer_name(db, row["customer_id"]),
            "policy": claims_policy(db, claim_id),
            "approval_limit": approval_limit(db),
            "decision": decision,
            "payment": payment,
            "sent_back_decisions": [SentBackDecision.model_validate(dict(r)) for r in returned],
            "receipts": list_receipts(db, claim_id),
            "requests": list_requests(db, claim_id),
            "letter": letter_of(db, claim_id),
            "stages": stages(db, row, decision, payment),
            "evaluation": row["source"] == "evaluation",
            "stalled": is_stalled(row["status"], row["heartbeat_at"]),
        }
    )


def stages(
    db: Connection, row: RowMapping, decision: Decision | None, payment: Payment | None
) -> Stages:
    """When the claim reached each stage: checked is the hidden-instruction check, assessed the
    agent's first step after it, on the current attempt."""
    thread_id = row["thread_id"]
    first: dict[str, str] = {}
    if thread_id is not None:
        for kind, created_at in db.execute(
            select(steps.c.kind, steps.c.created_at)
            .where(steps.c.claim_id == row["claim_id"], steps.c.thread_id == thread_id)
            .order_by(steps.c.step_id)
        ):
            key = "checked" if kind == "screening" else "assessed"
            first.setdefault(key, created_at)
    return Stages(
        received=row["submitted_on"],
        checked=first.get("checked"),
        assessed=first.get("assessed"),
        decided=decision.decided_at if decision else None,
        paid=payment.paid_at if payment else None,
    )


def find_customers(db: Connection, name: str, limit: int = 10) -> list[CustomerMatch]:
    """Customers whose name holds the text, in any case, with their claims."""
    pattern = f"%{name.strip().lower()}%"
    found = db.execute(
        select(customers.c.customer_id, customers.c.name)
        .where(func.lower(customers.c.name).like(pattern))
        .order_by(customers.c.name)
        .limit(limit)
    ).all()
    matches: list[CustomerMatch] = []
    for customer_id, customer_name in found:
        rows = db.execute(
            select(claims.c.claim_id, claims.c.status)
            .where(claims.c.customer_id == customer_id)
            .order_by(claims.c.claim_id)
        ).all()
        matches.append(
            CustomerMatch(
                customer_id=customer_id,
                name=customer_name,
                claims=[ClaimRef(claim_id=c, status=s) for c, s in rows],
            )
        )
    return matches


def list_claims(db: Connection) -> list[ClaimSummary]:
    """The queue, oldest submitted first."""
    query = (
        select(
            claims.c.claim_id,
            claims.c.customer_id,
            customers.c.name.label("customer_name"),
            claims.c.claim_type,
            claims.c.summary,
            claims.c.amount_claimed,
            claims.c.submitted_on,
            claims.c.status,
            decisions.c.decision,
            decisions.c.payout,
            claims.c.review_requested_at,
            claims.c.heartbeat_at,
            policies.c.record.label("policy"),
        )
        .join(customers, customers.c.customer_id == claims.c.customer_id)
        .join(policies, policies.c.policy_id == claims.c.policy_id)
        .outerjoin(decisions, decisions.c.claim_id == claims.c.claim_id)
        .where(claims.c.source != "evaluation")
        .order_by(claims.c.submitted_on, claims.c.claim_id)
    )
    asked = {
        claim_id: (total, done)
        for claim_id, total, done in db.execute(
            select(
                customer_requests.c.claim_id,
                func.count(),
                func.count(customer_requests.c.fulfilled_at),
            ).group_by(customer_requests.c.claim_id)
        ).all()
    }
    return [
        ClaimSummary.model_validate(
            dict(r)
            | {
                "plan": r["policy"]["plan"],
                "review_requested": r["review_requested_at"] is not None,
                "stalled": is_stalled(r["status"], r["heartbeat_at"]),
                "red_team": r["customer_id"] == REDTEAM_CUSTOMER,
                "due_on": business_days_after(r["submitted_on"], SERVICE_DAYS),
                "documents_in": r["claim_id"] in asked
                and asked[r["claim_id"]][0] == asked[r["claim_id"]][1]
                and r["decision"] == DecisionKind.REFER,
            }
        )
        for r in db.execute(query).mappings()
    ]


# How long a claim may take before it's overdue, in business days.
SERVICE_DAYS = 10
SATURDAY = 5


def business_days_after(day: str, days: int) -> str:
    """The date a number of business days (Monday to Friday) after another."""
    current = date.fromisoformat(day)
    left = days
    while left:
        current += timedelta(days=1)
        if current.weekday() < SATURDAY:
            left -= 1
    return current.isoformat()


def claims_policy(db: Connection, claim_id: str) -> Policy:
    """The policy a claim was made on."""
    policy_id = find_claim(db, claim_id)["policy_id"]
    record = db.execute(
        select(policies.c.record).where(policies.c.policy_id == policy_id)
    ).scalar_one()
    return Policy.model_validate(record)


def claim_history(db: Connection, claim_id: str) -> list[PreviousClaim]:
    """The earlier claims of a claim's customer."""
    customer_id = find_claim(db, claim_id)["customer_id"]
    record = db.execute(
        select(customers.c.record).where(customers.c.customer_id == customer_id)
    ).scalar_one()
    return [PreviousClaim.model_validate(c) for c in record.get("previous_claims", [])]


def policy_terms(policy: Policy) -> PolicyTerms:
    return PolicyTerms(policy.plan, policy.add_ons, len(policy.travelers), policy.trip.trip_cost)


def approval_limit(db: Connection) -> float:
    """The approval limit in force. With none set, nothing is paid without a sign-off."""
    value = db.execute(
        select(settings.c.value).where(settings.c.key == APPROVAL_LIMIT)
    ).scalar_one_or_none()
    return float(value) if value is not None else 0.0


def plans(db: Connection) -> Plans:
    value = db.execute(select(reference.c.value).where(reference.c.key == PLANS)).scalar_one()
    return Plans.model_validate(value)


def manual_version(db: Connection) -> str:
    return str(
        db.execute(select(reference.c.value).where(reference.c.key == MANUAL_VERSION)).scalar_one()
    )


def keep_calculation(db: Connection, claim_id: str, thread_id: str, payout: Payout) -> None:
    """Keep a claim's latest calculation in place of any before it, on the attempt's thread."""
    db.execute(delete(calculations).where(calculations.c.claim_id == claim_id))
    db.execute(
        insert(calculations).values(
            claim_id=claim_id,
            thread_id=thread_id,
            lines=[line.model_dump() for line in payout.calculation],
            payout=payout.payout,
            calculated_at=now(),
        )
    )


def attempts_calculation(db: Connection, claim: RowMapping) -> Calculation | None:
    """The latest calculation on a claim's current attempt, if any."""
    row = (
        db.execute(
            select(calculations).where(
                calculations.c.claim_id == claim["claim_id"],
                calculations.c.thread_id == claim["thread_id"],
            )
        )
        .mappings()
        .first()
    )
    return Calculation(lines=row["lines"], payout=row["payout"]) if row else None


def list_steps(db: Connection, claim_id: str) -> list[Step]:
    """A claim's steps, oldest first."""
    find_claim(db, claim_id)
    rows = db.execute(
        select(steps).where(steps.c.claim_id == claim_id).order_by(steps.c.step_id)
    ).mappings()
    return [Step.model_validate(dict(r)) for r in rows]


def add_step(db: Connection, claim_id: str, step: NewStep) -> None:
    """Add one step to a claim's record of work."""
    db.execute(insert(steps).values(claim_id=claim_id, created_at=now(), **step.model_dump()))


def list_receipts(db: Connection, claim_id: str) -> list[Receipt]:
    """A claim's receipts, oldest first."""
    rows = db.execute(
        select(receipts).where(receipts.c.claim_id == claim_id).order_by(receipts.c.uploaded_at)
    ).mappings()
    return [Receipt.model_validate(dict(r)) for r in rows]


MAX_REQUESTS = 5


def list_requests(db: Connection, claim_id: str) -> list[CustomerRequest]:
    """What we asked the claim's customer for, oldest first, with how many files each has."""
    rows = db.execute(
        select(customer_requests)
        .where(customer_requests.c.claim_id == claim_id)
        .order_by(customer_requests.c.request_id)
    ).mappings()
    found: list[CustomerRequest] = []
    for r in rows:
        files = db.execute(
            select(func.count())
            .select_from(receipts)
            .where(receipts.c.claim_id == claim_id, receipts.c.request_id == r["request_id"])
        ).scalar_one()
        found.append(CustomerRequest.model_validate(dict(r) | {"files": files}))
    return found


def add_requests(db: Connection, claim_id: str, texts: list[str], asked_by: str) -> None:
    """Ask the claim's customer for each thing, and tell them by email and text."""
    texts = texts[:MAX_REQUESTS]
    if not texts:
        return
    for text in texts:
        db.execute(
            insert(customer_requests).values(
                claim_id=claim_id, text=text, asked_by=asked_by, asked_at=now()
            )
        )
    announce_requests(db, find_claim(db, claim_id), texts)


def claim_trace(db: Connection, claim_id: str) -> Trace:
    """Every step and model call on a claim, with its total tokens and cost."""
    find_claim(db, claim_id)
    calls = [
        ModelCall.model_validate(dict(r))
        for r in db.execute(
            select(model_calls)
            .where(model_calls.c.claim_id == claim_id)
            .order_by(model_calls.c.call_id)
        ).mappings()
    ]
    return Trace(
        steps=list_steps(db, claim_id),
        model_calls=calls,
        total_cost=round(sum(c.cost for c in calls), 6),
        total_tokens=sum(c.input_tokens + c.output_tokens for c in calls),
    )


def letter_of(db: Connection, claim_id: str) -> CustomerLetter | None:
    """The letter sent to the customer about the claim's decision, if any."""
    row = db.execute(select(letters).where(letters.c.claim_id == claim_id)).mappings().first()
    return None if row is None else CustomerLetter.model_validate(dict(row))
