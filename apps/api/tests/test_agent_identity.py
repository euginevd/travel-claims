"""The api's machine token for the agent's runtime on AWS: fetched from AgentCore Identity's
vault, reused until shortly before it expires, and sent as a bearer token over HTTPS."""

import io
import json
import urllib.parse
import urllib.request
from typing import Any

import pytest

from undercover_api.agent_identity import REUSE_SECONDS, BearerRuntime, VaultToken
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
    RuntimeAgentService(ARN, BearerRuntime(lambda: "token-1", 10)).work("CLM-1001", "thread-1")
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
        RuntimeAgentService(ARN, BearerRuntime(lambda: "bad", 10)).work("CLM-1001", "thread-1")
