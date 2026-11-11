"""Live monitoring for the AI engineers: how the agent behaves on real claims, not offline runs.
Worked out in code from the live claims' decisions, sign-offs, overrides, send-backs, model calls
and customers' feedback; never an evaluation's copy or a red-team claim. An engineer can add a
claim a handler disagreed on to the evaluation set, labelled with the handler's final decision;
the held-out set is never read or written here.
"""

import logging
from collections.abc import Iterable
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Connection, RowMapping, func, insert, select
from sqlalchemy.exc import IntegrityError

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.claims import find_claim, find_decision
from undercover_api.db import (
    claims,
    decisions,
    feedback,
    labelled_claims,
    now,
    payments,
    sent_back,
    steps,
)
from undercover_api.evaluations import COPIED, EVALUATION, costs_of
from undercover_api.models import ClaimId, Decision, DecisionKind, Status
from undercover_api.redteam import REDTEAM_CUSTOMER

log = logging.getLogger(__name__)

live_router = APIRouter(prefix="/api/engineering/live")
AGENT_MAKER = "UnderCover Agent"
FLAGGED = "Instructions found"
MOST_DISAGREEMENTS = 20
MOST_COMMENTS = 10
# A labelled claim's fields, as seeding shapes them.
CLAIM_FIELDS = ("claim_id", *COPIED)
LIVE = (claims.c.source != EVALUATION, claims.c.customer_id != REDTEAM_CUSTOMER)
Days = Annotated[int, Query(ge=1, le=90)]
# How far before the period a decision may have been made and still be reviewed in it; older
# decisions aren't read, so the page stays fast as decisions pile up.
LOOKBACK_DAYS = 90


class LiveTotals(BaseModel):
    decided: int = Field(description="Live claims whose current decision was made in the period")
    straight_through: int = Field(
        description="Of those, decided by the agent alone: approved and paid, or declined, with "
        "no sign-off, override or send-back"
    )
    straight_through_share: float | None
    reviewed: int = Field(
        description="Agent decisions a person reviewed in the period: signed off, overridden or "
        "sent back"
    )
    disagreements: int = Field(description="Of those, overridden or sent back")
    disagreement_rate: float | None = Field(description="disagreements ÷ reviewed")
    referrals: int
    hidden_instruction_flags: int
    cost_per_claim: float | None
    seconds_per_claim: float | None


class LiveDay(BaseModel):
    day: str
    decided: int = 0
    straight_through: int = 0
    reviewed: int = 0
    disagreements: int = 0
    referrals: int = 0
    hidden_instruction_flags: int = 0
    cost: float = 0.0


class Helpful(BaseModel):
    count: int
    helpful: int
    helpful_share: float | None


class Comment(BaseModel):
    """A customer's thumbs-down comment: their own words, to show as plain text only."""

    subject: str
    claim_id: str | None
    comment: str
    question: str | None
    created_at: str


class LiveFeedback(BaseModel):
    answers: Helpful
    decisions: Helpful
    comments: list[Comment]


class Disagreement(BaseModel):
    claim_id: str
    kind: Literal["override", "sent_back"]
    at: str
    by: str
    claim_type: str
    amount_claimed: float
    agent_decision: str
    agent_payout: float
    handler_decision: str | None = Field(description="None for a send-back: the agent redecides")
    handler_payout: float | None
    reason_code: str | None
    note: str
    final_decision: str | None = Field(description="The decision standing now, once decided")
    final_payout: float | None
    in_evaluation_set: bool
    can_add: bool = Field(description="Whether it can be added to the evaluation set now")


class Live(BaseModel):
    days: int
    since: str
    until: str
    totals: LiveTotals
    series: list[LiveDay]
    feedback: LiveFeedback
    disagreements: list[Disagreement]


class Added(BaseModel):
    claim_id: str
    label_set: str
    status: Literal["added", "already_added"]
    decision: str
    payout: float
    added_by: str | None
    added_at: str | None


def share(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def is_straight_through(row: RowMapping, sent_back_ids: set[str], paid: set[str]) -> bool:
    """Decided by the agent with no person involved: approved and paid, or declined."""
    if (
        not str(row["decided_by"]).startswith(AGENT_MAKER)
        or row["override"] is not None
        or row["signed_off_by"] is not None
        or row["claim_id"] in sent_back_ids
        or row["status"] != Status.DECIDED
    ):
        return False
    if row["decision"] == DecisionKind.APPROVE:
        return row["claim_id"] in paid
    return row["decision"] == DecisionKind.DECLINE


def first_steps(db: Connection, ids: list[str]) -> dict[str, str]:
    """When the agent first stepped on each claim's current attempt."""
    rows = db.execute(
        select(steps.c.claim_id, func.min(steps.c.created_at))
        .select_from(steps.join(claims, claims.c.claim_id == steps.c.claim_id))
        .where(steps.c.claim_id.in_(ids), steps.c.thread_id == claims.c.thread_id)
        .group_by(steps.c.claim_id)
    )
    return {claim_id: first for claim_id, first in rows}


def flags(db: Connection, since: str) -> list[str]:
    """When the hidden-instruction check flagged a live claim, since a day."""
    rows = db.execute(
        select(steps.c.created_at)
        .select_from(steps.join(claims, claims.c.claim_id == steps.c.claim_id))
        .where(
            *LIVE,
            steps.c.kind == "screening",
            steps.c.content.like(f"{FLAGGED}%"),
            steps.c.created_at >= since,
        )
    )
    return [str(created_at) for (created_at,) in rows]


def helpful(votes: Iterable[bool]) -> Helpful:
    found = list(votes)
    return Helpful(
        count=len(found), helpful=sum(found), helpful_share=share(sum(found), len(found))
    )


def live_feedback(db: Connection, since: str) -> LiveFeedback:
    """The period's votes, and the latest thumbs-down comments, without the customer's name."""
    rows = list(
        db.execute(
            select(feedback)
            .where(feedback.c.customer_id != REDTEAM_CUSTOMER, feedback.c.created_at >= since)
            .order_by(feedback.c.feedback_id.desc())
        ).mappings()
    )
    return LiveFeedback(
        answers=helpful(r["helpful"] for r in rows if r["subject"] == "answer"),
        decisions=helpful(r["helpful"] for r in rows if r["subject"] == "decision"),
        comments=[
            Comment.model_validate(dict(r)) for r in rows if not r["helpful"] and r["comment"]
        ][:MOST_COMMENTS],
    )


def decision_rows(db: Connection, since: str) -> list[RowMapping]:
    """Each live claim's current decision, made since a day."""
    return list(
        db.execute(
            select(
                claims.c.claim_id,
                claims.c.claim_type,
                claims.c.amount_claimed,
                claims.c.status,
                decisions.c.decision,
                decisions.c.payout,
                decisions.c.decided_by,
                decisions.c.decided_at,
                decisions.c.signed_off_by,
                decisions.c.signed_off_at,
                decisions.c.override,
            )
            .join(decisions, decisions.c.claim_id == claims.c.claim_id)
            .where(*LIVE, decisions.c.decided_at >= since)
        ).mappings()
    )


def sent_back_rows(db: Connection, since: str) -> list[RowMapping]:
    """Each decision a handler sent back on a live claim since a day, oldest first."""
    return list(
        db.execute(
            select(
                sent_back,
                claims.c.claim_type,
                claims.c.amount_claimed,
                claims.c.status,
            )
            .join(claims, claims.c.claim_id == sent_back.c.claim_id)
            .where(*LIVE, sent_back.c.sent_back_at >= since)
            .order_by(sent_back.c.sent_back_id)
        ).mappings()
    )


def was_flagged(db: Connection, claim_id: str) -> bool:
    """Whether the hidden-instruction check ever flagged the claim."""
    found = db.execute(
        select(steps.c.step_id)
        .where(
            steps.c.claim_id == claim_id,
            steps.c.kind == "screening",
            steps.c.content.like(f"{FLAGGED}%"),
        )
        .limit(1)
    ).first()
    return found is not None


def handlers_final(row: RowMapping | None, decision: Decision | None) -> bool:
    """Whether the decision standing on a claim is one a person made or signed off."""
    return (
        row is not None
        and row["status"] == Status.DECIDED
        and decision is not None
        and (decision.override is not None or decision.signed_off_by is not None)
    )


def disagreements(
    db: Connection, decided: list[RowMapping], returned: list[RowMapping]
) -> list[Disagreement]:
    """The latest claims where a handler overrode or sent back the agent, one row a claim."""
    current = {r["claim_id"]: r for r in decided}
    latest: dict[str, dict[str, Any]] = {}
    for r in returned:
        latest[r["claim_id"]] = {
            "claim_id": r["claim_id"],
            "kind": "sent_back",
            "at": r["sent_back_at"],
            "by": r["sent_back_by"],
            "claim_type": r["claim_type"],
            "amount_claimed": r["amount_claimed"],
            "agent_decision": r["decision"]["decision"],
            "agent_payout": r["decision"]["payout"],
            "handler_decision": None,
            "handler_payout": None,
            "reason_code": None,
            "note": r["note"],
        }
    for r in decided:
        override = r["override"]
        if override is None:
            continue
        earlier = latest.get(r["claim_id"])
        if earlier is not None and earlier["at"] > override["at"]:
            continue
        latest[r["claim_id"]] = {
            "claim_id": r["claim_id"],
            "kind": "override",
            "at": override["at"],
            "by": override["by"],
            "claim_type": r["claim_type"],
            "amount_claimed": r["amount_claimed"],
            "agent_decision": override["previous_decision"],
            "agent_payout": override["previous_payout"],
            "handler_decision": r["decision"],
            "handler_payout": r["payout"],
            "reason_code": override["reason_code"],
            "note": override["note"],
        }
    newest = sorted(latest.values(), key=lambda d: d["at"], reverse=True)[:MOST_DISAGREEMENTS]
    ids = [d["claim_id"] for d in newest]
    labelled = dict(
        db.execute(
            select(labelled_claims.c.claim_id, labelled_claims.c.label_set).where(
                labelled_claims.c.claim_id.in_(ids)
            )
        ).all()
    )
    found: list[Disagreement] = []
    for d in newest:
        row = current.get(d["claim_id"])
        final = row is not None and row["status"] == Status.DECIDED
        decision = find_decision(db, d["claim_id"]) if final else None
        found.append(
            Disagreement(
                **d,
                final_decision=decision.decision if decision else None,
                final_payout=decision.payout if decision else None,
                in_evaluation_set=labelled.get(d["claim_id"]) == EVALUATION,
                can_add=d["claim_id"] not in labelled
                and handlers_final(row, decision)
                and not was_flagged(db, d["claim_id"]),
            )
        )
    return found


def live(db: Connection, days: int) -> Live:
    today = datetime.now(UTC).date()
    since = (today - timedelta(days=days - 1)).isoformat()
    series = {
        (today - timedelta(days=back)).isoformat(): LiveDay(
            day=(today - timedelta(days=back)).isoformat()
        )
        for back in range(days - 1, -1, -1)
    }

    def on(stamp: str | None) -> LiveDay | None:
        """The period's day a time falls on, if any."""
        return series.get(stamp[:10]) if stamp else None

    lookback = (today - timedelta(days=days - 1 + LOOKBACK_DAYS)).isoformat()
    decided = decision_rows(db, lookback)
    returned = sent_back_rows(db, lookback)
    sent_back_ids = {r["claim_id"] for r in returned}
    in_period = [r for r in decided if on(r["decided_at"]) is not None]
    ids = [r["claim_id"] for r in in_period]
    paid = set(
        db.execute(select(payments.c.claim_id).where(payments.c.claim_id.in_(ids))).scalars()
    )
    costs = costs_of(db, ids)
    first = first_steps(db, ids)
    seconds: list[float] = []
    for r in in_period:
        day = series[r["decided_at"][:10]]
        day.decided += 1
        day.cost = round(day.cost + costs.get(r["claim_id"], 0.0), 6)
        day.referrals += r["decision"] == DecisionKind.REFER
        day.straight_through += is_straight_through(r, sent_back_ids, paid)
        own = str(r["decided_by"]).startswith(AGENT_MAKER) and r["claim_id"] not in sent_back_ids
        if own and r["claim_id"] in first:
            # The agent's own first decision: its first step to its decision.
            took = datetime.fromisoformat(r["decided_at"]) - datetime.fromisoformat(
                first[r["claim_id"]]
            )
            seconds.append(took.total_seconds())
    for r in decided:
        override = r["override"]
        day = on(override["at"]) if override else on(r["signed_off_at"])
        if day is not None:
            day.reviewed += 1
            day.disagreements += override is not None
    for r in returned:
        day = on(r["sent_back_at"])
        if day is not None:
            day.reviewed += 1
            day.disagreements += 1
    for stamp in flags(db, since):
        day = on(stamp)
        if day is not None:
            day.hidden_instruction_flags += 1
    days_found = list(series.values())
    total_decided = sum(d.decided for d in days_found)
    straight = sum(d.straight_through for d in days_found)
    reviewed = sum(d.reviewed for d in days_found)
    disagreed = sum(d.disagreements for d in days_found)
    costed = [costs[i] for i in ids if i in costs]
    return Live(
        days=days,
        since=since,
        until=today.isoformat(),
        totals=LiveTotals(
            decided=total_decided,
            straight_through=straight,
            straight_through_share=share(straight, total_decided),
            reviewed=reviewed,
            disagreements=disagreed,
            disagreement_rate=share(disagreed, reviewed),
            referrals=sum(d.referrals for d in days_found),
            hidden_instruction_flags=sum(d.hidden_instruction_flags for d in days_found),
            cost_per_claim=round(sum(costed) / len(costed), 6) if costed else None,
            seconds_per_claim=round(sum(seconds) / len(seconds), 1) if seconds else None,
        ),
        series=days_found,
        feedback=live_feedback(db, since),
        disagreements=disagreements(db, decided, returned),
    )


@live_router.get("", operation_id="get_live_monitoring")
def get_live(_: SignedInEngineer, db: Database, days: Days = 14) -> Live:
    """How the agent has behaved on live claims over the last days, today included."""
    return live(db, days)


def live_summary(db: Connection, days: int = 14) -> dict[str, object]:
    """The period's numbers only, for Wattle's explainer: no customer's or handler's words."""
    found = live(db, days)
    answers, rated = found.feedback.answers, found.feedback.decisions
    return {
        "days": found.days,
        "since": found.since,
        "until": found.until,
        "totals": found.totals.model_dump(),
        "series": [d.model_dump() for d in found.series if d.decided or d.reviewed],
        "feedback": {"answers": answers.model_dump(), "decisions": rated.model_dump()},
    }


def disagreed_on(db: Connection, claim_id: str) -> bool:
    """Whether a handler overrode or sent back the agent on the claim."""
    returned = db.execute(
        select(sent_back.c.sent_back_id).where(sent_back.c.claim_id == claim_id).limit(1)
    ).first()
    decision = find_decision(db, claim_id)
    return returned is not None or (decision is not None and decision.override is not None)


def added(row: RowMapping, status: Literal["added", "already_added"]) -> Added:
    return Added(
        claim_id=row["claim_id"],
        label_set=row["label_set"],
        status=status,
        decision=str(row["label"]["decision"]),
        payout=float(row["label"]["payout"]),
        added_by=row["added_by"],
        added_at=row["added_at"],
    )


def labelled_row(db: Connection, claim_id: str) -> RowMapping | None:
    return (
        db.execute(select(labelled_claims).where(labelled_claims.c.claim_id == claim_id))
        .mappings()
        .first()
    )


@live_router.post(
    "/disagreements/{claim_id}/add-to-evaluation", operation_id="add_disagreement_to_evaluation"
)
def add_to_evaluation(claim_id: ClaimId, engineer: SignedInEngineer, db: Database) -> Added:
    """Add a live claim a handler disagreed on to the evaluation set, labelled with the
    handler's final decision and payout, so the next whole run and the improver see it. Adding
    it again changes nothing. Never the held-out set, and never a claim the hidden-instruction
    check flagged: its text must not reach the improver."""
    claim = find_claim(db, claim_id)
    if claim["source"] == EVALUATION or claim["customer_id"] == REDTEAM_CUSTOMER:
        raise HTTPException(409, f"Claim {claim_id} isn't a live claim")
    existing = labelled_row(db, claim_id)
    if existing is not None:
        if existing["label_set"] != EVALUATION:
            raise HTTPException(409, f"Claim {claim_id} can't be added to the evaluation set")
        return added(existing, "already_added")
    if not disagreed_on(db, claim_id):
        raise HTTPException(409, f"No handler overrode or sent back claim {claim_id}")
    decision = find_decision(db, claim_id)
    if decision is None or not handlers_final(claim, decision):
        raise HTTPException(409, f"Claim {claim_id} has no handler's final decision yet")
    if was_flagged(db, claim_id):
        raise HTTPException(
            409, f"Claim {claim_id} was flagged for hidden instructions; it stays out"
        )
    label = {
        "decision": str(decision.decision),
        "payout": decision.payout,
        "reason": decision.override.note if decision.override else decision.reason,
        "calculation": [
            line.model_dump()
            for line in (decision.calculation.lines if decision.calculation else [])
        ],
    }
    # Two engineers pressing at once: the first one's row stands, and only it says "added".
    inserted = False
    with suppress(IntegrityError), db.begin_nested():
        db.execute(
            insert(labelled_claims).values(
                claim_id=claim_id,
                label_set=EVALUATION,
                tiny=False,
                claim={k: claim[k] for k in CLAIM_FIELDS},
                label=label,
                added_by=engineer.name,
                added_at=now(),
            )
        )
        inserted = True
    row = labelled_row(db, claim_id)
    if row is None or row["label_set"] != EVALUATION:
        raise HTTPException(409, f"Claim {claim_id} can't be added to the evaluation set")
    log.warning(
        "claim %s added to the evaluation set by engineer %s", claim_id, engineer.engineer_id
    )
    return added(row, "added" if inserted else "already_added")
