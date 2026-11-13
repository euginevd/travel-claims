"""What a senior handler sees on Today: findings about the agent's work, counted in code from the
decisions and overrides (never written by a model, so a claim's words can't change them), and a
spot check of claims the agent paid on its own."""

import random
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import Connection, select

from undercover_api.auth import Database, SeniorHandler, SignedIn
from undercover_api.claims import add_step, find_claim
from undercover_api.db import (
    claims,
    customers,
    decisions,
    insert_if_new,
    now,
    payments,
    spot_checks,
)
from undercover_api.dispatches import EVALUATION
from undercover_api.models import ClaimId, DecisionKind, NewStep, Strict
from undercover_api.redteam import REDTEAM_CUSTOMER

insights_router = APIRouter(prefix="/api/staff")

RECENT = 40
SPOT_DAYS = 7
SPOT_SIZE = 3
WORDS = {
    "baggage": "lost bag",
    "baggage_delay": "late bag",
    "trip_delay": "trip delay",
    "trip_cancellation": "cancelled trip",
    "trip_interruption": "cut-short trip",
    "passport": "lost passport",
    "emergency_medical": "medical",
}


class Insight(BaseModel):
    headline: str
    detail: str
    claim_ids: list[str]


class SpotClaim(BaseModel):
    claim_id: str
    customer_name: str
    claim_type: str
    summary: str
    payout: float
    reason: str


class Insights(BaseModel):
    noticed: list[Insight]
    spot_checks: list[SpotClaim]
    paid_alone: int


class SpotCheckRequest(Strict):
    verdict: Literal["right", "wrong"]


def _recent(db: Connection) -> list[dict[str, Any]]:
    rows = db.execute(
        select(
            decisions.c.claim_id,
            decisions.c.decision,
            decisions.c.payout,
            decisions.c.reason,
            decisions.c.checklist,
            decisions.c.override,
            decisions.c.decided_at,
            decisions.c.signed_off_by,
            claims.c.claim_type,
            claims.c.summary,
            customers.c.name.label("customer_name"),
        )
        .join(claims, claims.c.claim_id == decisions.c.claim_id)
        .join(customers, customers.c.customer_id == claims.c.customer_id)
        .where(claims.c.source != EVALUATION, claims.c.customer_id != REDTEAM_CUSTOMER)
        .order_by(decisions.c.decided_at.desc())
        .limit(RECENT)
    ).mappings()
    return [dict(row) for row in rows]


def _agents(row: dict[str, Any]) -> DecisionKind:
    """What the agent decided, before any handler changed it."""
    override: Any = row["override"]
    if isinstance(override, dict) and override.get("previous_decision"):  # pyright: ignore[reportUnknownMemberType]
        return DecisionKind(override["previous_decision"])
    return DecisionKind(row["decision"])


def _failed(row: dict[str, Any]) -> str | None:
    checks: list[Any] = row["checklist"] or []
    for check in checks:
        found: dict[str, Any] = check if isinstance(check, dict) else {}  # pyright: ignore[reportUnknownVariableType]
        if found.get("result") == "fail":
            return str(found.get("label", "")) or None
    return None


def referral_causes(rows: list[dict[str, Any]]) -> Insight | None:
    """The check the agent's referrals most often failed."""
    referred = [r for r in rows if _agents(r) == DecisionKind.REFER]
    causes = Counter(cause for r in referred if (cause := _failed(r)))
    if not causes:
        return None
    cause, count = causes.most_common(1)[0]
    if count < 2:  # noqa: PLR2004 - one claim isn't a pattern
        return None
    return Insight(
        headline=f"{count} of the last {len(referred)} referrals failed the same check.",
        detail=f"{cause}. Fixing it where the claim starts could stop most of them.",
        claim_ids=[r["claim_id"] for r in referred if _failed(r) == cause],
    )


def handler_changes(rows: list[dict[str, Any]]) -> Insight | None:
    """The claim type where handlers most often changed the agent's decision."""
    changed = [r for r in rows if isinstance(r["override"], dict)]
    if not changed:
        return None
    kind, count = Counter(r["claim_type"] for r in changed).most_common(1)[0]
    if count < 2:  # noqa: PLR2004 - one claim isn't a pattern
        return None
    of_kind = [r for r in rows if r["claim_type"] == kind]
    picked = [r for r in changed if r["claim_type"] == kind]
    raised = sum(
        1 for r in picked if float(r["payout"]) > float(r["override"].get("previous_payout") or 0)
    )
    way = (
        "raised the payout"
        if raised * 2 > len(picked)
        else "lowered or declined it"
        if raised * 2 < len(picked)
        else "changed it both ways"
    )
    return Insight(
        headline=(
            f"Handlers changed {count} of the last {len(of_kind)} "
            f"{WORDS.get(kind, kind.replace('_', ' '))} decisions."
        ),
        detail=f"Mostly they {way}. Worth raising with the AI engineers.",
        claim_ids=[r["claim_id"] for r in picked],
    )


def agreement(rows: list[dict[str, Any]]) -> Insight | None:
    if not rows:
        return None
    kept = sum(1 for r in rows if not isinstance(r["override"], dict))
    return Insight(
        headline=f"Handlers kept {kept} of the agent's last {len(rows)} decisions.",
        detail="A handler changed the rest.",
        claim_ids=[],
    )


def paid_alone(db: Connection, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Approvals the agent paid without a person, in the last week, not yet spot-checked."""
    since = (datetime.now(UTC) - timedelta(days=SPOT_DAYS)).isoformat(timespec="seconds")
    paid = set(db.scalars(select(payments.c.claim_id)))
    checked = set(db.scalars(select(spot_checks.c.claim_id)))
    return [
        r
        for r in rows
        if r["decision"] == DecisionKind.APPROVE
        and r["override"] is None
        and r["signed_off_by"] is None
        and r["decided_at"] >= since
        and r["claim_id"] in paid
        and r["claim_id"] not in checked
    ]


@insights_router.get("/insights", operation_id="get_insights")
def get_insights(_: SignedIn, db: Database) -> Insights:
    """Findings about the agent's recent work, and today's spot check."""
    rows = _recent(db)
    found = [referral_causes(rows), handler_changes(rows), agreement(rows)]
    alone = paid_alone(db, rows)
    # The same three all day, a new three tomorrow.
    picked = random.Random(datetime.now(UTC).date().isoformat()).sample(  # noqa: S311
        alone, min(SPOT_SIZE, len(alone))
    )
    return Insights(
        noticed=[insight for insight in found if insight],
        spot_checks=[
            SpotClaim(
                claim_id=r["claim_id"],
                customer_name=r["customer_name"],
                claim_type=r["claim_type"],
                summary=r["summary"],
                payout=float(r["payout"]),
                reason=r["reason"],
            )
            for r in picked
        ],
        paid_alone=len(alone),
    )


@insights_router.post(
    "/claims/{claim_id}/spot-check", operation_id="spot_check_claim", status_code=201
)
def spot_check(
    claim_id: ClaimId, request: SpotCheckRequest, handler: SeniorHandler, db: Database
) -> SpotCheckRequest:
    """Record a senior handler's spot check of a claim the agent paid on its own."""
    claim = find_claim(db, claim_id)
    if claim["source"] == EVALUATION:
        raise HTTPException(409, f"Claim {claim_id} is an evaluation's copy")
    done = insert_if_new(
        db,
        spot_checks,
        claim_id=claim_id,
        verdict=request.verdict,
        checked_by=handler.name,
        checked_by_id=handler.handler_id,
        checked_at=now(),
    )
    if done is None:
        raise HTTPException(409, f"Claim {claim_id} has already been spot-checked")
    words = "looks right" if request.verdict == "right" else "doesn't look right"
    add_step(
        db,
        claim_id,
        NewStep(
            thread_id=claim["thread_id"],
            kind="message",
            content=f"{handler.name} spot-checked the decision: it {words}.",
            sources=[],
        ),
    )
    return request
