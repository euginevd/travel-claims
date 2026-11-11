"""The agent's machine token for the api: from the vault through its workload identity, reused
until it nears expiry, and sent instead of the key whenever it's set."""

import threading
from typing import Any

import httpx2

from undercover_agent.api_client import ApiClient
from undercover_agent.identity import REUSE_SECONDS, VaultToken, api_token

KEY = "k" * 40


class FakeIdentity:
    """AgentCore Identity's stand-in: a workload token, then a fresh access token each time."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def get_workload_access_token(self, **call: Any) -> dict[str, str]:
        assert call == {"workloadName": "travel-claims-dev-agent"}
        return {"workloadAccessToken": "workload"}

    def get_resource_oauth2_token(self, **call: Any) -> dict[str, str]:
        self.calls.append(call)
        return {"accessToken": f"token-{len(self.calls)}"}


def vault_token(identity: FakeIdentity, now: list[float]) -> VaultToken:
    return VaultToken(
        "travel-claims-dev-agent", "api-access", "undercover-api/agent", identity, lambda: now[0]
    )


def test_the_token_comes_from_the_vault_and_is_reused_until_it_nears_expiry() -> None:
    now = [0.0]
    identity = FakeIdentity()
    token = vault_token(identity, now)
    assert token() == "token-1"
    assert token() == "token-1"
    now[0] = REUSE_SECONDS + 1
    assert token() == "token-2"
    assert identity.calls[0] == {
        "workloadIdentityToken": "workload",
        "resourceCredentialProviderName": "api-access",
        "scopes": ["undercover-api/agent"],
        "oauth2Flow": "M2M",
    }


def test_threads_at_once_fetch_one_token() -> None:
    identity = FakeIdentity()
    token = vault_token(identity, [0.0])
    seen: list[str] = []
    threads = [threading.Thread(target=lambda: seen.append(token())) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert set(seen) == {"token-1"}
    assert len(identity.calls) == 1


def test_without_the_agents_identity_there_is_no_token() -> None:
    assert api_token(None, "api-access", "undercover-api/agent", None) is None
    assert api_token("travel-claims-dev-agent", None, "undercover-api/agent", None) is None


def client_seeing(headers: list[httpx2.Headers], token: Any = None) -> ApiClient:
    def answer(request: httpx2.Request) -> httpx2.Response:
        headers.append(request.headers)
        return httpx2.Response(200, json={"claim_id": "CLM-1001"})

    http = httpx2.Client(base_url="http://api", transport=httpx2.MockTransport(answer))
    return ApiClient("http://api", KEY, http, token=token)


def test_with_a_token_the_agent_sends_it_and_never_the_key() -> None:
    headers: list[httpx2.Headers] = []
    client_seeing(headers, lambda: "machine-token").claim("CLM-1001")
    assert headers[0]["Authorization"] == "Bearer machine-token"
    assert "X-API-Key" not in headers[0]


def test_without_a_token_the_agent_sends_its_key_as_before() -> None:
    headers: list[httpx2.Headers] = []
    client_seeing(headers).claim("CLM-1001")
    assert headers[0]["X-API-Key"] == KEY
    assert "Authorization" not in headers[0]


def test_on_runtime_with_the_machine_token_no_shared_key_is_needed() -> None:
    import pytest  # noqa: PLC0415
    from pydantic import ValidationError  # noqa: PLC0415

    from undercover_agent.settings import Settings  # noqa: PLC0415

    base: dict[str, Any] = {"model_provider": "bedrock", "checkpoint_table": "t"}
    aws = base | {
        "agentcore_runtime": True,
        "workload_name": "travel-claims-dev-agent",
        "api_token_provider": "api-access",
    }
    assert Settings.model_validate(aws).undercover_api_key is None
    for missing in ("agentcore_runtime", "workload_name", "api_token_provider"):
        with pytest.raises(ValidationError, match="UNDERCOVER_API_KEY"):
            Settings.model_validate({k: v for k, v in aws.items() if k != missing})
    with pytest.raises(ValidationError, match="UNDERCOVER_API_KEY"):
        Settings.model_validate(base)
    with pytest.raises(ValidationError):
        Settings.model_validate(base | {"undercover_api_key": "short"})
