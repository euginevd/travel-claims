"""Compare: the same practice claims on up to three models and efforts, to pick the claim agent's
model.

Each pick becomes a `compare` configuration (the current instructions, with the pick's model and
effort), never made current and kept out of Versions. Its runs are ordinary practice runs, worked
one after another as each finishes, so scores, run pages, the judge and the spending limits work
as they do for any run. What the page shows (each model's scores and spread, the one-line
answer, the claims decided differently) is worked out here in code from those runs. Propose
hands a pick to an improvement round in the improver's place: a person approves it and the exam
decides."""

import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import Connection, func, insert, select, update

from undercover_api.agent_service import AgentService, AgentUnavailableError
from undercover_api.assurance import wilson
from undercover_api.auth import Database, SignedInEngineer
from undercover_api.business_settings import accuracy_objective, straight_through_objective
from undercover_api.db import claims, comparisons, configurations, model_calls, now, runs, steps
from undercover_api.evaluations import (
    AgentCalls,
    Run,
    RunClaim,
    StartRunRequest,
    configuration,
    create_run,
    current_version,
    dispatch,
    need_current,
    new_id,
    run_claims,
    run_of,
    run_row,
)
from undercover_api.model_registry import BY_ID, EFFORTS, MODELS_INFO, Effort, Model, label_of
from undercover_api.model_registry import offered as offered_of
from undercover_api.models import Strict

log = logging.getLogger(__name__)
compare_router = APIRouter(prefix="/api/engineering/compare")

COMPARE = "compare"
CONCURRENCY = 5
# A practice claim's tokens when no run has been worked yet, for the estimate.
TOKENS_IN, TOKENS_OUT = 40_000, 2_500


class ModelChoice(BaseModel):
    id: str
    label: str
    input_price: float
    output_price: float
    efforts: list[str]
    default_effort: str
    speed: str
    good_for: str
    may_decline: bool
    offered: bool
    in_use: bool
    in_use_effort: str | None
    cost_per_claim: float = Field(description="Estimated, from the last practice run's tokens")


class Pick(Strict):
    model: Model
    effort: Effort


class CompareRequest(Strict):
    picks: list[Pick] = Field(min_length=1, max_length=3)
    size: Literal["tiny", "whole"]
    repeats: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def different(self) -> CompareRequest:
        if len({(p.model, p.effort) for p in self.picks}) != len(self.picks):
            raise ValueError("Pick each model and effort once")
        return self


class ProposeRequest(Strict):
    model: Model
    effort: Effort
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class Result(BaseModel):
    model: str
    label: str
    effort: str
    version: int
    in_use: bool
    runs: list[int]
    finished: int
    planned: int
    claims: int
    accuracy: float | None
    low: float | None
    high: float | None
    by_run: list[float]
    payout_accuracy: float | None
    straight_through: float | None
    declined: int
    grade: float | None
    cost_per_claim: float | None
    seconds_per_claim: float | None
    tokens_per_claim: int | None
    passes: bool | None


class Mark(BaseModel):
    model: str
    decision: str | None
    payout: float | None
    right: bool


class Difference(BaseModel):
    claim_id: str
    claim_type: str
    handler_decision: str | None
    handler_payout: float | None
    marks: list[Mark]


class Comparison(BaseModel):
    compare_id: int
    size: str
    repeats: int
    status: str
    started_by: str
    started_at: str
    accuracy_target: float
    straight_through_target: float
    results: list[Result]
    answer: str | None
    cheapest_pass: str | None
    differences: list[Difference]
    compared_claims: int


# --- Models ---


def tokens_per_claim(db: Connection) -> tuple[float, float]:
    """The input and output tokens a practice claim took on the last finished run."""
    last = db.execute(
        select(runs.c.run_id)
        .where(runs.c.status == "finished", runs.c.label_set == "evaluation")
        .order_by(runs.c.run_id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last is None:
        return TOKENS_IN, TOKENS_OUT
    row = db.execute(
        select(
            func.sum(model_calls.c.input_tokens),
            func.sum(model_calls.c.output_tokens),
            func.count(func.distinct(claims.c.claim_id)),
        )
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(claims.c.run_id == last)
    ).one()
    tokens_in, tokens_out, copies = row
    if not copies:
        return TOKENS_IN, TOKENS_OUT
    return float(tokens_in or 0) / int(copies), float(tokens_out or 0) / int(copies)


def offered(request: Request) -> set[str]:
    return offered_of(request.app.state.settings.offered_models)


@compare_router.get("/models", operation_id="list_compare_models")
def list_models(request: Request, _: SignedInEngineer, db: Database) -> list[ModelChoice]:
    """Every model Compare can try, with its prices, efforts and an estimate a claim."""
    can = offered(request)
    current = current_version(db)
    in_use = configuration(db, current) if current is not None else None
    tokens_in, tokens_out = tokens_per_claim(db)
    return [
        ModelChoice(
            id=info.id,
            label=info.label,
            input_price=info.input_price,
            output_price=info.output_price,
            efforts=list(EFFORTS),
            default_effort=info.default_effort,
            speed=info.speed,
            good_for=info.good_for,
            may_decline=info.may_decline,
            offered=info.id in can,
            in_use=in_use is not None and in_use.model == info.id,
            in_use_effort=in_use.effort if in_use and in_use.model == info.id else None,
            cost_per_claim=round(
                (tokens_in * info.input_price + tokens_out * info.output_price) / 1_000_000, 6
            ),
        )
        for info in MODELS_INFO
    ]


# --- Starting and moving on ---


def compare_version(db: Connection, base: int, pick: Pick, by: str) -> int:
    """The `compare` configuration for a pick on the current instructions, made once."""
    instructions = configuration(db, base).instructions
    found = db.execute(
        select(configurations.c.version).where(
            configurations.c.status == COMPARE,
            configurations.c.model == pick.model,
            configurations.c.effort == pick.effort,
            configurations.c.instructions == instructions,
        )
    ).scalar()
    if found is not None:
        return int(found)
    version = int(db.execute(select(func.max(configurations.c.version))).scalar_one() or 0) + 1
    db.execute(
        insert(configurations).values(
            version=version,
            instructions=instructions,
            model=pick.model,
            effort=pick.effort,
            reason=f"Compare: {label_of(pick.model)}, {pick.effort} effort",
            diff="",
            status=COMPARE,
            parent_version=base,
            proposed_by=by,
            created_at=now(),
        )
    )
    return version


def start_next(db: Connection, service: AgentService, compare_id: int) -> None:
    """Start the comparison's next planned run, or mark it finished when none is left."""
    row = db.execute(select(comparisons).where(comparisons.c.compare_id == compare_id)).mappings()
    found = row.one()
    plan: list[dict[str, Any]] = [dict(item) for item in found["plan"]]
    waiting = next((item for item in plan if item.get("run_id") is None), None)
    if waiting is None:
        db.execute(
            update(comparisons)
            .where(comparisons.c.compare_id == compare_id)
            .values(status="finished")
        )
        return
    body = StartRunRequest(label_set="evaluation", size=found["size"], concurrency=CONCURRENCY)
    run_id, ids = create_run(db, body, int(waiting["version"]), found["started_by"])
    waiting["run_id"] = run_id
    db.execute(update(comparisons).where(comparisons.c.compare_id == compare_id).values(plan=plan))
    dispatch(db, service, run_id, ids, CONCURRENCY)


def after_run(db: Connection, run_id: int, service: AgentService) -> None:
    """A run finished: if it was a comparison's, start that comparison's next one."""
    for row in db.execute(
        select(comparisons.c.compare_id, comparisons.c.plan).where(
            comparisons.c.status == "running"
        )
    ).mappings():
        if any(item.get("run_id") == run_id for item in row["plan"]):
            try:
                start_next(db, service, int(row["compare_id"]))
            except (AgentUnavailableError, HTTPException) as error:
                db.rollback()
                stop(db, int(row["compare_id"]))
                log.warning("comparison %s stopped: %s", row["compare_id"], error)
            return


def stop(db: Connection, compare_id: int) -> None:
    db.execute(
        update(comparisons).where(comparisons.c.compare_id == compare_id).values(status="stopped")
    )
    db.commit()


@compare_router.post("", operation_id="start_comparison", status_code=201)
def start(
    body: CompareRequest,
    request: Request,
    engineer: SignedInEngineer,
    db: Database,
    service: AgentCalls,
) -> Comparison:
    """Compare up to three models and efforts on the same practice claims, each run the times
    asked, one run after another."""
    can = offered(request)
    for pick in body.picks:
        if pick.model not in can:
            raise HTTPException(409, f"{label_of(pick.model)} isn't offered in this region")
    if db.execute(
        select(comparisons.c.compare_id).where(comparisons.c.status == "running")
    ).first():
        raise HTTPException(409, "A comparison is running: wait for it, or stop it")
    base = need_current(db)
    versions = [compare_version(db, base, pick, engineer.name) for pick in body.picks]
    plan = [
        {"model": pick.model, "effort": pick.effort, "version": version, "run_id": None}
        for _ in range(body.repeats)
        for pick, version in zip(body.picks, versions, strict=True)
    ]
    compare_id = new_id(
        db.execute(
            insert(comparisons).values(
                size=body.size,
                repeats=body.repeats,
                plan=plan,
                status="running",
                started_by=engineer.name,
                started_at=now(),
            )
        )
    )
    start_next(db, service, compare_id)
    return comparison_of(db, compare_id)


@compare_router.post("/{compare_id}/stop", operation_id="stop_comparison")
def stop_comparison(compare_id: int, _: SignedInEngineer, db: Database) -> Comparison:
    """Stop a comparison: the run in progress finishes, and no more start."""
    stop(db, compare_id)
    return comparison_of(db, compare_id)


@compare_router.post("/propose", operation_id="propose_compared", status_code=201)
def propose(
    body: ProposeRequest, engineer: SignedInEngineer, db: Database, service: AgentCalls
) -> dict[str, int]:
    """Hand a compared model to an improvement round, in the improver's place: the round
    baselines the current version, then waits for a person's review, then the exam decides."""
    from undercover_api.improvement import start_round_with  # noqa: PLC0415 - imports this

    reason = body.reason or f"Compared: {label_of(body.model)} at {body.effort} effort"
    round_id = start_round_with(
        db, service, engineer.name, {"model": body.model, "effort": body.effort, "reason": reason}
    )
    return {"round_id": round_id}


# --- Reading ---


def declined_in(db: Connection, run_id: int) -> int:
    return int(
        db.execute(
            select(func.count(func.distinct(steps.c.claim_id)))
            .select_from(steps.join(claims, claims.c.claim_id == steps.c.claim_id))
            .where(claims.c.run_id == run_id, steps.c.kind == "refusal")
        ).scalar_one()
    )


def tokens_in_run(db: Connection, run_id: int) -> int:
    total = db.execute(
        select(func.sum(model_calls.c.input_tokens + model_calls.c.output_tokens))
        .select_from(model_calls.join(claims, claims.c.claim_id == model_calls.c.claim_id))
        .where(claims.c.run_id == run_id)
    ).scalar_one_or_none()
    return int(total or 0)


def mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def result_of(
    db: Connection, items: list[dict[str, Any]], current: int | None, targets: tuple[float, float]
) -> Result:
    first = items[0]
    finished_runs: list[Run] = []
    for item in items:
        if item.get("run_id") is None:
            continue
        run = run_of(db, run_row(db, int(item["run_id"])))
        if run.status == "finished" and run.scores is not None:
            finished_runs.append(run)
    by_run = [run.scores.accuracy for run in finished_runs if run.scores]
    claims_seen = sum(run.scores.claims for run in finished_runs if run.scores)
    accuracy = mean(by_run)
    low_high = wilson(accuracy, claims_seen) if accuracy is not None and claims_seen else None
    straight = mean([run.scores.straight_through for run in finished_runs if run.scores])
    grades = [run.scores.grade for run in finished_runs if run.scores and run.scores.grade]
    tokens = sum(tokens_in_run(db, run.run_id) for run in finished_runs)
    current_model = configuration(db, current) if current is not None else None
    passes = (
        None
        if accuracy is None or straight is None
        else accuracy >= targets[0] - 1e-9 and straight >= targets[1] - 1e-9
    )
    return Result(
        model=first["model"],
        label=label_of(first["model"]),
        effort=first["effort"],
        version=int(first["version"]),
        in_use=current_model is not None
        and current_model.model == first["model"]
        and current_model.effort == first["effort"],
        runs=[int(item["run_id"]) for item in items if item.get("run_id") is not None],
        finished=len(finished_runs),
        planned=len(items),
        claims=claims_seen,
        accuracy=accuracy,
        low=round(low_high[0], 4) if low_high else None,
        high=round(low_high[1], 4) if low_high else None,
        by_run=by_run,
        payout_accuracy=mean([run.scores.payout_accuracy for run in finished_runs if run.scores]),
        straight_through=straight,
        declined=sum(declined_in(db, run.run_id) for run in finished_runs),
        grade=mean(grades),
        cost_per_claim=mean([run.scores.cost_per_claim for run in finished_runs if run.scores]),
        seconds_per_claim=mean(
            [run.scores.seconds_per_claim for run in finished_runs if run.scores]
        ),
        tokens_per_claim=round(tokens / claims_seen) if claims_seen else None,
        passes=passes,
    )


def name_of(result: Result) -> str:
    return f"{result.label} at {result.effort}"


def answer_of(results: list[Result]) -> tuple[str | None, str | None]:
    """The one line: the cheapest pick that meets the targets, and whether a dearer one is
    clearly better (its likely range above the cheapest's) or the ranges overlap."""
    done = [r for r in results if r.accuracy is not None and r.cost_per_claim is not None]
    if not done:
        return None, None
    passing = [r for r in done if r.passes]
    if not passing:
        best = max(done, key=lambda r: r.accuracy or 0)
        return f"None meets the targets yet; the best is {name_of(best)}.", None
    cheapest = min(passing, key=lambda r: r.cost_per_claim or 0)
    better = [
        r for r in done if r is not cheapest and r.low is not None and r.low > (cheapest.high or 1)
    ]
    if better:
        top = max(better, key=lambda r: r.accuracy or 0)
        return (
            f"{name_of(top)} is clearly better than {name_of(cheapest)}, "
            "the cheapest that meets the targets.",
            cheapest.model + ":" + cheapest.effort,
        )
    if len(done) == 1:
        return f"{name_of(cheapest)} meets the targets.", cheapest.model + ":" + cheapest.effort
    return (
        f"{name_of(cheapest)} is enough: it meets the targets for the least, "
        "and the others' ranges overlap it.",
        cheapest.model + ":" + cheapest.effort,
    )


def differences_of(
    db: Connection, groups: list[list[dict[str, Any]]]
) -> tuple[list[Difference], int]:
    """Each claim a pick got wrong, beside the handler's answer and every pick's, from each
    pick's first finished run."""
    firsts: list[tuple[str, dict[str, RunClaim]]] = []
    for items in groups:
        for item in items:
            run_id = item.get("run_id")
            if run_id is not None and run_row(db, int(run_id))["status"] == "finished":
                found, _ = run_claims(db, int(run_id))
                firsts.append(
                    (label_of(items[0]["model"]), {c.original_claim_id: c for c in found})
                )
                break
    if not firsts:
        return [], 0
    originals: list[str] = sorted({key for _, by_claim in firsts for key in by_claim})
    found_rows: list[Difference] = []
    for original in originals:
        seen = [(label, by_claim.get(original)) for label, by_claim in firsts]
        copies = [c for _, c in seen if c is not None]
        if not copies or all(c.payout_matched for c in copies):
            continue
        sample = copies[0]
        found_rows.append(
            Difference(
                claim_id=original,
                claim_type=sample.claim_type,
                handler_decision=sample.handler_decision,
                handler_payout=sample.handler_payout,
                marks=[
                    Mark(
                        model=label,
                        decision=c.decision if c else None,
                        payout=c.payout if c else None,
                        right=bool(c and c.payout_matched),
                    )
                    for label, c in seen
                ],
            )
        )
    return found_rows, len(originals)


def comparison_of(db: Connection, compare_id: int) -> Comparison:
    row = (
        db.execute(select(comparisons).where(comparisons.c.compare_id == compare_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, f"Comparison {compare_id} not found")
    targets = (accuracy_objective(db), straight_through_objective(db))
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in row["plan"]:
        groups.setdefault((item["model"], item["effort"]), []).append(dict(item))
    current = current_version(db)
    results = [result_of(db, items, current, targets) for items in groups.values()]
    answer, cheapest = answer_of(results)
    differences, compared = differences_of(db, list(groups.values()))
    return Comparison(
        compare_id=compare_id,
        size=row["size"],
        repeats=row["repeats"],
        status=row["status"],
        started_by=row["started_by"],
        started_at=row["started_at"],
        accuracy_target=targets[0],
        straight_through_target=targets[1],
        results=results,
        answer=answer,
        cheapest_pass=cheapest,
        differences=differences,
        compared_claims=compared,
    )


@compare_router.get("/latest", operation_id="latest_comparison")
def latest(_: SignedInEngineer, db: Database) -> Comparison | None:
    """The newest comparison with its results so far, or none yet."""
    found = db.execute(
        select(comparisons.c.compare_id).order_by(comparisons.c.compare_id.desc()).limit(1)
    ).scalar_one_or_none()
    return comparison_of(db, int(found)) if found is not None else None


@compare_router.get("/{compare_id}", operation_id="get_comparison")
def get(compare_id: int, _: SignedInEngineer, db: Database) -> Comparison:
    return comparison_of(db, compare_id)


__all__ = ["BY_ID", "after_run", "compare_router"]
