"""The api's machine token for the agent's runtime on AWS: fetched from AgentCore Identity's
vault, reused until shortly before it expires, and sent as a bearer token over HTTPS."""

import base64
import io
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import pytest

from undercover_api.agent_identity import REUSE_SECONDS, BearerRuntime, VaultToken, expiry
from undercover_api.agent_service import AgentUnavailableError, RuntimeAgentService

ARN = "arn:aws:bedrock-agentcore:ap-southeast-2:111122223333:runtime/travel_claims_agent-abc"


class FakeIdentity:
    """AgentCore Identity's stand-in: a workload token, then a fresh access token each time."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def get_workload_access_token(self, **call: Any) -> dict[str, str]:
        assert call == {"workloadName": "travel-claims-dev-api"}
        return {"workloadAccessToken": "workload"}

    def get_resource_oauth2_token(self, **call: Any) -> dict[str, str]:
        self.calls.append(call)
        return {"accessToken": f"token-{len(self.calls)}"}


def test_the_token_comes_from_the_vault_and_is_reused_until_it_nears_expiry() -> None:
    now = [0.0]
    identity = FakeIdentity()
    token = VaultToken(
        "travel-claims-dev-api", "agent-access", "undercover-agent/invoke", identity, lambda: now[0]
    )
    assert token() == "token-1"
    assert token() == "token-1"
    now[0] = REUSE_SECONDS + 1
    assert token() == "token-2"
    assert identity.calls[0] == {
        "workloadIdentityToken": "workload",
        "resourceCredentialProviderName": "agent-access",
        "scopes": ["undercover-agent/invoke"],
        "oauth2Flow": "M2M",
    }


class FakeResponse(io.BytesIO):
    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def test_the_runtime_is_called_over_https_with_the_bearer_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[urllib.request.Request] = []

    def urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        sent.append(request)
        return FakeResponse(json.dumps({"status": 202, "body": {"accepted": True}}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    RuntimeAgentService(ARN, BearerRuntime(lambda fresh=False: "token-1", 10)).work(
        "CLM-1001", "thread-1"
    )
    request = sent[0]
    assert request.full_url == (
        "https://bedrock-agentcore.ap-southeast-2.amazonaws.com/runtimes/"
        f"{urllib.parse.quote(ARN, safe='')}/invocations?qualifier=DEFAULT"
    )
    assert request.get_header("Authorization") == "Bearer token-1"
    assert len(request.get_header("X-amzn-bedrock-agentcore-runtime-session-id") or "") >= 33  # noqa: PLR2004
    assert json.loads(request.data or b"") == {  # pyright: ignore[reportArgumentType]
        "path": "/work",
        "body": {"claim_id": "CLM-1001", "thread_id": "thread-1"},
    }


def test_a_refused_token_leaves_the_agent_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", None, None)  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    with pytest.raises(AgentUnavailableError):
        RuntimeAgentService(ARN, BearerRuntime(lambda fresh=False: "bad", 10)).work(
            "CLM-1001", "thread-1"
        )


WALL = 1_000_000.0


def jwt(exp: object) -> str:
    """An unsigned JWT with this `exp`: only its expiry is read."""
    claims = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).rstrip(b"=").decode()
    return f"header.{claims}.signature"


class ExpiringIdentity(FakeIdentity):
    """A vault whose tokens end at the given wall-clock times, one per fetch."""

    def __init__(self, *ends: float) -> None:
        super().__init__()
        self._ends = list(ends)

    def get_resource_oauth2_token(self, **call: Any) -> dict[str, str]:
        self.calls.append(call)
        return {"accessToken": jwt(self._ends[len(self.calls) - 1])}


def clocked_token(identity: FakeIdentity, now: list[float]) -> VaultToken:
    return VaultToken(
        "travel-claims-dev-api",
        "agent-access",
        "undercover-agent/invoke",
        identity,
        lambda: WALL + now[0],
    )


def test_a_token_is_reused_only_until_five_minutes_before_its_exp() -> None:
    now = [0.0]
    identity = ExpiringIdentity(WALL + 20 * 60, WALL + 2 * 3600)
    token = clocked_token(identity, now)
    first = token()
    now[0] = 15 * 60 - 1
    assert token() == first
    now[0] = 15 * 60
    assert token() != first
    assert len(identity.calls) == 2  # noqa: PLR2004
    assert "forceAuthentication" not in identity.calls[1]


def test_a_long_lived_token_is_still_renewed_after_fifty_minutes() -> None:
    now = [0.0]
    identity = ExpiringIdentity(WALL + 3 * 3600, WALL + 3 * 3600)
    token = clocked_token(identity, now)
    token()
    now[0] = REUSE_SECONDS
    token()
    assert len(identity.calls) == 2  # noqa: PLR2004


def test_a_token_the_vault_holds_near_its_end_is_fetched_again_by_force() -> None:
    identity = ExpiringIdentity(WALL + 60, WALL + 3600)
    token = clocked_token(identity, [0.0])
    assert expiry(token()) == WALL + 3600
    assert identity.calls[1]["forceAuthentication"] is True


def test_an_unreadable_token_falls_back_to_fifty_minutes() -> None:
    for unreadable in ("opaque", jwt("soon"), jwt(True), "a.!!!.c", "a.bm90IGpzb24.c", "a.WzFd.c"):
        assert expiry(unreadable) is None
    now = [0.0]
    identity = FakeIdentity()
    token = clocked_token(identity, now)
    token()
    now[0] = REUSE_SECONDS - 1
    token()
    assert len(identity.calls) == 1
    now[0] = REUSE_SECONDS
    token()
    assert len(identity.calls) == 2  # noqa: PLR2004


def test_fresh_fetches_a_new_token_by_force_and_keeps_it() -> None:
    identity = FakeIdentity()
    token = clocked_token(identity, [0.0])
    assert token() == "token-1"
    assert token(fresh=True) == "token-2"
    assert identity.calls[1]["forceAuthentication"] is True
    assert token() == "token-2"


def runtime_answering(
    monkeypatch: pytest.MonkeyPatch, statuses: list[int]
) -> list[urllib.request.Request]:
    """urlopen that answers each status in turn with an error, then accepts the work."""
    sent: list[urllib.request.Request] = []

    def urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        sent.append(request)
        if len(sent) <= len(statuses):
            status = statuses[len(sent) - 1]
            raise urllib.error.HTTPError(request.full_url, status, "No", None, None)  # type: ignore[arg-type]
        return FakeResponse(json.dumps({"status": 202, "body": {"accepted": True}}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return sent


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_token_is_replaced_once_and_the_call_retried(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    sent = runtime_answering(monkeypatch, [status])
    identity = FakeIdentity()
    token = clocked_token(identity, [0.0])
    RuntimeAgentService(ARN, BearerRuntime(token, 10)).work("CLM-1001", "thread-1")
    assert [r.get_header("Authorization") for r in sent] == ["Bearer token-1", "Bearer token-2"]
    assert identity.calls[1]["forceAuthentication"] is True
    session = "X-amzn-bedrock-agentcore-runtime-session-id"
    assert sent[0].get_header(session) == sent[1].get_header(session)


def test_a_token_refused_twice_leaves_the_agent_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent = runtime_answering(monkeypatch, [401, 401, 401])
    identity = FakeIdentity()
    runtime = BearerRuntime(clocked_token(identity, [0.0]), 10)
    with pytest.raises(AgentUnavailableError):
        RuntimeAgentService(ARN, runtime).work("CLM-1001", "thread-1")
    assert len(sent) == 2  # noqa: PLR2004
    assert len(identity.calls) == 2  # noqa: PLR2004


def test_other_errors_are_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = runtime_answering(monkeypatch, [500])
    runtime = BearerRuntime(lambda fresh=False: "token-1", 10)
    with pytest.raises(AgentUnavailableError):
        RuntimeAgentService(ARN, runtime).work("CLM-1001", "thread-1")
    assert len(sent) == 1
