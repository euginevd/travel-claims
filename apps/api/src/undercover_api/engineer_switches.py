"""The control plane's stop buttons: an AI engineer can turn the agent off or pause payouts in an
incident, never turn either back on. Starting again stays a senior handler's call, on the
dashboard. Each stop is kept in the audit history with the engineer's name and why."""

import logging
from typing import Annotated

from fastapi import APIRouter
from pydantic import StringConstraints

from undercover_api.agent_switch import AgentSwitch, set_agent
from undercover_api.auth import Database, SignedInEngineer
from undercover_api.kill_switch import set_payouts
from undercover_api.models import Engineer, Handler, PayoutSwitch, Strict

log = logging.getLogger(__name__)

engineer_switches_router = APIRouter(prefix="/api/engineering/switches")


class StopRequest(Strict):
    """Why an engineer is stopping it, kept with their name and the time."""

    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]


def as_actor(engineer: Engineer) -> Handler:
    """The engineer as the switches record who changed them: never with sign-off rights."""
    return Handler(
        handler_id=engineer.engineer_id,
        name=engineer.name,
        role="engineer",
        email=engineer.email,
        can_approve_over_limit=False,
    )


@engineer_switches_router.post("/agent/off", operation_id="turn_agent_off_as_engineer")
def turn_agent_off(request: StopRequest, engineer: SignedInEngineer, db: Database) -> AgentSwitch:
    """Turn the agent off for the live queue: every claim waits until a senior turns it on."""
    switch = set_agent(db, as_actor(engineer), on=False, reason=request.reason)
    log.warning("agent switched off by engineer %s", engineer.engineer_id)
    return switch


@engineer_switches_router.post("/payouts/pause", operation_id="pause_payouts_as_engineer")
def pause_payouts(request: StopRequest, engineer: SignedInEngineer, db: Database) -> PayoutSwitch:
    """Pause every payout: the agent keeps deciding, and approvals hold until a senior resumes."""
    switch = set_payouts(db, True, request.reason, as_actor(engineer))
    log.warning("payouts paused by engineer %s", engineer.engineer_id)
    return switch
