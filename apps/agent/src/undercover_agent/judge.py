"""The judge: grades each finished evaluation copy's explanation against the handler's, in the
background, and posts the grades to the api. The grades are shown, never used to decide. For a
comparison of models it also picks the better of two explanations of the same claim, blind to
which model wrote which and in both orders, so neither the name nor the position counts.

It keeps nothing it is sent: no step, checkpoint, memory or log holds a handler's reason. A copy
it can't grade is posted as not graded, so a run never waits on it.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.models import Judge

log = logging.getLogger(__name__)

Json = dict[str, Any]
AT_ONCE = 5
NOTE_LENGTH = 200
Short = Annotated[str, StringConstraints(max_length=500)]
Reason = Annotated[str, StringConstraints(max_length=4000)]


class Pair(BaseModel):
    """One copy's decision beside its handler's: decisions, sections and reasons only."""

    model_config = ConfigDict(extra="forbid")
    claim_id: Annotated[str, StringConstraints(pattern=r"^CLM-\d{1,10}$")]
    agent_decision: Short
    agent_payout: float = Field(ge=0, le=1_000_000)
    agent_section: Short
    agent_reason: Reason
    handler_decision: Short
    handler_payout: float = Field(ge=0, le=1_000_000)
    handler_section: Short
    handler_reason: Reason


class Side(BaseModel):
    """One model's decision and explanation, without the model's name."""

    model_config = ConfigDict(extra="forbid")
    decision: Short
    payout: float = Field(ge=0, le=1_000_000)
    section: Short
    reason: Reason


class Duel(BaseModel):
    """Two models' explanations of one claim beside the handler's."""

    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(max_length=200)]
    handler_decision: Short
    handler_payout: float = Field(ge=0, le=1_000_000)
    handler_section: Short
    handler_reason: Reason
    first: Side
    second: Side


class HeadToHeadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compare_id: int = Field(ge=1)
    duels: list[Duel] = Field(min_length=1, max_length=100)


# Each answer as points for the side shown first.
FIRST_POINTS = {"first": 1.0, "tie": 0.5, "second": 0.0}


def side_as_text(name: str, side: Side) -> str:
    return (
        f"Explanation {name}: {side.decision}, paying ${side.payout:,.2f}, citing "
        f"{side.section or '(none)'}.\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"<explanation_{name}>\n{side.reason}\n</explanation_{name}>"
    )


def duel_as_text(duel: Duel, first: Side, second: Side) -> str:
    """What the judge reads: the handler's answer, then two explanations named only by order."""
    return (
        f"Senior handler: {duel.handler_decision}, paying ${duel.handler_payout:,.2f}, citing "
        f"{duel.handler_section or '(none)'}.\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"<handler_reason>\n{duel.handler_reason}\n</handler_reason>\n\n"
        f"{side_as_text('first', first)}\n\n{side_as_text('second', second)}"
    )


class JudgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: int = Field(ge=1)
    pairs: list[Pair] = Field(min_length=1, max_length=50)


def pair_as_text(pair: Pair) -> str:
    """What the judge reads, each explanation between markers as data."""
    return (
        f"Senior handler: {pair.handler_decision}, paying ${pair.handler_payout:,.2f}, citing "
        f"{pair.handler_section or '(none)'}.\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"<handler_reason>\n{pair.handler_reason}\n</handler_reason>\n\n"
        f"Claim agent: {pair.agent_decision}, paying ${pair.agent_payout:,.2f}, citing "
        f"{pair.agent_section or '(none)'}.\n"
        # nosemgrep: raw-html-format - markers around data for the model, not HTML
        f"<agent_reason>\n{pair.agent_reason}\n</agent_reason>"
    )


class RunJudge:
    """Grades a run's pairs a few at a time on a thread of its own, then posts them."""

    def __init__(self, judge: Judge, api: ApiClient) -> None:
        self._judge = judge
        self._api = api

    def judge(self, request: JudgeRequest) -> threading.Thread:
        # The "run-" prefix keeps an AgentCore Runtime session alive while it grades.
        thread = threading.Thread(
            target=self.grade_run,
            args=(request,),
            name=f"run-{request.run_id}-judge",
            daemon=True,
        )
        thread.start()
        return thread

    def head_to_head(self, request: HeadToHeadRequest) -> threading.Thread:
        thread = threading.Thread(
            target=self.compare_all,
            args=(request,),
            name=f"run-compare-{request.compare_id}-judge",
            daemon=True,
        )
        thread.start()
        return thread

    def compare_all(self, request: HeadToHeadRequest) -> None:
        with ThreadPoolExecutor(max_workers=AT_ONCE) as pool:
            found = list(pool.map(self.prefer_both, request.duels))
        try:
            self._api.record_verdicts(request.compare_id, found)
        except ApiError as error:
            log.warning(
                "comparison %s: the verdicts weren't taken: %s", request.compare_id, error.detail
            )

    def prefer_both(self, duel: Duel) -> Json:
        """The first side's share of the two readings, each order once; a reading the model
        fails or won't answer is left out, and with neither the duel has no score."""
        points: list[float] = []
        for first, second, flipped in (
            (duel.first, duel.second, False),
            (duel.second, duel.first, True),
        ):
            try:
                found, _ = self._judge.prefer(duel_as_text(duel, first, second))
            except Exception:  # noqa: BLE001 - a failed reading only leaves this order out
                log.warning("duel %s couldn't be judged", duel.key)
                found = None
            if found is not None:
                share = FIRST_POINTS[found.better]
                points.append(1 - share if flipped else share)
        return {"key": duel.key, "a_score": sum(points) / len(points) if points else None}

    def grade_run(self, request: JudgeRequest) -> None:
        with ThreadPoolExecutor(max_workers=AT_ONCE) as pool:
            found = list(pool.map(self.grade, request.pairs))
        try:
            self._api.record_grades(request.run_id, found)
        except ApiError as error:
            log.warning("run %s: the grades weren't taken: %s", request.run_id, error.detail)

    def grade(self, pair: Pair) -> Json:
        """One copy's grade, or not graded when the model fails or won't answer."""
        cost = 0.0
        try:
            found, call = self._judge.judge(pair_as_text(pair))
            cost = call.cost
        except Exception:  # noqa: BLE001 - any model failure means this one copy isn't graded
            log.warning("copy %s couldn't be graded", pair.claim_id)
            found = None
        if found is None:
            return {
                "claim_id": pair.claim_id,
                "score": None,
                "same_grounds": None,
                "same_section": None,
                "note": "The judge couldn't grade this one.",
                "cost": round(cost, 6),
            }
        return {
            "claim_id": pair.claim_id,
            "score": found.score,
            "same_grounds": found.same_grounds,
            "same_section": found.same_section,
            "note": found.note.strip()[:NOTE_LENGTH],
            "cost": round(cost, 6),
        }
