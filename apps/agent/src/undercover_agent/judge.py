"""The judge: grades each finished evaluation copy's explanation against the handler's, in the
background, and posts the grades to the api. The grades are shown, never used to decide.

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
