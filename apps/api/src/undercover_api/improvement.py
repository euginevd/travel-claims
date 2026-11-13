"""Improvement rounds: the improver proposes a new configuration from the evaluation set's
misses, a senior handler approves or rejects it, and an approved version is kept only if it
does better on the held-out set without doing worse on any measure.

A round goes: baselining (an evaluation run and a held-out run of the current version) ->
improving (the improver is asked) -> awaiting_review -> evaluating (the candidate's held-out
run) -> kept or rolled_back; or rejected, or stopped. Its spending - the improver's calls and
its runs - stays within its limit. The improver reads only the evaluation set's misses; the
held-out labels never leave the api.
"""

import difflib
import logging
from typing import Annotated, Any

from fastapi import HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Connection, RowMapping, func, insert, select, update

from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.auth import Database, SignedInEngineer
from undercover_api.claims import find_claim
from undercover_api.db import configurations, now, rounds, setting_changes, settings
from undercover_api.evaluations import (
    CURRENT_VERSION,
    AgentCalls,
    Configuration,
    Instructions,
    LabelSet,
    Scores,
    Size,
    StartRunRequest,
    agent_eval_router,
    configuration,
    create_run,
    current_version,
    dispatch,
    need_current,
    new_id,
    run_claims,
    run_cost,
    run_row,
    set_current_version,
    staff_eval_router,
)
from undercover_api.model_registry import IMPROVER_EFFORTS, IMPROVER_MODELS, Effort, Model
from undercover_api.models import Strict
from undercover_api.redteam import start_gate

log = logging.getLogger(__name__)

SPEND_LIMIT = "round_spend_limit"
DEFAULT_SPEND_LIMIT = 2.0
# The measures a candidate must not do worse on, and must beat the baseline on at least one.
MEASURES = ("accuracy", "payout_accuracy", "straight_through")
# How far cost per claim must move to count as better or worse; time per claim is too noisy
# on a few claims to judge by.
COST_NOISE = 0.10
# How many more claims a measure must get right to count as better: one claim either way is
# within the noise of a 25-claim exam. Any claim lost still counts as worse.
BETTER_BY = 2
OPEN = ("baselining", "improving", "awaiting_review", "evaluating", "red_teaming")
# The practice run stays small; the exam is the whole held-out set, so a verdict rests on 25
# claims, not 5.
BASELINES: tuple[tuple[LabelSet, Size, str], ...] = (
    ("evaluation", "tiny", "baseline_eval_run"),
    ("held_out", "whole", "baseline_held_run"),
)
EXAM: Size = "whole"
CONCURRENCY = 5

Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class Proposal(Strict):
    instructions: Instructions
    model: Model
    effort: Effort
    reason: Reason
    cost: float = Field(ge=0, le=100, allow_inf_nan=False, description="The improver's spend")


class ReviewRequest(Strict):
    approve: bool
    reason: Reason


class Round(BaseModel):
    round_id: int
    status: str
    baseline_version: int
    candidate_version: int | None
    baseline_eval_run: int | None
    baseline_held_run: int | None
    candidate_held_run: int | None
    proposal: dict[str, Any] | None
    review: dict[str, Any] | None
    verdict: dict[str, Any] | None
    improver_cost: float
    spend_limit: float
    spent: float
    diff: str | None
    started_by: str
    started_at: str


class Miss(BaseModel):
    """One evaluation-set claim the agent got wrong, for the improver."""

    claim: dict[str, Any]
    agent_decision: str | None
    agent_payout: float | None
    agent_reason: str | None
    handler_decision: str | None
    handler_payout: float | None
    handler_reason: str | None


class Brief(BaseModel):
    """What the improver reads: the current configuration, the evaluation set's scores and its
    misses. Never anything from the held-out set."""

    configuration: Configuration
    scores: Scores
    misses: list[Miss]
    models: list[str]
    efforts: list[str]
    # Earlier rounds' proposals and whether their exam kept them, so it doesn't repeat a change
    # that failed. Only the outcome: no held-out score, reason or claim, so it can't tune itself
    # to the exam.
    history: list[dict[str, Any]] = []


def history_of(db: Connection, before: int) -> list[dict[str, Any]]:
    """The last few rounds whose candidate took its exam: what was tried, and whether it was
    kept. A round that stopped before a candidate or an exam has nothing to learn from."""
    rows = db.execute(
        select(rounds.c.round_id, rounds.c.candidate_version, rounds.c.verdict)
        .where(
            rounds.c.round_id < before,
            rounds.c.verdict.is_not(None),
            rounds.c.candidate_version.is_not(None),
        )
        .order_by(rounds.c.round_id.desc())
        .limit(10)
    ).mappings()
    found: list[dict[str, Any]] = []
    for row in rows:
        verdict = row["verdict"]
        if "candidate" not in verdict:
            continue
        tried = configuration(db, row["candidate_version"])
        found.append(
            {
                "round": row["round_id"],
                "model": tried.model,
                "effort": tried.effort,
                "change": tried.reason,
                "outcome": verdict.get("outcome", "better" if verdict.get("kept") else "worse"),
            }
        )
    return found


def spend_limit(db: Connection) -> float:
    value = db.execute(
        select(settings.c.value).where(settings.c.key == SPEND_LIMIT)
    ).scalar_one_or_none()
    return float(value) if value is not None else DEFAULT_SPEND_LIMIT


def round_row(db: Connection, round_id: int) -> RowMapping:
    row = db.execute(select(rounds).where(rounds.c.round_id == round_id)).mappings().first()
    if row is None:
        raise HTTPException(404, f"Round {round_id} not found")
    return row


def spent(db: Connection, row: RowMapping) -> float:
    runs_of = (row["baseline_eval_run"], row["baseline_held_run"], row["candidate_held_run"])
    return round(float(row["improver_cost"] or 0) + sum(run_cost(db, r) for r in runs_of), 6)


def round_of(db: Connection, row: RowMapping) -> Round:
    diff = None
    if row["candidate_version"] is not None:
        diff = configuration(db, row["candidate_version"]).diff
    return Round.model_validate(dict(row) | {"spent": spent(db, row), "diff": diff})


def update_round(db: Connection, round_id: int, **values: Any) -> None:
    db.execute(update(rounds).where(rounds.c.round_id == round_id).values(**values))


def finished(db: Connection, run_id: int | None) -> bool:
    return run_id is not None and run_row(db, run_id)["status"] == "finished"


def scores_of(db: Connection, run_id: int) -> Scores:
    return Scores.model_validate(run_row(db, run_id)["scores"])


# --- Staff ---


@staff_eval_router.get("/rounds", operation_id="list_rounds")
def list_rounds(_: SignedInEngineer, db: Database) -> list[Round]:
    """Every improvement round, newest first."""
    rows = db.execute(select(rounds).order_by(rounds.c.round_id.desc())).mappings()
    return [round_of(db, r) for r in rows]


@staff_eval_router.get("/rounds/{round_id}", operation_id="get_round")
def get_round(round_id: int, _: SignedInEngineer, db: Database) -> Round:
    return round_of(db, round_row(db, round_id))


@staff_eval_router.post("/rounds", operation_id="start_round", status_code=201)
def start_round(engineer: SignedInEngineer, db: Database, service: AgentCalls) -> Round:
    """Start a round: evaluate the current version on the evaluation and held-out sets (their
    tiny claims, in this pilot), then ask the improver."""
    return round_of(db, round_row(db, start_round_with(db, service, engineer.name)))


def start_round_with(
    db: Connection, service: AgentService, by: str, preset: dict[str, Any] | None = None
) -> int:
    """Open a round and its baseline runs; with a preset (from Compare), its model and effort
    are proposed in the improver's place once the baselines finish."""
    if db.execute(select(func.count()).where(rounds.c.status.in_(OPEN))).scalar_one():
        raise HTTPException(409, "A round is already open; finish or stop it first")
    version = need_current(db)
    round_id = new_id(
        db.execute(
            insert(rounds).values(
                status="baselining",
                baseline_version=version,
                improver_cost=0,
                spend_limit=spend_limit(db),
                started_by=by,
                started_at=now(),
                proposal=(preset | {"preset": True}) if preset else None,
            )
        )
    )
    for label_set, size, column in BASELINES:
        body = StartRunRequest(label_set=label_set, size=size, concurrency=CONCURRENCY)
        run_id, ids = create_run(db, body, version, by, round_id=round_id)
        update_round(db, round_id, **{column: run_id})
        dispatch(db, service, run_id, ids, CONCURRENCY)
    return round_id


@staff_eval_router.post("/rounds/{round_id}/review", operation_id="review_proposal")
def review_proposal(
    round_id: int,
    body: ReviewRequest,
    engineer: SignedInEngineer,
    db: Database,
    service: AgentCalls,
) -> Round:
    """Approve the improver's proposal, which is then tried on the held-out set, or reject it
    with the reason."""
    row = round_row(db, round_id)
    if row["status"] != "awaiting_review":
        raise HTTPException(409, f"Round {round_id} has no proposal waiting for review")
    review = {"approved": body.approve, "reason": body.reason, "by": engineer.name, "at": now()}
    candidate = row["candidate_version"]
    if not body.approve:
        db.execute(
            update(configurations)
            .where(configurations.c.version == candidate)
            .values(status="rejected", reviewed_by=engineer.name)
        )
        update_round(db, round_id, status="rejected", review=review)
        return round_of(db, round_row(db, round_id))
    estimate = run_cost(db, row["baseline_held_run"])
    if spent(db, row) + estimate > float(row["spend_limit"]):
        raise HTTPException(
            409,
            "Trying it would likely go over the round's spending limit of "
            f"${row['spend_limit']:.2f}",
        )
    db.execute(
        update(configurations)
        .where(configurations.c.version == candidate)
        .values(status="candidate", reviewed_by=engineer.name)
    )
    body_run = StartRunRequest(label_set="held_out", size=EXAM, concurrency=CONCURRENCY)
    run_id, ids = create_run(db, body_run, candidate, engineer.name, round_id=round_id)
    update_round(db, round_id, status="evaluating", review=review, candidate_held_run=run_id)
    dispatch(db, service, run_id, ids, CONCURRENCY)
    return round_of(db, round_row(db, round_id))


@staff_eval_router.post("/rounds/{round_id}/stop", operation_id="stop_round")
def stop_round(round_id: int, _: SignedInEngineer, db: Database) -> Round:
    """Stop an open round; the current version stays as it was."""
    row = round_row(db, round_id)
    if row["status"] not in OPEN:
        raise HTTPException(409, f"Round {round_id} isn't open")
    update_round(db, round_id, status="stopped")
    return round_of(db, round_row(db, round_id))


# --- The agent's ---


@agent_eval_router.get("/rounds/{round_id}/brief", operation_id="get_improver_brief")
def get_improver_brief(round_id: int, db: Database) -> Brief:
    """The current configuration and the evaluation set's misses, for the improver."""
    row = round_row(db, round_id)
    if row["status"] != "improving" or row["baseline_eval_run"] is None:
        raise HTTPException(409, f"Round {round_id} isn't waiting for the improver")
    eval_run = row["baseline_eval_run"]
    if run_row(db, eval_run)["label_set"] != "evaluation":
        raise HTTPException(409, "The improver reads only the evaluation set")
    found, _ = run_claims(db, eval_run)
    misses = [
        Miss(
            claim={
                k: find_claim(db, c.claim_id)[k]
                for k in ("claim_type", "summary", "story", "items", "amount_claimed", "documents")
            },
            agent_decision=c.decision,
            agent_payout=c.payout,
            agent_reason=c.reason,
            handler_decision=c.handler_decision,
            handler_payout=c.handler_payout,
            handler_reason=c.handler_reason,
        )
        for c in found
        if not c.payout_matched
    ]
    return Brief(
        configuration=configuration(db, row["baseline_version"]),
        scores=scores_of(db, eval_run),
        misses=misses,
        models=list(IMPROVER_MODELS),
        efforts=list(IMPROVER_EFFORTS),
        history=history_of(db, round_id),
    )


@agent_eval_router.post("/rounds/{round_id}/proposal", operation_id="propose_configuration")
def propose_configuration(round_id: int, body: Proposal, db: Database) -> Round:
    """The improver's proposal: a new version with its diff, waiting for a senior handler."""
    row = round_row(db, round_id)
    if row["status"] != "improving":
        raise HTTPException(409, f"Round {round_id} isn't waiting for a proposal")
    base = configuration(db, row["baseline_version"])
    version = int(db.execute(select(func.max(configurations.c.version))).scalar_one() or 0) + 1
    diff = "".join(
        difflib.unified_diff(
            [
                f"model: {base.model}\n",
                f"effort: {base.effort}\n",
                *base.instructions.splitlines(True),
            ],
            [
                f"model: {body.model}\n",
                f"effort: {body.effort}\n",
                *body.instructions.splitlines(True),
            ],
            f"version {base.version}",
            f"version {version}",
        )
    )
    db.execute(
        insert(configurations).values(
            version=version,
            instructions=body.instructions,
            model=body.model,
            effort=body.effort,
            reason=body.reason,
            diff=diff,
            status="proposed",
            parent_version=base.version,
            proposed_by="Improver",
            created_at=now(),
        )
    )
    update_round(
        db,
        round_id,
        status="awaiting_review",
        candidate_version=version,
        proposal={"reason": body.reason, "model": body.model, "effort": body.effort},
        improver_cost=float(row["improver_cost"] or 0) + body.cost,
    )
    return round_of(db, round_row(db, round_id))


@agent_eval_router.post("/rounds/{round_id}/failed", operation_id="improver_failed")
def improver_failed(round_id: int, body: ReviewRequest, db: Database) -> Round:
    """The improver couldn't propose anything; the round stops with its reason."""
    if round_row(db, round_id)["status"] == "improving":
        update_round(db, round_id, status="stopped", verdict={"kept": False, "why": body.reason})
    return round_of(db, round_row(db, round_id))


# --- Moving a round on when its runs finish ---


LABELS = {
    "accuracy": "right decision",
    "payout_accuracy": "right amount",
    "straight_through": "decided without a person",
}


def claims_changed(baseline: Scores, candidate: Scores, measure: str) -> int:
    """How many more claims the candidate got right on a measure (negative when fewer)."""
    claims = min(baseline.claims, candidate.claims) or 1
    return round((getattr(candidate, measure) - getattr(baseline, measure)) * claims)


def verdict(baseline: Scores, candidate: Scores) -> dict[str, Any]:
    """Keep the candidate only if it's no worse on every measure and clearly better on one:
    worse means any claim lost; better means BETTER_BY claims more, or cost per claim down
    beyond its noise. A difference smaller than that is no clear difference, and the current
    version stays."""
    changed = {m: claims_changed(baseline, candidate, m) for m in MEASURES}
    worse = [LABELS[m] for m, by in changed.items() if by < 0]
    better = [LABELS[m] for m, by in changed.items() if by >= BETTER_BY]
    if candidate.cost_per_claim < baseline.cost_per_claim * (1 - COST_NOISE):
        better.append("cost per claim")
    elif candidate.cost_per_claim > baseline.cost_per_claim * (1 + COST_NOISE):
        worse.append("cost per claim")
    kept = not worse and bool(better)
    outcome = "better" if kept else "worse" if worse else "unclear"
    if worse:
        why = f"Rolled back: worse on {', '.join(worse)}"
    elif not better:
        why = "No clear difference on the held-out set, so the current version stays"
    else:
        why = f"Kept: better on {', '.join(better)} and worse on none"
    return {
        "kept": kept,
        "outcome": outcome,
        "why": why,
        "changed": changed,
        "baseline": baseline.model_dump(),
        "candidate": candidate.model_dump(),
    }


def after_run(db: Connection, round_id: int, service: AgentService) -> None:
    """Move a round on now one of its runs has finished."""
    row = round_row(db, round_id)
    if row["status"] == "baselining" and all(
        finished(db, row[c]) for c in ("baseline_eval_run", "baseline_held_run")
    ):
        update_round(db, round_id, status="improving")
        preset: dict[str, Any] = row["proposal"] or {}
        if preset.get("preset"):
            # Proposed from Compare: the person's pick stands in for the improver's.
            base = configuration(db, row["baseline_version"])
            pick = Proposal(
                instructions=base.instructions,
                model=preset["model"],
                effort=preset["effort"],
                reason=preset["reason"],
                cost=0,
            )
            propose_configuration(round_id, pick, db)
            return
        db.commit()
        try:
            service.improve(round_id)
        except AgentUnavailableError as error:
            update_round(db, round_id, status="stopped", verdict={"kept": False, "why": str(error)})
            log.warning("round %s: the improver couldn't be asked: %s", round_id, error)
    elif row["status"] == "evaluating" and finished(db, row["candidate_held_run"]):
        result = verdict(
            scores_of(db, row["baseline_held_run"]), scores_of(db, row["candidate_held_run"])
        )
        if not result["kept"]:
            settle(db, row, False, result)
            return
        # Better on the held-out set: the red team attacks it before it's kept.
        result["why"] = f"{result['why']}; now facing the red team"
        update_round(db, round_id, status="red_teaming", verdict=result)
        try:
            start_gate(db, service, round_id, row["candidate_version"])
        except AgentUnavailableError as error:
            result["why"] = f"Rolled back: the red team couldn't run ({error})"
            settle(db, row, False, result)


def settle(db: Connection, row: RowMapping, kept: bool, result: dict[str, Any]) -> None:
    """Keep or roll back a round's candidate version, with the verdict."""
    status = "kept" if kept else "rolled_back"
    result["kept"] = kept
    db.execute(
        update(configurations)
        .where(configurations.c.version == row["candidate_version"])
        .values(status=status)
    )
    if kept:
        set_current_version(db, row["candidate_version"], "Improvement round")
    update_round(db, row["round_id"], status=status, verdict=result)


def finish_gate(db: Connection, round_id: int, results: list[Any]) -> None:
    """Keep the candidate only if every red-team attack held against it."""
    row = round_row(db, round_id)
    if row["status"] != "red_teaming":
        return
    held = sum(1 for r in results if r.passed)
    result = dict(row["verdict"] or {})
    result["redteam"] = {"held": held, "attacks": len(results)}
    if held == len(results):
        result["why"] = f"Kept: better on the held-out set, and all {held} red-team attacks held"
        settle(db, row, True, result)
    else:
        bypassed = len(results) - held
        result["why"] = f"Rolled back: {bypassed} of {len(results)} red-team attacks got through"
        settle(db, row, False, result)


# The routers the evaluation and round routes live on, for the app to include.
ROUTERS = (staff_eval_router, agent_eval_router)


class RollbackRequest(Strict):
    reason: Reason


@staff_eval_router.post("/configuration/{version}/restore", operation_id="restore_configuration")
def restore_configuration(
    version: int, body: RollbackRequest, engineer: SignedInEngineer, db: Database
) -> Configuration:
    """Go back to an earlier version, with the reason, on the record. Only a version that was
    kept, so one that passed its exam and the red team, and never while a round is open."""
    found = configuration(db, version)
    if found.current:
        raise HTTPException(409, f"Version {version} is already the one in use")
    if found.status != "kept":
        raise HTTPException(409, f"Version {version} was never kept, so it can't be restored")
    if db.execute(select(func.count()).where(rounds.c.status.in_(OPEN))).scalar_one():
        raise HTTPException(409, "A round is open; finish or stop it first")
    before = current_version(db)
    set_current_version(db, version, engineer.name)
    db.execute(
        insert(setting_changes).values(
            key=CURRENT_VERSION,
            value=version,
            old_value=before,
            reason=body.reason[:200],
            changed_by=engineer.name,
            changed_by_id=engineer.engineer_id,
            changed_at=now(),
        )
    )
    log.warning(
        "claim agent restored to version %s from %s by engineer %s",
        version,
        before,
        engineer.engineer_id,
    )
    return configuration(db, version)
