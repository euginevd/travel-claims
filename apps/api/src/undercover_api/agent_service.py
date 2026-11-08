"""How the api asks the agent's service to work or resume a claim. This is the one place the
contract is defined; the agent implements it exactly.

    POST {AGENT_URL}/work    {"claim_id": "CLM-1001", "thread_id": "<uuid>"}
    POST {AGENT_URL}/resume  {"claim_id": "CLM-1001", "thread_id": "<uuid>",
                              "outcome": "signed_off" | "sent_back"}

Both send the agent's key in X-API-Key and wait at most 10 seconds. The agent answers at once
and works in the background: 202 {"accepted": true}, or 409 {"refused": "<why>"} when it
won't take the work. The api has already moved the claim (waiting -> in_progress for /work,
sent_back -> in_progress for a sent_back /resume) and committed before it asks, so the agent
never calls /start or /take for work the api handed it.
"""

import json
import logging
import urllib.error
import urllib.request
from enum import StrEnum
from typing import Protocol, cast

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10


class Outcome(StrEnum):
    """What a handler did to a held decision, which the agent resumes from."""

    SIGNED_OFF = "signed_off"
    SENT_BACK = "sent_back"


class AgentUnavailableError(Exception):
    """The agent's service couldn't be reached."""


class AgentRefusedError(AgentUnavailableError):
    """The agent's service answered but didn't take the work."""


DRAFT_TIMEOUT_SECONDS = 60


class AgentService(Protocol):
    def work(self, claim_id: str, thread_id: str) -> None: ...

    def resume(self, claim_id: str, thread_id: str, outcome: Outcome) -> None: ...

    def draft(self, request: dict[str, object]) -> dict[str, object]:
        """Ask the drafting assistant for a draft claim; the api validates what comes back."""
        ...


class HttpAgentService:
    """The agent's service over HTTP, at its url, with the agent's key."""

    def __init__(self, url: str, key: str) -> None:
        self._url = url.rstrip("/")
        self._key = key

    def work(self, claim_id: str, thread_id: str) -> None:
        self._send("/work", {"claim_id": claim_id, "thread_id": thread_id})

    def resume(self, claim_id: str, thread_id: str, outcome: Outcome) -> None:
        self._send(
            "/resume", {"claim_id": claim_id, "thread_id": thread_id, "outcome": str(outcome)}
        )

    def draft(self, request: dict[str, object]) -> dict[str, object]:
        answer = self._post("/draft", request, DRAFT_TIMEOUT_SECONDS)
        if not isinstance(answer, dict):
            raise AgentRefusedError("The drafting assistant gave no draft")
        return cast(dict[str, object], answer)

    def _send(self, path: str, body: dict[str, str]) -> None:
        answer = self._post(path, dict(body), TIMEOUT_SECONDS)
        if field(answer, "accepted") is not True:
            raise AgentRefusedError("The agent didn't take the work")

    def _post(self, path: str, body: dict[str, object], timeout: float) -> object:
        request = urllib.request.Request(  # noqa: S310 - the url is our own setting
            f"{self._url}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": self._key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raise AgentRefusedError(refusal(error)) from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise AgentUnavailableError("The agent's service isn't answering") from error


def field(answer: object, name: str) -> object:
    """One field of a JSON object the agent sent, or None for anything else it sent."""
    return cast(dict[str, object], answer).get(name) if isinstance(answer, dict) else None


def refusal(error: urllib.error.HTTPError) -> str:
    """The agent's reason for refusing, or a plain line when it gave none."""
    try:
        answer = json.loads(error.read())
    except ValueError:
        answer = None
    reason = field(answer, "refused")
    return f"The agent didn't take the work: {reason}" if reason else "The agent refused the work"
