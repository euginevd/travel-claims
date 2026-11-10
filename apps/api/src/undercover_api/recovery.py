"""Noticing a claim the agent stopped working, and carrying it on from where it stopped.

While the agent works a claim it sends a heartbeat every few seconds; a claim in progress with
no heartbeat for STALLED_AFTER is stalled. A handler can retry it, and the agent carries its own
stalled claims on, twice at most each. Taking a stalled claim is a compare-and-set on its
heartbeat, so two retries at once start the work once.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Connection, select, update

from undercover_api.auth import Database, SignedIn, require_agent
from undercover_api.claims import add_step, claim_in_full, find_claim, is_stalled, move_claim
from undercover_api.db import claims, now
from undercover_api.evaluations import EVALUATION, version_for_attempt
from undercover_api.models import (
    Claim,
    ClaimId,
    HeartbeatRequest,
    NewStep,
    StalledClaim,
    Status,
)

# How often the agent may carry a stalled claim on by itself; after that it waits for a handler.
AUTOMATIC_RECOVERIES = 2

AGENT = [Depends(require_agent)]
agent_claim_router = APIRouter(prefix="/api/agent/claims/{claim_id}", dependencies=AGENT)
agent_recovery_router = APIRouter(prefix="/api/agent", dependencies=AGENT)
# Local only: puts a claim in the state a crashed agent leaves, for the browser tests.
dev_router = APIRouter(prefix="/api/staff/dev")


@dataclass(frozen=True)
class Recovery:
    """A stalled claim taken for carrying on: its thread, and its heartbeat before and after."""

    thread_id: str
    before: str | None
    after: str


def take_stalled(db: Connection, claim_id: str, cap: int | None = None) -> Recovery:
    """Take a stalled claim for carrying on, once, or refuse with a 409."""
    claim = find_claim(db, claim_id)
    if not is_stalled(claim["status"], claim["heartbeat_at"]) or claim["thread_id"] is None:
        raise HTTPException(409, f"Claim {claim_id} isn't stalled")
    if cap is not None and claim["recoveries"] >= cap:
        raise HTTPException(
            409, f"Claim {claim_id} has been carried on {cap} times; it needs a handler"
        )
    before = claim["heartbeat_at"]
    after = now()
    same = claims.c.heartbeat_at.is_(None) if before is None else claims.c.heartbeat_at == before
    taken = db.execute(
        update(claims)
        .where(claims.c.claim_id == claim_id, claims.c.status == Status.IN_PROGRESS, same)
        .values(heartbeat_at=after, recoveries=claims.c.recoveries + 1)
    )
    if taken.rowcount != 1:
        raise HTTPException(409, f"Claim {claim_id} is already being carried on")
    return Recovery(claim["thread_id"], before, after)


def give_back(db: Connection, claim_id: str, recovery: Recovery) -> None:
    """Leave a claim stalled again when the agent couldn't take it, if nothing moved it since."""
    db.execute(
        update(claims)
        .where(claims.c.claim_id == claim_id, claims.c.heartbeat_at == recovery.after)
        .values(heartbeat_at=recovery.before, recoveries=claims.c.recoveries - 1)
    )
    db.commit()


def note_recovery(db: Connection, claim_id: str, recovery: Recovery, by: str) -> None:
    add_step(
        db,
        claim_id,
        NewStep(
            thread_id=recovery.thread_id,
            kind="message",
            content=f"{by} carried the claim on after the agent stopped working it.",
            sources=[],
        ),
    )


@agent_claim_router.post("/heartbeat", operation_id="record_heartbeat")
def record_heartbeat(claim_id: ClaimId, request: HeartbeatRequest, db: Database) -> dict[str, str]:
    """Say the agent is still working the claim on this thread; a beat from an old attempt is
    refused."""
    beat = db.execute(
        update(claims)
        .where(
            claims.c.claim_id == claim_id,
            claims.c.status == Status.IN_PROGRESS,
            claims.c.thread_id == request.thread_id,
        )
        .values(heartbeat_at=now())
    )
    if beat.rowcount != 1:
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} isn't in progress on that thread")
    return {"recorded": "heartbeat"}


@agent_claim_router.post("/recover", operation_id="recover_claim")
def recover_claim(claim_id: ClaimId, db: Database) -> Claim:
    """Take one of the agent's stalled claims to carry it on, up to AUTOMATIC_RECOVERIES."""
    recovery = take_stalled(db, claim_id, cap=AUTOMATIC_RECOVERIES)
    note_recovery(db, claim_id, recovery, "The agent")
    return claim_in_full(db, claim_id)


@agent_recovery_router.get("/stalled-claims", operation_id="list_stalled_claims")
def list_stalled_claims(db: Database) -> list[StalledClaim]:
    """Stalled claims the agent may still carry on by itself; never an evaluation's copies,
    which their run carries on."""
    rows = db.execute(
        select(claims.c.claim_id, claims.c.status, claims.c.heartbeat_at).where(
            claims.c.status == Status.IN_PROGRESS,
            claims.c.source != EVALUATION,
            claims.c.recoveries < AUTOMATIC_RECOVERIES,
        )
    ).all()
    return [StalledClaim(claim_id=c) for c, s, h in rows if is_stalled(s, h)]


@dev_router.post("/claims/{claim_id}/stall", operation_id="stall_claim")
def stall_claim(claim_id: ClaimId, _: SignedIn, db: Database) -> Claim:
    """Move a waiting claim into progress with a heartbeat long gone, as a crashed agent leaves
    it; local only."""
    gone = datetime.now(UTC) - timedelta(minutes=10)
    if not move_claim(
        db,
        claim_id,
        Status.WAITING,
        Status.IN_PROGRESS,
        thread_id=uuid.uuid4().hex,
        attempts=claims.c.attempts + 1,
        config_version=version_for_attempt(db, claim_id),
        heartbeat_at=gone.isoformat(timespec="seconds"),
    ):
        find_claim(db, claim_id)
        raise HTTPException(409, f"Claim {claim_id} isn't waiting")
    return claim_in_full(db, claim_id)
