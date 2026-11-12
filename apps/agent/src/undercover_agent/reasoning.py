"""The one place the agent asks Automated Reasoning about an answer (decision 48): a Bedrock
guardrail whose policy holds the policy wording's rules as formal logic. It only reports, never
blocks, and the grounding check has already passed the answer, so it fails open."""

import logging
import os
from typing import Any, Literal, Protocol

from undercover_agent.guardrail import MAX_ANSWER, MAX_QUERY, bedrock_runtime

log = logging.getLogger(__name__)
Outcome = Literal["valid", "invalid", "unknown"]
# An answer that contradicts the rules, or rests on facts the rules make impossible.
CONTRADICTED = {"invalid", "impossible"}


class ReasoningCheck(Protocol):
    def check(self, question: str, answer: str) -> Outcome: ...


class NoReasoningCheck:
    """Locally, and wherever no policy is set: nothing to say."""

    def check(self, question: str, answer: str) -> Outcome:  # noqa: ARG002 - the same shape
        return "unknown"


class BedrockReasoningCheck:
    """The answer, with the question it answers, against the policy's rules."""

    def __init__(
        self, guardrail_id: str, version: str, region: str | None, client: Any = None
    ) -> None:
        self._id = guardrail_id
        self._version = version
        self._client = client or bedrock_runtime(region or os.environ["AWS_REGION"])

    def check(self, question: str, answer: str) -> Outcome:
        try:
            reply = self._client.apply_guardrail(
                guardrailIdentifier=self._id,
                guardrailVersion=self._version,
                source="OUTPUT",
                content=[
                    {"text": {"text": question[:MAX_QUERY], "qualifiers": ["query"]}},
                    {"text": {"text": answer[:MAX_ANSWER], "qualifiers": ["guard_content"]}},
                ],
            )
        except Exception as error:  # noqa: BLE001 - only reports, so it fails open
            log.warning("automated reasoning unavailable: %s", type(error).__name__)
            return "unknown"
        return outcome_of(reply)


def outcome_of(reply: dict[str, Any]) -> Outcome:
    """invalid when any finding contradicts the rules, valid when every finding is valid, and
    unknown otherwise (no finding, satisfiable, ambiguous, too complex)."""
    kinds = [
        kind
        for assessment in reply.get("assessments", [])
        for finding in assessment.get("automatedReasoningPolicy", {}).get("findings", [])
        for kind in finding
    ]
    if any(kind in CONTRADICTED for kind in kinds):
        return "invalid"
    if kinds and all(kind == "valid" for kind in kinds):
        return "valid"
    return "unknown"


def reasoning_check_for(
    guardrail_id: str | None, version: str, region: str | None
) -> ReasoningCheck:
    """The check the settings name, or none."""
    if not guardrail_id:
        return NoReasoningCheck()
    return BedrockReasoningCheck(guardrail_id, version, region)
