"""The customers' portal: a signed-in customer's own policies and claims, new claims and their
receipts. Every query here filters on the signed-in customer, so nobody reaches anyone else's.
Also the handlers' and the agent's ways to read receipts."""

import base64
import logging
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi import Path as FastPath
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import Connection, RowMapping, delete, func, insert, select, update

from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SignedIn, SignedInCustomer, require_agent
from undercover_api.claims import (
    find_claim,
    find_decision,
    find_payment,
    letter_of,
    list_receipts,
    list_requests,
)
from undercover_api.db import (
    claim_drafts,
    claims,
    customer_requests,
    insert_if_new,
    now,
    policies,
    receipts,
)
from undercover_api.fingerprints import NEAR, distance, exact, perceptual, unreadable
from undercover_api.models import (
    AgentReceipt,
    CaseChip,
    ClaimId,
    Customer,
    CustomerClaim,
    CustomerClaimSummary,
    DecisionKind,
    Draft,
    DuplicateMatch,
    MatchKind,
    NewClaimRequest,
    Policy,
    ReceiptDuplicates,
    ReceiptId,
    ReviewRequest,
    Status,
)
from undercover_api.notices import announce
from undercover_api.storage import MAX_RECEIPT_BYTES, MAX_RECEIPTS, Receipts, ReceiptStore, sniff

log = logging.getLogger(__name__)

customer_router = APIRouter(prefix="/api/customer")
receipt_router = APIRouter(prefix="/api/staff")
agent_receipt_router = APIRouter(
    prefix="/api/agent/claims/{claim_id}", dependencies=[Depends(require_agent)]
)

# What a customer reads about where their claim stands; never the handlers' own words.
STATUS_TEXT = {
    "received": "Received. We'll start looking at it shortly.",
    "assessing": "We're assessing your claim now.",
    "reviewing": "A senior claims handler is reviewing your claim.",
    "approved": "Approved. Your payment is on its way.",
    "paid": "Approved and paid.",
    "declined": "Declined. The reason is below.",
    "with_a_handler": "A claims handler is looking at your claim and will be in touch.",
}
REFERRED_REASON = "A claims handler will look at your claim personally and contact you."
APPROVED_IN_FULL = "Your policy covers this, so we paid what you claimed."
APPROVED_IN_PART = (
    "Your policy covers this. We paid ${paid:,.2f} of the ${claimed:,.2f} you claimed: the rest "
    "is over your plan's limits or what you pay first."
)
SOURCE_CUSTOMER = "customer"
CLAIM_ID_ATTEMPTS = 3
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}


def store(request: Request) -> Receipts:
    """The bucket when the api has one (AWS), else the folder."""
    bucket: Receipts | None = request.app.state.receipts
    return bucket or ReceiptStore(request.app.state.settings.receipts_dir)


Store = Annotated[Receipts, Depends(store)]


def own_claim(db: Connection, customer: Customer, claim_id: str) -> RowMapping:
    """One of the customer's own claims, or a 404 that says nothing about anyone else's."""
    row = (
        db.execute(
            select(claims).where(
                claims.c.claim_id == claim_id,
                claims.c.customer_id == customer.customer_id,
                claims.c.source != "evaluation",
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, f"Claim {claim_id} not found")
    return row


def plain_status(db: Connection, row: RowMapping) -> str:
    """Where a claim stands, in the customer's words."""
    match row["status"]:
        case Status.WAITING:
            return "received"
        case Status.IN_PROGRESS:
            return "assessing"
        case Status.WAITING_FOR_SIGN_OFF | Status.SENT_BACK:
            return "reviewing"
        case _:
            decision = find_decision(db, row["claim_id"])
            if decision is None or decision.decision == DecisionKind.REFER:
                return "with_a_handler"
            if decision.decision == DecisionKind.DECLINE:
                return "declined"
            return "paid" if find_payment(db, row["claim_id"]) else "approved"


def summary_of(db: Connection, row: RowMapping) -> CustomerClaimSummary:
    status = plain_status(db, row)
    return CustomerClaimSummary(
        claim_id=row["claim_id"],
        policy_id=row["policy_id"],
        claim_type=row["claim_type"],
        summary=row["summary"],
        amount_claimed=row["amount_claimed"],
        submitted_on=row["submitted_on"],
        status=status,
        status_text=STATUS_TEXT[status],
        open_requests=db.execute(
            select(func.count())
            .select_from(customer_requests)
            .where(
                customer_requests.c.claim_id == row["claim_id"],
                customer_requests.c.fulfilled_at.is_(None),
            )
        ).scalar_one(),
    )


def customer_reason(
    kind: DecisionKind, reason: str, payout: float, summary: CustomerClaimSummary
) -> str:
    """Why, in the customer's terms. An approval is said in plain words from the figures, as the
    agent's own reason is its working (the checks it ran); a decline keeps its reason, which the
    customer is owed; a referral's is never shown, as it may quote the hidden-instruction check."""
    if kind == DecisionKind.REFER:
        return REFERRED_REASON
    if kind == DecisionKind.APPROVE:
        if payout >= summary.amount_claimed:
            return APPROVED_IN_FULL
        return APPROVED_IN_PART.format(paid=payout, claimed=summary.amount_claimed)
    return reason


def claim_for_customer(db: Connection, row: RowMapping) -> CustomerClaim:
    """A claim as its customer sees it: the outcome and its reason, but nothing internal.
    A referral's reason is never shown, since it may quote the hidden-instruction check."""
    summary = summary_of(db, row)
    decision = find_decision(db, row["claim_id"]) if row["status"] == Status.DECIDED else None
    payment = find_payment(db, row["claim_id"])
    reason = None
    if decision is not None:
        reason = customer_reason(decision.decision, decision.reason, decision.payout, summary)
    found = list_receipts(db, row["claim_id"])
    sent_for_requests = request_files(db, row["claim_id"])
    general = [r for r in found if r.receipt_id not in sent_for_requests]
    return CustomerClaim(
        **summary.model_dump(),
        incident_date=row["incident_date"],
        incident_location=row["incident_location"],
        story=row["story"],
        items=row["items"],
        outcome=decision.decision if decision else None,
        reason=reason,
        paid=payment.amount if payment else None,
        paid_at=payment.paid_at if payment else None,
        paid_to=payment.paid_to if payment else None,
        receipts=general,
        requests=list_requests(db, row["claim_id"]),
        letter=letter_of(db, row["claim_id"]),
        can_add_receipts=row["status"] == Status.WAITING and len(general) < MAX_RECEIPTS,
        review_requested=row["review_requested_at"] is not None,
        can_request_review=row["status"] == Status.DECIDED and row["review_requested_at"] is None,
    )


@customer_router.get("/profile", operation_id="get_signed_in_customer")
def profile(customer: SignedInCustomer) -> Customer:
    """The customer signed in."""
    return customer


@customer_router.get("/policies", operation_id="list_my_policies")
def my_policies(customer: SignedInCustomer, db: Database) -> list[Policy]:
    """The signed-in customer's policies."""
    rows = db.execute(
        select(policies.c.record)
        .where(policies.c.customer_id == customer.customer_id)
        .order_by(policies.c.policy_id)
    ).scalars()
    return [Policy.model_validate(record) for record in rows]


@customer_router.get("/claims", operation_id="list_my_claims")
def my_claims(customer: SignedInCustomer, db: Database) -> list[CustomerClaimSummary]:
    """The signed-in customer's claims, newest first."""
    rows = db.execute(
        select(claims)
        .where(claims.c.customer_id == customer.customer_id, claims.c.source != "evaluation")
        .order_by(claims.c.submitted_on.desc(), claims.c.claim_id.desc())
    ).mappings()
    return [summary_of(db, row) for row in rows]


@customer_router.get("/claims/{claim_id}", operation_id="get_my_claim")
def my_claim(claim_id: ClaimId, customer: SignedInCustomer, db: Database) -> CustomerClaim:
    """One of the signed-in customer's claims, in plain words."""
    return claim_for_customer(db, own_claim(db, customer, claim_id))


def own_active_policy(db: Connection, customer: Customer, policy_id: str) -> Policy:
    record = db.execute(
        select(policies.c.record).where(
            policies.c.policy_id == policy_id, policies.c.customer_id == customer.customer_id
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(404, f"Policy {policy_id} not found")
    policy = Policy.model_validate(record)
    if policy.status != "active":
        raise HTTPException(422, f"Policy {policy_id} isn't active")
    return policy


def check_incident_date(policy: Policy, incident: str) -> None:
    """The incident must be a real date on the policy's trip, and not in the future."""
    try:
        day = date.fromisoformat(incident)
    except ValueError as error:
        raise HTTPException(422, "The incident date isn't a real date") from error
    if day > datetime.now(UTC).date():
        raise HTTPException(422, "The incident date can't be in the future")
    departs = date.fromisoformat(policy.trip.departs_on)
    returns = date.fromisoformat(policy.trip.returns_on)
    if not departs <= day <= returns:
        raise HTTPException(
            422,
            f"The incident date must be during your trip, {policy.trip.departs_on} to "
            f"{policy.trip.returns_on}",
        )


def next_claim_id(db: Connection) -> str:
    """The next claim number after the highest there is."""
    ids = db.execute(select(claims.c.claim_id).where(claims.c.source != "evaluation")).scalars()
    highest = max((int(claim_id.removeprefix("CLM-")) for claim_id in ids), default=1000)
    return f"CLM-{highest + 1}"


@customer_router.post("/claims", operation_id="make_claim", status_code=201)
def make_claim(body: NewClaimRequest, customer: SignedInCustomer, db: Database) -> CustomerClaim:
    """Make a claim on one of the signed-in customer's active policies. It waits for work."""
    policy = own_active_policy(db, customer, body.policy_id)
    check_incident_date(policy, body.incident_date)
    values = {
        "policy_id": policy.policy_id,
        "customer_id": customer.customer_id,
        "claim_type": body.claim_type,
        "submitted_on": datetime.now(UTC).date().isoformat(),
        "incident_date": body.incident_date,
        "incident_location": body.incident_location,
        "summary": body.summary,
        "story": body.story,
        "items": [item.model_dump() for item in body.items],
        "amount_claimed": round(sum(item.amount for item in body.items), 2),
        "documents": [],
        "status": Status.WAITING,
        "attempts": 0,
        "source": SOURCE_CUSTOMER,
    }
    for _ in range(CLAIM_ID_ATTEMPTS):
        claim_id = next_claim_id(db)
        if insert_if_new(db, claims, claim_id=claim_id, **values) is None:
            continue
        db.execute(delete(claim_drafts).where(claim_drafts.c.customer_id == customer.customer_id))
        row = own_claim(db, customer, claim_id)
        announce(db, row)
        return claim_for_customer(db, row)
    raise HTTPException(503, "Couldn't number the claim; please try again")


async def read_limited(upload: UploadFile) -> bytes:
    """A file's bytes, refusing one over the size limit without reading it all."""
    content = await upload.read(MAX_RECEIPT_BYTES + 1)
    if len(content) > MAX_RECEIPT_BYTES:
        raise HTTPException(413, "Each receipt must be 5 MB or smaller")
    if not content:
        raise HTTPException(422, "A receipt is empty")
    return content


@customer_router.post("/claims/{claim_id}/receipts", operation_id="add_receipts", status_code=201)
async def add_receipts(
    claim_id: ClaimId,
    files: Annotated[list[UploadFile], File(description="JPEG, PNG or PDF receipts")],
    customer: SignedInCustomer,
    db: Database,
    receipt_store: Store,
) -> CustomerClaim:
    """Add receipts to one of the customer's own claims while it waits: up to five in all,
    JPEG, PNG or PDF by their contents, 5 MB each."""
    row = own_claim(db, customer, claim_id)
    if row["status"] != Status.WAITING:
        raise HTTPException(409, "Receipts can be added only before we start on the claim")
    held = db.execute(
        select(func.count())
        .select_from(receipts)
        .where(receipts.c.claim_id == claim_id, receipts.c.request_id.is_(None))
    ).scalar_one()
    if not files or held + len(files) > MAX_RECEIPTS:
        raise HTTPException(422, f"A claim can have up to {MAX_RECEIPTS} receipts")
    await save_files(db, receipt_store, claim_id, files)
    return claim_for_customer(db, row)


async def save_files(
    db: Connection,
    receipt_store: Receipts,
    claim_id: str,
    files: list[UploadFile],
    request_id: int | None = None,
) -> None:
    """Check every file is a JPEG, PNG or PDF of 5 MB or less, then keep them all."""
    checked: list[tuple[bytes, str]] = []
    for upload in files:
        content = await read_limited(upload)
        media_type = sniff(content)
        if media_type is None:
            raise HTTPException(415, "Receipts must be JPEG, PNG or PDF files")
        if problem := unreadable(content, media_type):
            raise HTTPException(422, problem)
        checked.append((content, media_type))
    for content, media_type in checked:
        db.execute(
            insert(receipts).values(
                receipt_id=receipt_store.save(content),
                claim_id=claim_id,
                media_type=media_type,
                size=len(content),
                uploaded_at=now(),
                sha256=exact(content),
                phash=perceptual(content, media_type),
                request_id=request_id,
            )
        )
    log.info("claim %s: %d file(s) added", claim_id, len(checked))


def request_files(db: Connection, claim_id: str) -> set[str]:
    """The ids of the claim's files sent for a request, not as general receipts."""
    return set(
        db.execute(
            select(receipts.c.receipt_id).where(
                receipts.c.claim_id == claim_id, receipts.c.request_id.is_not(None)
            )
        ).scalars()
    )


@customer_router.post(
    "/claims/{claim_id}/requests/{request_id}/files",
    operation_id="answer_request",
    status_code=201,
)
async def answer_request(  # noqa: PLR0913, PLR0917 - the route's parts
    claim_id: ClaimId,
    request_id: Annotated[int, FastPath(ge=1, le=2**31 - 1)],
    files: Annotated[list[UploadFile], File(description="JPEG, PNG or PDF files")],
    customer: SignedInCustomer,
    db: Database,
    receipt_store: Store,
) -> CustomerClaim:
    """Send the files for something we asked for on one of the customer's own claims: up to
    five per request. Sending them marks the request done."""
    row = own_claim(db, customer, claim_id)
    asked = (
        db.execute(
            select(customer_requests).where(
                customer_requests.c.request_id == request_id,
                customer_requests.c.claim_id == claim_id,
            )
        )
        .mappings()
        .first()
    )
    if asked is None:
        raise HTTPException(404, "Request not found")
    held = db.execute(
        select(func.count())
        .select_from(receipts)
        .where(receipts.c.claim_id == claim_id, receipts.c.request_id == request_id)
    ).scalar_one()
    if not files or held + len(files) > MAX_RECEIPTS:
        raise HTTPException(422, f"Up to {MAX_RECEIPTS} files for each request")
    await save_files(db, receipt_store, claim_id, files, request_id)
    db.execute(
        update(customer_requests)
        .where(
            customer_requests.c.request_id == request_id,
            customer_requests.c.fulfilled_at.is_(None),
        )
        .values(fulfilled_at=now())
    )
    return claim_for_customer(db, row)


def receipt_row(db: Connection, claim_id: str, receipt_id: str) -> RowMapping:
    row = (
        db.execute(
            select(receipts).where(
                receipts.c.claim_id == claim_id, receipts.c.receipt_id == receipt_id
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Receipt not found")
    return row


@receipt_router.get("/claims/{claim_id}/receipts/{receipt_id}", operation_id="download_receipt")
def download_receipt(
    claim_id: ClaimId, receipt_id: ReceiptId, _: SignedIn, db: Database, receipt_store: Store
) -> Response:
    """A receipt for a handler, always as a download and never run by the browser."""
    find_claim(db, claim_id)
    row = receipt_row(db, claim_id, receipt_id)
    name = f"{claim_id}-{receipt_id[:8]}.{EXTENSIONS[row['media_type']]}"
    return Response(
        receipt_store.read(row["receipt_id"]),
        media_type=row["media_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@agent_receipt_router.get("/receipts", operation_id="get_receipts")
def agent_receipts(claim_id: ClaimId, db: Database, receipt_store: Store) -> list[AgentReceipt]:
    """The claim's receipts for the agent, their bytes in base64."""
    find_claim(db, claim_id)
    return [
        AgentReceipt(
            receipt_id=receipt.receipt_id,
            media_type=receipt.media_type,
            data=base64.b64encode(receipt_store.read(receipt.receipt_id)).decode(),
        )
        for receipt in list_receipts(db, claim_id)
    ]


@agent_receipt_router.get("/duplicates", operation_id="find_duplicate_receipts")
def duplicate_receipts(claim_id: ClaimId, db: Database) -> list[ReceiptDuplicates]:
    """For each of the claim's receipts, other claims holding the same one: the same bytes, or
    an image that looks the same. Only claim ids, never another customer's details."""
    find_claim(db, claim_id)
    mine = db.execute(
        select(receipts.c.sha256, receipts.c.phash)
        .where(receipts.c.claim_id == claim_id)
        .order_by(receipts.c.uploaded_at)
    ).all()
    others = db.execute(
        select(receipts.c.claim_id, receipts.c.sha256, receipts.c.phash).where(
            receipts.c.claim_id != claim_id
        )
    ).all()
    found: list[ReceiptDuplicates] = []
    for number, (sha, phash) in enumerate(mine, start=1):
        matches: dict[str, MatchKind] = {}
        for other_claim, other_sha, other_phash in others:
            if sha and sha == other_sha:
                matches[other_claim] = "exact"
            elif phash and other_phash and distance(phash, other_phash) <= NEAR:
                matches.setdefault(other_claim, "near")
        found.append(
            ReceiptDuplicates(
                receipt=number,
                matches=[DuplicateMatch(claim_id=c, match=m) for c, m in sorted(matches.items())],
            )
        )
    return found


@customer_router.post("/claims/{claim_id}/review-request", operation_id="request_review")
def request_review(
    claim_id: ClaimId, body: ReviewRequest, customer: SignedInCustomer, db: Database
) -> CustomerClaim:
    """Ask for a person to review a decided claim; asking again changes nothing."""
    row = own_claim(db, customer, claim_id)
    if row["status"] != Status.DECIDED:
        raise HTTPException(409, "You can ask for a review once your claim has a decision")
    db.execute(
        update(claims)
        .where(claims.c.claim_id == claim_id, claims.c.review_requested_at.is_(None))
        .values(review_requested_at=now(), review_note=body.note or None)
    )
    return claim_for_customer(db, own_claim(db, customer, claim_id))


# --- The drafting assistant ---

DRAFTS_PER_HOUR = 10
HOUR_SECONDS = 3600


class DraftLimiter:
    """How many drafts each customer has asked for in the last hour, in this process."""

    def __init__(self, per_hour: int = DRAFTS_PER_HOUR) -> None:
        self._per_hour = per_hour
        self._asked: dict[str, list[float]] = {}

    def allow(self, customer_id: str, at: float) -> bool:
        recent = [t for t in self._asked.get(customer_id, []) if at - t < HOUR_SECONDS]
        if len(recent) >= self._per_hour:
            self._asked[customer_id] = recent
            return False
        self._asked[customer_id] = [*recent, at]
        return True


def drafting(request: Request) -> tuple[AgentService, DraftLimiter]:
    state = request.app.state
    if not hasattr(state, "draft_limiter"):
        state.draft_limiter = DraftLimiter()
    return state.agent, state.draft_limiter


Drafting = Annotated[tuple[AgentService, DraftLimiter], Depends(drafting)]


@customer_router.post("/drafts", operation_id="draft_claim")
async def draft_claim(  # noqa: PLR0913, PLR0917 - the form's fields
    customer: SignedInCustomer,
    db: Database,
    tools: Drafting,
    policy_id: Annotated[str, Form(pattern=r"^POL-\d{1,10}$")],
    text: Annotated[str, Form(max_length=1000)] = "",
    case: Annotated[CaseChip, Form()] = "",
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> Draft:
    """Draft a claim from a few words, a chosen case and receipts, for the customer to check.
    The draft is never submitted for them, and what the assistant says is checked here."""
    policy = own_active_policy(db, customer, policy_id)
    service, limiter = tools
    if not limiter.allow(customer.customer_id, datetime.now(UTC).timestamp()):
        raise HTTPException(429, "That's a lot of drafts in an hour. Please try again later.")
    uploads = files or []
    if len(uploads) > MAX_RECEIPTS:
        raise HTTPException(422, f"Up to {MAX_RECEIPTS} receipts")
    if not text.strip() and not case and not uploads:
        raise HTTPException(422, "Add a receipt, pick what happened or say a few words")
    sent: list[dict[str, str]] = []
    for upload in uploads:
        content = await read_limited(upload)
        media_type = sniff(content)
        if media_type is None:
            raise HTTPException(415, "Receipts must be JPEG, PNG or PDF files")
        if problem := unreadable(content, media_type):
            raise HTTPException(422, problem)
        sent.append({"media_type": media_type, "data": base64.b64encode(content).decode()})
    request: dict[str, object] = {
        "text": text.strip(),
        "case": case,
        "trip": policy.trip.model_dump(),
        "today": datetime.now(UTC).date().isoformat(),
        "receipts": sent,
    }
    try:
        answer = service.draft(request)
    except AgentUnavailableError as error:
        log.warning("a draft failed: %s", error)
        raise HTTPException(503, "The assistant isn't available; fill it in yourself") from error
    try:
        return Draft.model_validate(answer)
    except ValidationError as error:
        raise HTTPException(502, "The assistant's draft didn't make sense; fill it in") from error
