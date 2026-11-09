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

    POST {AGENT_URL}/dispatch {"run_id": 1, "claim_ids": [...], "concurrency": 5}
    POST {AGENT_URL}/improve  {"round_id": 1}

On AgentCore Runtime (stage 2, AGENT_RUNTIME_ARN set) the same requests go through
invoke_agent_runtime as {"path": "/work", "body": {...}, "key": "<agent's key>"}; the agent's
/invocations answers {"status": 202, "body": {...}}, so both routes share one contract.

/dispatch works an evaluation's copies, up to `concurrency` at once, starting each waiting
copy itself (/start) or carrying on one already in progress, then tells the api the run is
done (/api/agent/runs/{run_id}/finish). /improve asks the improver for a proposal, which it
posts to /api/agent/rounds/{round_id}/proposal. Both answer 202 at once, like /work.
"""

import json
import logging
import urllib.error
import urllib.request
import uuid
from enum import StrEnum
from typing import Any, Protocol, cast

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

    def dispatch(self, run_id: int, claim_ids: list[str], concurrency: int) -> None: ...

    def improve(self, round_id: int) -> None: ...

    def redteam(self) -> None: ...

    def draft(self, request: dict[str, object]) -> dict[str, object]:
        """Ask the drafting assistant for a draft claim; the api validates what comes back."""
        ...

    def letter(self, request: dict[str, object]) -> dict[str, object]:
        """Ask the assistant to draft a decision letter; the api validates what comes back."""
        ...

    def ask(self, request: dict[str, object]) -> dict[str, object]:
        """Ask the customers' assistant a question; the api validates what comes back."""
        ...

    def explain(self, request: dict[str, object]) -> dict[str, object]:
        """Ask the engineers' assistant a question; the api validates what comes back."""
        ...


class HttpAgentService:
    """The agent's service over HTTP, at its url, with the agent's key."""

    def __init__(self, url: str, key: str) -> None:
        if not url.startswith(("http://", "https://")):
            raise ValueError("The agent's address must be an http or https URL")
        self._url = url.rstrip("/")
        self._key = key

    def work(self, claim_id: str, thread_id: str) -> None:
        self._send("/work", {"claim_id": claim_id, "thread_id": thread_id})

    def resume(self, claim_id: str, thread_id: str, outcome: Outcome) -> None:
        self._send(
            "/resume", {"claim_id": claim_id, "thread_id": thread_id, "outcome": str(outcome)}
        )

    def dispatch(self, run_id: int, claim_ids: list[str], concurrency: int) -> None:
        body: dict[str, object] = {
            "run_id": run_id,
            "claim_ids": claim_ids,
            "concurrency": concurrency,
        }
        self._accepted(self._post("/dispatch", body, TIMEOUT_SECONDS))

    def improve(self, round_id: int) -> None:
        self._accepted(self._post("/improve", {"round_id": round_id}, TIMEOUT_SECONDS))

    def redteam(self) -> None:
        self._accepted(self._post("/redteam", {}, TIMEOUT_SECONDS))

    def draft(self, request: dict[str, object]) -> dict[str, object]:
        answer = self._post("/draft", request, DRAFT_TIMEOUT_SECONDS)
        if not isinstance(answer, dict):
            raise AgentRefusedError("The drafting assistant gave no draft")
        return cast(dict[str, object], answer)

    def letter(self, request: dict[str, object]) -> dict[str, object]:
        answer = self._post("/letter", request, DRAFT_TIMEOUT_SECONDS)
        if not isinstance(answer, dict):
            raise AgentRefusedError("The assistant gave no letter")
        return cast(dict[str, object], answer)

    def ask(self, request: dict[str, object]) -> dict[str, object]:
        answer = self._post("/ask", request, DRAFT_TIMEOUT_SECONDS)
        if not isinstance(answer, dict):
            raise AgentRefusedError("The assistant gave no answer")
        return cast(dict[str, object], answer)

    def explain(self, request: dict[str, object]) -> dict[str, object]:
        answer = self._post("/explain", request, DRAFT_TIMEOUT_SECONDS)
        if not isinstance(answer, dict):
            raise AgentRefusedError("The assistant gave no answer")
        return cast(dict[str, object], answer)

    def _send(self, path: str, body: dict[str, str]) -> None:
        self._accepted(self._post(path, dict(body), TIMEOUT_SECONDS))

    @staticmethod
    def _accepted(answer: object) -> None:
        if field(answer, "accepted") is not True:
            raise AgentRefusedError("The agent didn't take the work")

    def _post(self, path: str, body: dict[str, object], timeout: float) -> object:
        # nosemgrep: dynamic-urllib-use-detected - the url is our own http(s) setting
        request = urllib.request.Request(  # noqa: S310 - the url is our own setting
            f"{self._url}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": self._key},
            method="POST",
        )
        try:
            # nosemgrep: dynamic-urllib-use-detected - checked as http(s) when it was set
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raise AgentRefusedError(refusal(error)) from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise AgentUnavailableError("The agent's service isn't answering") from error


class RuntimeAgentService(HttpAgentService):
    """The same agent on AgentCore Runtime: each request starts a session of its own, and the
    session lasts while the agent says it's busy."""

    def __init__(self, arn: str, key: str, client: Any) -> None:
        if not arn.startswith("arn:"):
            raise ValueError("The agent's runtime must be an ARN")
        self._arn = arn
        self._key = key
        self._client = client

    def _post(self, path: str, body: dict[str, object], timeout: float) -> object:
        payload = json.dumps({"path": path, "body": body, "key": self._key}).encode()
        try:
            reply = self._client.invoke_agent_runtime(
                agentRuntimeArn=self._arn,
                # Runtime wants at least 33 characters; one session per request.
                runtimeSessionId=f"undercover-{uuid.uuid4().hex}",
                payload=payload,
                contentType="application/json",
                accept="application/json",
            )
            answer = json.loads(reply["response"].read() or b"{}")
        except Exception as error:  # botocore's errors share no base worth naming here
            raise AgentUnavailableError("The agent's runtime isn't answering") from error
        status = field(answer, "status")
        result = field(answer, "body")
        if isinstance(status, int) and status >= 400:  # noqa: PLR2004 - HTTP's error range
            reason = field(result, "refused") or field(result, "detail")
            raise AgentRefusedError(
                f"The agent didn't take the work: {reason}" if reason else "The agent refused"
            )
        return result


def runtime_client(timeout: float = DRAFT_TIMEOUT_SECONDS) -> Any:
    """A Bedrock AgentCore client that tries once: a retry could start the same work twice."""
    from undercover_api.aws import aws_client  # noqa: PLC0415 - only stage 2 needs it

    return aws_client("bedrock-agentcore", read_timeout=timeout)


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
