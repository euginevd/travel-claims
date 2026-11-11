"""The one place the agent reaches Bedrock Guardrails (tier 2 design 7): customer text only,
before any model reads it, so the guardrail never sees the agent's own instructions or tool
results."""

import logging
import math
import os
from dataclasses import dataclass
from functools import cache
from typing import Any, Protocol, cast

log = logging.getLogger(__name__)

# US dollars per text unit (1,000 characters) for content filters, prompt attacks included.
PRICE_PER_TEXT_UNIT = 0.15 / 1000
# ApplyGuardrail's own limit on one request's text; a claim's words are far shorter.
MAX_CHARACTERS = 25_000


@dataclass(frozen=True)
class Verdict:
    """What the guardrail made of some text: blocked, why, and what the check cost."""

    blocked: bool
    reason: str
    cost: float


class Screen(Protocol):
    def check(self, text: str) -> Verdict: ...


class NoGuardrail:
    """No guardrail named (tier 1, or before it's checked live): everything passes."""

    def check(self, text: str) -> Verdict:  # noqa: ARG002 - the same shape as BedrockGuardrail
        return Verdict(blocked=False, reason="", cost=0.0)


class BedrockGuardrail:
    """A Bedrock guardrail applied to input text alone. Fails closed: if it can't be asked, the
    text counts as blocked, so a person looks instead of a model."""

    def __init__(
        self, guardrail_id: str, version: str, region: str | None, client: Any = None
    ) -> None:
        self._id = guardrail_id
        self._version = version
        self._client = client or bedrock_runtime(region or os.environ["AWS_REGION"])

    def check(self, text: str) -> Verdict:
        """Every part of the text, in pieces of the request limit, so none goes unscreened."""
        cost = 0.0
        for start in range(0, len(text), MAX_CHARACTERS):
            verdict = self._check_piece(text[start : start + MAX_CHARACTERS])
            cost += verdict.cost
            if verdict.blocked:
                return Verdict(blocked=True, reason=verdict.reason, cost=cost)
        return Verdict(blocked=False, reason="", cost=cost)

    def _check_piece(self, text: str) -> Verdict:
        if not text.strip():
            return Verdict(blocked=False, reason="", cost=0.0)
        cost = math.ceil(len(text) / 1000) * PRICE_PER_TEXT_UNIT
        try:
            reply = self._client.apply_guardrail(
                guardrailIdentifier=self._id,
                guardrailVersion=self._version,
                source="INPUT",
                content=[{"text": {"text": text}}],
            )
        except Exception as error:  # noqa: BLE001 - any failure fails closed, by design
            log.warning("guardrail unavailable: %s", type(error).__name__)
            return Verdict(
                blocked=True,
                reason="The guardrail couldn't check this, so a person should look at it.",
                cost=0.0,
            )
        if reply.get("action") == "GUARDRAIL_INTERVENED":
            return Verdict(blocked=True, reason=blocked_reason(reply), cost=cost)
        return Verdict(blocked=False, reason="", cost=cost)


@cache
def bedrock_runtime(region: str) -> Any:
    """One Bedrock runtime client per process and region."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    return cast(Any, boto3).client("bedrock-runtime", region_name=region)


def blocked_reason(reply: dict[str, Any]) -> str:
    """Which filters fired, in plain words, never the text itself."""
    fired: list[str] = []
    for assessment in reply.get("assessments", []):
        for found in assessment.get("contentPolicy", {}).get("filters", []):
            if found.get("action") == "BLOCKED":
                fired.append(str(found.get("type", "content")).replace("_", " ").lower())
    named = ", ".join(sorted(set(fired))) or "a content filter"
    return f"The Bedrock guardrail blocked this ({named})."


def guardrail_for(guardrail_id: str | None, version: str, region: str | None) -> Screen:
    """The guardrail the settings name, or none."""
    if not guardrail_id:
        return NoGuardrail()
    # No region given: the one the runtime sets in AWS_REGION.
    return BedrockGuardrail(guardrail_id, version, region)
