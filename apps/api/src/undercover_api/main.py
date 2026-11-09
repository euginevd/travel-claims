"""The api's FastAPI app: claims, decisions, payments and sign-in.

Start it with uvicorn's factory mode: uvicorn undercover_api.main:create_app --factory
"""

import logging
import secrets
import uuid
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from sqlalchemy import Connection, Engine, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from undercover_api.account import account_router
from undercover_api.agent_service import (
    AgentRefusedError,
    AgentService,
    AgentUnavailableError,
    HttpAgentService,
    Outcome,
)
from undercover_api.auth import (
    CUSTOMERS_GROUP,
    ENGINEERS_GROUP,
    HANDLERS_GROUP,
    Database,
    LocalKeys,
    RemoteKeys,
    SeniorHandler,
    SignedIn,
    TokenVerifier,
    require_agent,
)
from undercover_api.claims import (
    add_requests,
    add_step,
    approval_limit,
    attempts_calculation,
    claim_history,
    claim_in_full,
    claim_trace,
    claims_policy,
    find_claim,
    find_customers,
    find_decision,
    keep_calculation,
    list_claims,
    list_steps,
    manual_version,
    move_claim,
    plans,
    policy_terms,
    set_status,
)
from undercover_api.db import (
    calculations,
    claims,
    customers,
    decisions,
    engineers,
    handlers,
    make_engine,
    model_calls,
    now,
    payments,
    sent_back,
)
from undercover_api.demo import demo_router
from undercover_api.evaluations import EVALUATION, version_for_attempt
from undercover_api.improvement import ROUTERS as EVALUATION_ROUTERS
from undercover_api.kill_switch import (
    PAUSED_REASON,
    payout_switch,
    payouts_paused,
    refuse_while_paused,
    set_payouts,
)
from undercover_api.local_sign_in import TOKEN_LIFETIME, LocalIssuer
from undercover_api.logs import configure_logging, log_requests, redact_names
from undercover_api.models import (
    SCREENING_MAKER,
    AskRequest,
    Claim,
    ClaimId,
    ClaimSummary,
    CustomerMatch,
    CustomerName,
    Decision,
    DecisionKind,
    DecisionRequest,
    Handler,
    HoldRequest,
    ModelCallRequest,
    NewStep,
    OverrideRequest,
    PaymentRequest,
    Payout,
    PayoutRequest,
    PayoutSwitch,
    PayoutSwitchRequest,
    Policy,
    PreviousClaim,
    SendBackRequest,
    SignIn,
    SignInRequest,
    StartRequest,
    Status,
    Step,
    StepRequest,
    TestSignInRequest,
    Trace,
)
from undercover_api.payments import pay, record_payment
from undercover_api.payout import UnknownPlanError, needs_sign_off, work_out_payout
from undercover_api.portal import agent_receipt_router, customer_router, receipt_router
from undercover_api.records import check_calculation, check_request
from undercover_api.redteam import redteam_router
from undercover_api.settings import Settings, get_settings
from undercover_api.threats import threats_router

log = logging.getLogger(__name__)

AGENT = [Depends(require_agent)]

health_router = APIRouter()
agent_router = APIRouter(prefix="/api/agent/claims/{claim_id}", dependencies=AGENT)
# Staff and customers each have their own prefix; the dashboard's and the portal's web servers
# each forward only theirs.
staff_router = APIRouter(prefix="/api/staff")
staff_sign_in_router = APIRouter(prefix="/api/staff/dev")
customer_sign_in_router = APIRouter(prefix="/api/customer/dev")
engineering_sign_in_router = APIRouter(prefix="/api/engineering/dev")


@health_router.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Say the api is up."""
    return {"status": "ok"}


# --- Read by the agent, on its own routes, and by handlers, on theirs ---


@agent_router.get("", operation_id="get_claim_for_agent")
def get_claim_for_agent(claim_id: ClaimId, db: Database) -> Claim:
    """The agent's claim in full, with its policy, decision, payment and decisions sent back."""
    return claim_in_full(db, claim_id)


@agent_router.get("/steps", operation_id="list_steps_for_agent")
def get_steps_for_agent(claim_id: ClaimId, db: Database) -> list[Step]:
    """The steps of the agent's work on its claim, oldest first."""
    return list_steps(db, claim_id)


@staff_router.get("/claims/{claim_id}", operation_id="get_claim")
def get_claim(claim_id: ClaimId, _: SignedIn, db: Database) -> Claim:
    """A claim in full, with its policy, decision, payment and any decisions sent back."""
    return claim_in_full(db, claim_id)


@staff_router.get("/claims/{claim_id}/steps", operation_id="list_steps")
def get_steps(claim_id: ClaimId, _: SignedIn, db: Database) -> list[Step]:
    """The steps of the agent's work on a claim, oldest first."""
    return list_steps(db, claim_id)


# --- The agent's, each scoped to the one claim it works on ---


@agent_router.post("/start", operation_id="start_claim")
def start_claim(claim_id: ClaimId, request: StartRequest, db: Database) -> Claim:
    """Start a new attempt on a waiting claim, once."""
    if not start_attempt(db, claim_id, request.thread_id):
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} isn't waiting")
    return claim_in_full(db, claim_id)


@agent_router.post("/take", operation_id="take_claim")
def take_claim(claim_id: ClaimId, db: Database) -> Claim:
    """Take a sent-back claim back into work, once."""
    if not move_claim(db, claim_id, Status.SENT_BACK, Status.IN_PROGRESS):
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} hasn't been sent back")
    return claim_in_full(db, claim_id)


@agent_router.get("/policy", operation_id="get_policy")
def get_policy(claim_id: ClaimId, db: Database) -> Policy:
    """The policy the claim was made on."""
    return claims_policy(db, claim_id)


@agent_router.get("/history", operation_id="get_claim_history")
def get_claim_history(claim_id: ClaimId, db: Database) -> list[PreviousClaim]:
    """The claim's customer's earlier claims, with their outcome and amount paid."""
    return claim_history(db, claim_id)


@agent_router.post("/payout", operation_id="calculate_payout")
def calculate_payout(claim_id: ClaimId, request: PayoutRequest, db: Database) -> Payout:
    """Work out an approval's payout with UnderCover's payout rules, and keep it."""
    claim = find_claim(db, claim_id)
    if claim["status"] != Status.IN_PROGRESS or claim["thread_id"] is None:
        raise HTTPException(409, f"Claim {claim_id} isn't in progress")
    terms = policy_terms(claims_policy(db, claim_id))
    try:
        payout = work_out_payout(terms, plans(db), request, approval_limit(db))
    except UnknownPlanError as error:
        raise HTTPException(409, f"The payout rules have no plan {error}") from error
    keep_calculation(db, claim_id, claim["thread_id"], payout)
    return payout


@agent_router.post("/decision", operation_id="record_decision")
def record_decision(
    claim_id: ClaimId, request: DecisionRequest, db: Database, http: Request
) -> Claim:
    """Record the claim's decision once, as claims manual section 14 asks. The api names who
    made it."""
    check_request(request)
    claim = find_claim(db, claim_id)
    current = find_decision(db, claim_id)
    if current is not None:
        if (current.decision, current.payout) == (request.decision, request.payout):
            return claim_in_full(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} has already been decided")
    if claim["status"] != Status.IN_PROGRESS:
        raise HTTPException(409, f"Claim {claim_id} isn't in progress")
    calculation = None
    if request.decision == DecisionKind.APPROVE:
        calculation = check_calculation(request.payout, attempts_calculation(db, claim))
    limit = approval_limit(db)
    settings: Settings = http.app.state.settings
    record = dict(
        decision=request.decision,
        payout=request.payout,
        calculation=calculation and calculation.model_dump(),
        section=request.section,
        reason=request.reason,
        decided_by=maker_name(request, claim["config_version"] or settings.agent_version),
        decided_at=now(),
        manual_version=manual_version(db),
        approval_limit=limit,
        checklist=[check.model_dump() for check in request.checklist],
    )
    try:
        with db.begin_nested():
            db.execute(insert(decisions).values(claim_id=claim_id, **record))
    except IntegrityError as error:
        raise HTTPException(409, f"Claim {claim_id} has already been decided") from error
    if request.decision != DecisionKind.APPROVE or claim["source"] == EVALUATION:
        # An evaluation's copy is never paid or signed off: its approval is finished here.
        set_status(db, claim_id, Status.DECIDED)
    elif needs_sign_off(request.payout, limit):
        set_status(db, claim_id, Status.WAITING_FOR_SIGN_OFF)
    elif payouts_paused(db):
        # Every approval holds while payouts are paused, for a sign-off once they're back on.
        set_status(db, claim_id, Status.WAITING_FOR_SIGN_OFF)
        db.execute(
            update(decisions)
            .where(decisions.c.claim_id == claim_id)
            .values(hold_reason=PAUSED_REASON)
        )
    if (
        request.decision == DecisionKind.REFER
        and request.maker == "claim_agent"
        and claim["source"] != EVALUATION
    ):
        # Only the claim agent asks the customer; the hidden-instruction check never does.
        add_requests(db, claim_id, request.customer_requests, str(record["decided_by"]))
    return claim_in_full(db, claim_id)


def maker_name(request: DecisionRequest, version: int) -> str:
    """Who made a decision, as the record names it: never the caller's own words."""
    if request.maker == "hidden_instruction_check":
        return SCREENING_MAKER
    return f"UnderCover Agent v{version}"


@agent_router.post("/payment", operation_id="pay_claim")
def pay_claim(claim_id: ClaimId, request: PaymentRequest, db: Database) -> Claim:
    """Pay an approved claim its payout once; never over the approval limit."""
    if pay(db, claim_id, request.amount):
        set_status(db, claim_id, Status.DECIDED)
    return claim_in_full(db, claim_id)


@agent_router.post("/hold", operation_id="hold_payment")
def hold_payment(claim_id: ClaimId, request: HoldRequest, db: Database) -> Claim:
    """Hold an approval's payment for a handler's sign-off, with the reason."""
    decision = find_decision(db, claim_id)
    if decision is None or decision.decision != DecisionKind.APPROVE:
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} has no approval to hold")
    if not move_claim(db, claim_id, Status.IN_PROGRESS, Status.WAITING_FOR_SIGN_OFF):
        if find_claim(db, claim_id)["status"] == Status.WAITING_FOR_SIGN_OFF:
            return claim_in_full(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} can't be held")
    db.execute(
        update(decisions).where(decisions.c.claim_id == claim_id).values(hold_reason=request.reason)
    )
    return claim_in_full(db, claim_id)


@agent_router.post("/steps", operation_id="record_step", status_code=201)
def record_step(claim_id: ClaimId, request: StepRequest, db: Database) -> dict[str, str]:
    """Record one step of the agent's work on the claim."""
    find_claim(db, claim_id)
    add_step(db, claim_id, NewStep.model_validate(request.model_dump()))
    return {"recorded": "step"}


@agent_router.post("/model-calls", operation_id="record_model_call", status_code=201)
def record_model_call(claim_id: ClaimId, request: ModelCallRequest, db: Database) -> dict[str, str]:
    """Record one model call's tokens and cost on the claim."""
    find_claim(db, claim_id)
    db.execute(
        insert(model_calls).values(claim_id=claim_id, created_at=now(), **request.model_dump())
    )
    return {"recorded": "model call"}


# --- Handing work to the agent ---


def start_attempt(db: Connection, claim_id: str, thread_id: str) -> bool:
    """Move a waiting claim into a new attempt on the thread given. Says whether it moved."""
    return move_claim(
        db,
        claim_id,
        Status.WAITING,
        Status.IN_PROGRESS,
        thread_id=thread_id,
        attempts=claims.c.attempts + 1,
        config_version=version_for_attempt(db, claim_id),
    )


def undo_move(
    db: Connection, claim_id: str, on_thread: str, back_to: Status, **values: Any
) -> None:
    """Put a claim the agent didn't take back where it was, if nothing has moved it since."""
    db.execute(
        update(claims)
        .where(
            claims.c.claim_id == claim_id,
            claims.c.status == Status.IN_PROGRESS,
            claims.c.thread_id == on_thread,
        )
        .values(status=back_to, **values)
    )
    db.commit()


def agent(request: Request) -> AgentService:
    service: AgentService = request.app.state.agent
    return service


AgentCalls = Annotated[AgentService, Depends(agent)]


def ask_agent(db: Connection, ask: Callable[[], None]) -> None:
    """Save what the api did for the work, then ask the agent, which reads it straight away."""
    db.commit()
    ask()


@dataclass(frozen=True)
class Handover:
    """Work moved to the agent: its thread, how to ask the agent, and how to undo the move."""

    thread_id: str
    ask: Callable[[], None]
    back_to: Status
    undo: dict[str, Any]


def hand_over(db: Connection, claim_id: str, service: AgentService) -> Handover:
    """Move a waiting or sent-back claim into work for the agent, or refuse with a 409."""
    claim = find_claim(db, claim_id)
    if claim["status"] == Status.WAITING:
        thread_id = uuid.uuid4().hex
        if start_attempt(db, claim_id, thread_id):
            return Handover(
                thread_id,
                lambda: service.work(claim_id, thread_id),
                Status.WAITING,
                {"thread_id": None, "attempts": claims.c.attempts - 1},
            )
    if claim["status"] == Status.SENT_BACK:
        thread_id = claim["thread_id"]
        if move_claim(db, claim_id, Status.SENT_BACK, Status.IN_PROGRESS):
            return Handover(
                thread_id,
                lambda: service.resume(claim_id, thread_id, Outcome.SENT_BACK),
                Status.SENT_BACK,
                {},
            )
    raise HTTPException(409, f"Claim {claim_id} isn't waiting or sent back")


@staff_router.post("/claims/{claim_id}/work", operation_id="work_claim")
def work_claim(claim_id: ClaimId, _: SignedIn, db: Database, service: AgentCalls) -> Claim:
    """Ask the agent to work a waiting claim, or to take a sent-back one up again."""
    handover = hand_over(db, claim_id, service)
    try:
        ask_agent(db, handover.ask)
    except AgentUnavailableError as error:
        undo_move(db, claim_id, handover.thread_id, handover.back_to, **handover.undo)
        code = 502 if isinstance(error, AgentRefusedError) else 503
        raise HTTPException(code, str(error)) from error
    return claim_in_full(db, claim_id)


# --- Handlers' ---


@staff_router.get("/me", operation_id="get_signed_in_handler")
def me(handler: SignedIn) -> Handler:
    """The handler signed in."""
    return handler


@staff_router.get("/customers", operation_id="find_customers")
def get_customers(name: CustomerName, _: SignedIn, db: Database) -> list[CustomerMatch]:
    """Customers whose name holds the text, with their claims, ten at most."""
    return find_customers(db, name)


@staff_router.get("/claims", operation_id="list_claims")
def get_claims(_: SignedIn, db: Database) -> list[ClaimSummary]:
    """The queue, oldest submitted first, with where each claim stands."""
    return list_claims(db)


def held(db: Connection, claim_id: str, end: Status) -> Decision:
    """The held approval on a claim being moved on from waiting for sign-off."""
    if not move_claim(db, claim_id, Status.WAITING_FOR_SIGN_OFF, end):
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} isn't waiting for sign-off")
    decision = find_decision(db, claim_id)
    if decision is None or decision.decision != DecisionKind.APPROVE:
        raise HTTPException(409, f"Claim {claim_id} has no approval waiting for sign-off")
    return decision


@staff_router.post("/claims/{claim_id}/sign-off", operation_id="sign_off_claim")
def sign_off_claim(
    claim_id: ClaimId, handler: SeniorHandler, db: Database, service: AgentCalls
) -> Claim:
    """Sign off a held payout as the handler signed in, which pays it."""
    refuse_while_paused(db)
    decision = held(db, claim_id, Status.DECIDED)
    if decision.calculation is None or decision.payout != decision.calculation.payout:
        raise HTTPException(409, f"Claim {claim_id}'s payout isn't its calculation's")
    db.execute(
        update(decisions)
        .where(decisions.c.claim_id == claim_id)
        .values(
            signed_off_by=handler.name, signed_off_by_id=handler.handler_id, signed_off_at=now()
        )
    )
    record_payment(db, claim_id, decision.payout, handler.name, handler.handler_id)
    thread_id = find_claim(db, claim_id)["thread_id"]
    try:
        ask_agent(db, lambda: service.resume(claim_id, thread_id, Outcome.SIGNED_OFF))
    except AgentUnavailableError as error:
        log.warning("claim %s paid; the agent wasn't told: %s", claim_id, error)
    return claim_in_full(db, claim_id)


@staff_router.post("/claims/{claim_id}/send-back", operation_id="send_back_claim")
def send_back_claim(
    claim_id: ClaimId,
    request: SendBackRequest,
    handler: SeniorHandler,
    db: Database,
    service: AgentCalls,
) -> Claim:
    """Send a held decision back to the agent with a note, as the handler signed in; the
    agent decides again."""
    decision = held(db, claim_id, Status.SENT_BACK)
    db.execute(
        insert(sent_back).values(
            claim_id=claim_id,
            decision=decision.model_dump(mode="json"),
            note=request.note,
            sent_back_by=handler.name,
            sent_back_by_id=handler.handler_id,
            sent_back_at=now(),
        )
    )
    db.execute(delete(decisions).where(decisions.c.claim_id == claim_id))
    db.execute(delete(calculations).where(calculations.c.claim_id == claim_id))
    thread_id = find_claim(db, claim_id)["thread_id"]
    add_step(
        db,
        claim_id,
        NewStep(
            thread_id=thread_id,
            kind="sent_back",
            content=f"{handler.name}: {request.note}",
            sources=[],
        ),
    )
    move_claim(db, claim_id, Status.SENT_BACK, Status.IN_PROGRESS)
    try:
        ask_agent(db, lambda: service.resume(claim_id, thread_id, Outcome.SENT_BACK))
    except AgentUnavailableError as error:
        undo_move(db, claim_id, thread_id, Status.SENT_BACK)
        log.warning("claim %s sent back; the agent wasn't told: %s", claim_id, error)
    return claim_in_full(db, claim_id)


OVERRIDABLE = (Status.DECIDED, Status.WAITING_FOR_SIGN_OFF)


@staff_router.post("/claims/{claim_id}/override", operation_id="override_decision")
def override_decision(
    claim_id: ClaimId, request: OverrideRequest, handler: SeniorHandler, db: Database
) -> Claim:
    """Put a senior handler's own decision in place of the agent's, with a reason code. An
    approval is paid at once as the handler's sign-off; nothing already paid can change."""
    claim = find_claim(db, claim_id)
    current = find_decision(db, claim_id)
    if current is None or claim["status"] not in OVERRIDABLE:
        raise HTTPException(409, f"Claim {claim_id} has no decision to override")
    if db.execute(select(payments.c.claim_id).where(payments.c.claim_id == claim_id)).first():
        raise HTTPException(409, f"Claim {claim_id} has already been paid")
    approve = request.decision == DecisionKind.APPROVE
    if approve != (request.payout > 0):
        raise HTTPException(422, "An approval needs a payout above zero; anything else pays 0")
    if not move_claim(db, claim_id, claim["status"], Status.DECIDED):
        raise HTTPException(409, f"Claim {claim_id} changed; reload and try again")
    stamp = now()
    # The calculation stays only when the amount does; a new amount is the handler's own.
    kept = current.calculation if request.payout == current.payout else None
    override = {
        "reason_code": request.reason_code,
        "note": request.note,
        "by": handler.name,
        "by_id": handler.handler_id,
        "at": stamp,
        "previous_decision": current.decision,
        "previous_payout": current.payout,
    }
    db.execute(
        update(decisions)
        .where(decisions.c.claim_id == claim_id)
        .values(
            decision=request.decision,
            payout=request.payout,
            calculation=kept and kept.model_dump(),
            decided_by=handler.name,
            decided_at=stamp,
            override=override,
            signed_off_by=handler.name if approve else None,
            signed_off_by_id=handler.handler_id if approve else None,
            signed_off_at=stamp if approve else None,
        )
    )
    if approve:
        record_payment(db, claim_id, request.payout, handler.name, handler.handler_id)
    add_step(
        db,
        claim_id,
        NewStep(
            thread_id=claim["thread_id"],
            kind="message",
            content=f"{handler.name} overrode the decision ({request.reason_code}): {request.note}",
            sources=[],
        ),
    )
    return claim_in_full(db, claim_id)


@staff_router.post("/claims/{claim_id}/requests", operation_id="ask_customer", status_code=201)
def ask_customer(claim_id: ClaimId, request: AskRequest, handler: SignedIn, db: Database) -> Claim:
    """Ask the claim's customer for a document or a detail, as the handler signed in."""
    claim = find_claim(db, claim_id)
    if claim["source"] == EVALUATION:
        raise HTTPException(409, f"Claim {claim_id} is an evaluation's copy")
    add_requests(db, claim_id, [request.text], handler.name)
    return claim_in_full(db, claim_id)


@staff_router.get("/payouts", operation_id="get_payout_switch")
def get_payout_switch(_: SignedIn, db: Database) -> PayoutSwitch:
    """Whether payouts are paused, and who last changed it, when and why."""
    return payout_switch(db)


@staff_router.put("/payouts", operation_id="set_payout_switch")
def set_payout_switch(
    request: PayoutSwitchRequest, handler: SeniorHandler, db: Database
) -> PayoutSwitch:
    """Stop or restart every payout, with the reason. The agent keeps deciding; approvals hold."""
    switch = set_payouts(db, request.paused, request.reason, handler)
    log.warning(
        "payouts %s by handler %s", "paused" if request.paused else "resumed", handler.handler_id
    )
    return switch


@staff_router.get("/claims/{claim_id}/trace", operation_id="get_trace")
def get_trace(claim_id: ClaimId, _: SignedIn, db: Database) -> Trace:
    """Every step and model call on a claim, for the trace view."""
    return claim_trace(db, claim_id)


# --- The local sign-in stand-in ---


def check_local_password(settings: Settings, password: str) -> bool:
    """Whether the shared local password is right, compared in constant time."""
    expected = settings.handler_password.get_secret_value() if settings.handler_password else ""
    return secrets.compare_digest(password.encode(), expected.encode())


def known_email(db: Connection, email: str, people: Any) -> str | None:
    """The seeded email matching one given, ignoring case, or none."""
    found = db.execute(
        select(people.c.email).where(func.lower(people.c.email) == email.lower())
    ).scalar_one_or_none()
    return None if found is None else str(found).lower()


@staff_sign_in_router.post("/sign-in", operation_id="sign_in_staff")
def sign_in_staff(request: Request, body: SignInRequest, db: Database) -> SignIn:
    """Sign a seeded handler in with the shared local password; local only."""
    email = known_email(db, body.email, handlers)
    right = check_local_password(request.app.state.settings, body.password)
    if email is None or not right:
        raise HTTPException(401, "The email or password is wrong")
    issuer: LocalIssuer = request.app.state.staff_issuer
    return SignIn(id_token=issuer.issue(email, HANDLERS_GROUP), expires_in=TOKEN_LIFETIME)


# The only people the test buttons sign in as, on the laptop; no password reaches the browser.
STAFF_TEST_ACCOUNTS = {
    "senior": "dana.whitfield@undercover.example",
    "handler": "marcus.oyelaran@undercover.example",
}
CUSTOMER_TEST_ACCOUNTS = {"customer": "oliver.grant@example.com"}
# The red team files its attack claims as its own customer, never a test customer people use.
REDTEAM_TEST_ACCOUNTS = {"attacker": "derek.vance@example.com"}


@staff_sign_in_router.post("/test-sign-in", operation_id="test_sign_in_staff")
def test_sign_in_staff(request: Request, body: TestSignInRequest, db: Database) -> SignIn:
    """Sign in as one of the fixed staff test accounts; local only."""
    email = STAFF_TEST_ACCOUNTS.get(body.account)
    if email is None or known_email(db, email, handlers) is None:
        raise HTTPException(404, "No such test account")
    issuer: LocalIssuer = request.app.state.staff_issuer
    return SignIn(id_token=issuer.issue(email, HANDLERS_GROUP), expires_in=TOKEN_LIFETIME)


@customer_sign_in_router.post("/test-sign-in", operation_id="test_sign_in_customer")
def test_sign_in_customer(request: Request, body: TestSignInRequest, db: Database) -> SignIn:
    """Sign in as the fixed customer test account; local only."""
    email = CUSTOMER_TEST_ACCOUNTS.get(body.account)
    if email is None or known_email(db, email, customers) is None:
        raise HTTPException(404, "No such test account")
    issuer: LocalIssuer = request.app.state.customer_issuer
    return SignIn(id_token=issuer.issue(email, CUSTOMERS_GROUP), expires_in=TOKEN_LIFETIME)


@customer_sign_in_router.post("/redteam-sign-in", operation_id="redteam_sign_in_customer")
def redteam_sign_in_customer(request: Request, body: TestSignInRequest, db: Database) -> SignIn:
    """Sign in as the red team's attacker customer; local only, never offered in the portal."""
    email = REDTEAM_TEST_ACCOUNTS.get(body.account)
    if email is None or known_email(db, email, customers) is None:
        raise HTTPException(404, "No such red-team account")
    issuer: LocalIssuer = request.app.state.customer_issuer
    return SignIn(id_token=issuer.issue(email, CUSTOMERS_GROUP), expires_in=TOKEN_LIFETIME)


ENGINEERING_TEST_ACCOUNTS = {"engineer": "sam.carter@undercover.example"}


@engineering_sign_in_router.post("/sign-in", operation_id="sign_in_engineer")
def sign_in_engineer(request: Request, body: SignInRequest, db: Database) -> SignIn:
    """Sign a seeded AI engineer in with the shared local password; local only."""
    email = known_email(db, body.email, engineers)
    right = check_local_password(request.app.state.settings, body.password)
    if email is None or not right:
        raise HTTPException(401, "The email or password is wrong")
    issuer: LocalIssuer = request.app.state.engineering_issuer
    return SignIn(id_token=issuer.issue(email, ENGINEERS_GROUP), expires_in=TOKEN_LIFETIME)


@engineering_sign_in_router.post("/test-sign-in", operation_id="test_sign_in_engineer")
def test_sign_in_engineer(request: Request, body: TestSignInRequest, db: Database) -> SignIn:
    """Sign in as the fixed AI engineer test account; local only."""
    email = ENGINEERING_TEST_ACCOUNTS.get(body.account)
    if email is None or known_email(db, email, engineers) is None:
        raise HTTPException(404, "No such test account")
    issuer: LocalIssuer = request.app.state.engineering_issuer
    return SignIn(id_token=issuer.issue(email, ENGINEERS_GROUP), expires_in=TOKEN_LIFETIME)


@engineering_sign_in_router.get("/.well-known/jwks.json", operation_id="get_engineering_jwks")
def engineering_jwks(request: Request) -> dict[str, list[dict[str, Any]]]:
    """The engineering issuer's public signing keys, at the path Cognito uses."""
    issuer: LocalIssuer = request.app.state.engineering_issuer
    return issuer.jwks()


@staff_sign_in_router.get("/.well-known/jwks.json", operation_id="get_staff_jwks")
def staff_jwks(request: Request) -> dict[str, list[dict[str, Any]]]:
    """The staff issuer's public signing keys, at the path Cognito uses."""
    issuer: LocalIssuer = request.app.state.staff_issuer
    return issuer.jwks()


@customer_sign_in_router.post("/sign-in", operation_id="sign_in_customer")
def sign_in_customer(request: Request, body: SignInRequest, db: Database) -> SignIn:
    """Sign a seeded customer in with the shared local password; local only."""
    email = known_email(db, body.email, customers)
    right = check_local_password(request.app.state.settings, body.password)
    if email is None or not right:
        raise HTTPException(401, "The email or password is wrong")
    issuer: LocalIssuer = request.app.state.customer_issuer
    return SignIn(id_token=issuer.issue(email, CUSTOMERS_GROUP), expires_in=TOKEN_LIFETIME)


@customer_sign_in_router.get("/.well-known/jwks.json", operation_id="get_customer_jwks")
def customer_jwks(request: Request) -> dict[str, list[dict[str, Any]]]:
    """The customer issuer's public signing keys, at the path Cognito uses."""
    issuer: LocalIssuer = request.app.state.customer_issuer
    return issuer.jwks()


def load_names_to_redact(engine: Engine) -> None:
    """Redact every customer's name from the logs. A database not yet migrated has none."""
    try:
        with engine.connect() as db:
            redact_names(db.execute(select(customers.c.name)).scalars())
    except OperationalError, ProgrammingError:
        log.warning("no customers table yet; names will be redacted once it exists")


def create_app(
    settings: Annotated[Settings | None, "Read from the environment when not given"] = None,
    engine: Engine | None = None,
    agent_service: AgentService | None = None,
) -> FastAPI:
    """Build the api for the settings, database and agent given, or those in the environment."""
    configure_logging()
    settings = settings or get_settings()
    database = engine or make_engine(settings.database_url)
    load_names_to_redact(database)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        yield
        database.dispose()

    app = FastAPI(title="UnderCover api", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = database
    app.state.agent = agent_service or HttpAgentService(
        settings.agent_url, settings.undercover_api_key.get_secret_value()
    )
    staff = (settings.staff_token_issuer, settings.staff_token_audience)
    customer = (settings.customer_token_issuer, settings.customer_token_audience)
    engineering = (settings.engineering_token_issuer, settings.engineering_token_audience)
    if settings.local_sign_in:
        app.state.staff_issuer = LocalIssuer(*staff)
        app.state.customer_issuer = LocalIssuer(*customer)
        app.state.staff_verifier = TokenVerifier(LocalKeys(app.state.staff_issuer), *staff)
        app.state.customer_verifier = TokenVerifier(LocalKeys(app.state.customer_issuer), *customer)
        app.state.engineering_issuer = LocalIssuer(*engineering)
        app.state.engineering_verifier = TokenVerifier(
            LocalKeys(app.state.engineering_issuer), *engineering
        )
        app.include_router(staff_sign_in_router)
        app.include_router(customer_sign_in_router)
        app.include_router(engineering_sign_in_router)
        app.include_router(demo_router)
    else:
        app.state.staff_verifier = TokenVerifier(RemoteKeys(staff[0]), *staff)
        app.state.customer_verifier = TokenVerifier(RemoteKeys(customer[0]), *customer)
        app.state.engineering_verifier = TokenVerifier(RemoteKeys(engineering[0]), *engineering)
    app.middleware("http")(log_requests)
    for router in (
        health_router,
        agent_router,
        agent_receipt_router,
        staff_router,
        receipt_router,
        customer_router,
        account_router,
        *EVALUATION_ROUTERS,
        redteam_router,
        threats_router,
    ):
        app.include_router(router)
    return app
