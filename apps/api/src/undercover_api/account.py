"""More of the customers' portal: where payouts go, the messages we've sent, a claim saved to
finish later, and flight delays the flight-status feed found. Every query filters on the
signed-in customer."""

import logging
from datetime import UTC, datetime
from math import ceil
from typing import Annotated, cast

from fastapi import APIRouter, HTTPException, Response
from fastapi import Path as FastPath
from pydantic import BaseModel
from sqlalchemy import Connection, delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from undercover_api.auth import Database, SignedInCustomer
from undercover_api.claims import plans
from undercover_api.db import claim_drafts, claims, customers, notices, now, policies
from undercover_api.flights import Flight, delay_text, find_flight, flights_for
from undercover_api.models import (
    ClaimDraft,
    Customer,
    CustomerClaim,
    DelayOffer,
    Notice,
    PayId,
    PayIdRequest,
    Plan,
    Policy,
    SavedDraft,
    Status,
)
from undercover_api.notices import announce
from undercover_api.payments import mask_payid
from undercover_api.payout import MEALS_PER_TRAVELER_PER_DAY
from undercover_api.portal import (
    CLAIM_ID_ATTEMPTS,
    SOURCE_CUSTOMER,
    claim_for_customer,
    next_claim_id,
    own_claim,
)

log = logging.getLogger(__name__)

account_router = APIRouter(prefix="/api/customer")
FLIGHT_STATUS = "flight_status"
FlightId = Annotated[str, FastPath(pattern=r"^FL-\d{4}-\d{1,2}$")]


# --- Where payouts go ---


def current_payid(db: Connection, customer: Customer) -> str | None:
    return db.execute(
        select(customers.c.payid).where(customers.c.customer_id == customer.customer_id)
    ).scalar_one_or_none()


@account_router.get("/payid", operation_id="get_my_payid")
def get_payid(customer: SignedInCustomer, db: Database) -> PayId:
    """Where the customer's payouts go, mostly hidden, or nothing yet."""
    payid = current_payid(db, customer)
    return PayId(payid=mask_payid(payid) if payid else None)


@account_router.put("/payid", operation_id="set_my_payid")
def set_payid(body: PayIdRequest, customer: SignedInCustomer, db: Database) -> PayId:
    """Send the customer's payouts to this PayID from now on."""
    payid = body.payid.replace(" ", "")
    db.execute(
        update(customers).where(customers.c.customer_id == customer.customer_id).values(payid=payid)
    )
    log.info("customer %s: PayID changed", customer.customer_id)
    return PayId(payid=mask_payid(payid))


# --- The messages we've sent ---


@account_router.get("/notices", operation_id="list_my_notices")
def my_notices(customer: SignedInCustomer, db: Database) -> list[Notice]:
    """The emails and texts we've sent the customer, newest first, up to 50."""
    rows = db.execute(
        select(notices)
        .where(notices.c.customer_id == customer.customer_id)
        .order_by(notices.c.notice_id.desc())
        .limit(50)
    ).mappings()
    return [Notice.model_validate(dict(r)) for r in rows]


# --- A claim saved to finish later ---


@account_router.get("/draft", operation_id="get_my_draft")
def get_draft(customer: SignedInCustomer, db: Database) -> SavedDraft | None:
    """The claim the customer started and hasn't sent, if any."""
    row = (
        db.execute(select(claim_drafts).where(claim_drafts.c.customer_id == customer.customer_id))
        .mappings()
        .first()
    )
    if row is None:
        return None
    return SavedDraft(draft=ClaimDraft.model_validate(row["data"]), updated_at=row["updated_at"])


@account_router.put("/draft", operation_id="save_my_draft")
def save_draft(body: ClaimDraft, customer: SignedInCustomer, db: Database) -> SavedDraft:
    """Keep the claim the customer is filling in, in place of any saved before."""
    at = now()
    values = {"data": body.model_dump(), "updated_at": at}
    changed = db.execute(
        update(claim_drafts)
        .where(claim_drafts.c.customer_id == customer.customer_id)
        .values(**values)
    )
    if changed.rowcount == 0:
        try:
            with db.begin_nested():
                db.execute(insert(claim_drafts).values(customer_id=customer.customer_id, **values))
        except IntegrityError:
            db.execute(
                update(claim_drafts)
                .where(claim_drafts.c.customer_id == customer.customer_id)
                .values(**values)
            )
    return SavedDraft(draft=body, updated_at=at)


@account_router.delete("/draft", operation_id="discard_my_draft", status_code=204)
def discard_draft(customer: SignedInCustomer, db: Database) -> Response:
    """Throw away the saved claim."""
    db.execute(delete(claim_drafts).where(claim_drafts.c.customer_id == customer.customer_id))
    return Response(status_code=204)


# --- Cover at a glance ---


class Cover(BaseModel):
    """What one of the customer's policies covers, from its plan's limits."""

    policy_id: str
    destination: str
    departs_on: str
    returns_on: str
    plan: Plan
    add_ons: list[str]


@account_router.get("/cover", operation_id="list_my_cover")
def my_cover(customer: SignedInCustomer, db: Database) -> list[Cover]:
    """Each of the customer's active trips with the limits its plan gives."""
    by_plan = {p.plan: p for p in plans(db).plans}
    found: list[Cover] = []
    for policy in my_active_policies(db, customer):
        plan = by_plan.get(policy.plan)
        if plan is None:
            continue
        found.append(
            Cover(
                policy_id=policy.policy_id,
                destination=policy.trip.destination,
                departs_on=policy.trip.departs_on,
                returns_on=policy.trip.returns_on,
                plan=plan,
                add_ons=policy.add_ons,
            )
        )
    return found


# --- Flight delays ---


def my_active_policies(db: Connection, customer: Customer) -> list[Policy]:
    rows = db.execute(
        select(policies.c.record).where(policies.c.customer_id == customer.customer_id)
    ).scalars()
    return [p for p in (Policy.model_validate(r) for r in rows) if p.status == "active"]


def claimed_flights(db: Connection, customer: Customer) -> set[str]:
    """The flights the customer has already claimed a delay for."""
    found: set[str] = set()
    rows = db.execute(
        select(claims.c.documents).where(claims.c.customer_id == customer.customer_id)
    ).scalars()
    for documents in rows:
        for document in cast(list[dict[str, str]], documents or []):
            if document.get("type") == FLIGHT_STATUS:
                name = document.get("name", "").removeprefix("Flight status ")
                found.add(name.split(":")[0])
    return found


def offer_for(db: Connection, policy: Policy, flight: Flight) -> DelayOffer | None:
    """The delay cover a flight's delay earns on the policy's plan, or None if it's too short."""
    plan = next((p for p in plans(db).plans if p.plan == policy.plan), None)
    if plan is None or flight.delay_minutes < plan.trip_delay_waiting_hours * 60:
        return None
    meals = (
        MEALS_PER_TRAVELER_PER_DAY
        * len(policy.travelers or [1])
        * ceil(flight.delay_minutes / (24 * 60))
    )
    return DelayOffer(
        flight_id=flight.flight_id,
        policy_id=policy.policy_id,
        flight=flight.flight,
        route=flight.route,
        date=flight.date,
        delay_minutes=flight.delay_minutes,
        waiting_hours=plan.trip_delay_waiting_hours,
        estimate=round(min(meals, plan.trip_delay_max), 2),
    )


@account_router.get("/delays", operation_id="list_my_delays")
def my_delays(customer: SignedInCustomer, db: Database) -> list[DelayOffer]:
    """Flights on the customer's trips that were delayed long enough for their plan's delay
    cover, which they haven't claimed yet."""
    claimed = claimed_flights(db, customer)
    offers: list[DelayOffer] = []
    for policy in my_active_policies(db, customer):
        for flight in flights_for(policy.policy_id):
            offer = offer_for(db, policy, flight)
            if offer is not None and flight.flight_id not in claimed:
                offers.append(offer)
    return offers


@account_router.post("/delays/{flight_id}/claim", operation_id="claim_delay", status_code=201)
def claim_delay(flight_id: FlightId, customer: SignedInCustomer, db: Database) -> CustomerClaim:
    """Claim a delay the flight-status feed found, in one tap: the claim is filled in from the
    feed, with its record attached, and waits for the agent like any other."""
    flight = find_flight(flight_id)
    policy = next(
        (p for p in my_active_policies(db, customer) if flight and p.policy_id == flight.policy_id),
        None,
    )
    if flight is None or policy is None:
        raise HTTPException(404, "Flight not found")
    if flight_id in claimed_flights(db, customer):
        raise HTTPException(409, "You've already claimed this delay")
    offer = offer_for(db, policy, flight)
    if offer is None:
        raise HTTPException(422, "This flight wasn't delayed long enough for your plan's cover")
    late = delay_text(flight.delay_minutes)
    values = {
        "policy_id": policy.policy_id,
        "customer_id": customer.customer_id,
        "claim_type": "trip_delay",
        "submitted_on": datetime.now(UTC).date().isoformat(),
        "incident_date": flight.date,
        "incident_location": flight.route,
        "summary": f"Flight {flight.flight} was {late} late",
        "story": (
            f"My flight {flight.flight}, {flight.route}, on {flight.date} left {late} late. "
            "I'm claiming meals and refreshments while I waited. UnderCover found the delay "
            "from the flight-status feed and I claimed it from the portal."
        ),
        "items": [
            {
                "description": f"Meals and refreshments during the {late} delay (no receipts)",
                "category": "meals",
                "amount": offer.estimate,
            }
        ],
        "amount_claimed": offer.estimate,
        "documents": [
            {
                "name": f"Flight status {flight.flight_id}: {flight.flight} on {flight.date}",
                "type": FLIGHT_STATUS,
                "content": (
                    f"Flight-status feed record. Flight {flight.flight}, {flight.route}. "
                    f"Scheduled departure {flight.scheduled}, actual departure {flight.actual}: "
                    f"departed {flight.delay_minutes} minutes ({late}) late. Source: the "
                    "flight-status feed, verified by UnderCover, not supplied by the customer."
                ),
            }
        ],
        "status": Status.WAITING,
        "attempts": 0,
        "source": SOURCE_CUSTOMER,
    }
    for _ in range(CLAIM_ID_ATTEMPTS):
        claim_id = next_claim_id(db)
        try:
            with db.begin_nested():
                db.execute(insert(claims).values(claim_id=claim_id, **values))
        except IntegrityError:
            continue
        row = own_claim(db, customer, claim_id)
        announce(db, row)
        log.info("claim %s: delay claim for flight %s", claim_id, flight_id)
        return claim_for_customer(db, row)
    raise HTTPException(503, "Couldn't number the claim; please try again")
