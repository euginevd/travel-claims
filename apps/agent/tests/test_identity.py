"""The agent's machine token for the api: from the vault through its workload identity, reused
until it nears expiry, and sent instead of the key whenever it's set."""

import base64
import json
import threading
from typing import Any

import httpx2
import pytest

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.identity import REUSE_SECONDS, VaultToken, api_token, expiry

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
    client_seeing(headers, lambda fresh=False: "machine-token").claim("CLM-1001")
    assert headers[0]["Authorization"] == "Bearer machine-token"
    assert "X-API-Key" not in headers[0]


def test_without_a_token_the_agent_sends_its_key_as_before() -> None:
    headers: list[httpx2.Headers] = []
    client_seeing(headers).claim("CLM-1001")
    assert headers[0]["X-API-Key"] == KEY
    assert "Authorization" not in headers[0]


def test_on_runtime_with_the_machine_token_no_shared_key_is_needed() -> None:
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
        "travel-claims-dev-agent",
        "api-access",
        "undercover-api/agent",
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


def client_answering(statuses: list[int], identity: FakeIdentity) -> tuple[ApiClient, list[str]]:
    """A client whose api answers each status in turn, then 200, recording the tokens it saw."""
    seen: list[str] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        seen.append(request.headers["Authorization"])
        if len(seen) <= len(statuses):
            return httpx2.Response(statuses[len(seen) - 1], json={"detail": "Not this token"})
        return httpx2.Response(200, json={"claim_id": "CLM-1001"})

    http = httpx2.Client(base_url="http://api", transport=httpx2.MockTransport(answer))
    return ApiClient("http://api", KEY, http, token=clocked_token(identity, [0.0])), seen


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_token_is_replaced_once_and_the_call_retried(status: int) -> None:
    identity = FakeIdentity()
    client, seen = client_answering([status], identity)
    assert client.record_decision("CLM-1001", {}) == {"claim_id": "CLM-1001"}
    assert seen == ["Bearer token-1", "Bearer token-2"]
    assert identity.calls[1]["forceAuthentication"] is True


def test_a_token_refused_twice_surfaces_the_refusal() -> None:
    identity = FakeIdentity()
    client, seen = client_answering([401, 401, 401], identity)
    with pytest.raises(ApiError) as refused:
        client.claim("CLM-1001")
    assert refused.value.status == 401  # noqa: PLR2004
    assert len(seen) == 2  # noqa: PLR2004


def test_other_errors_are_not_retried() -> None:
    client, seen = client_answering([409], FakeIdentity())
    with pytest.raises(ApiError):
        client.pay("CLM-1001", 10.0)
    assert len(seen) == 1


def test_with_the_key_a_refusal_is_not_retried() -> None:
    sent: list[httpx2.Request] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return httpx2.Response(401, json={"detail": "Not this key"})

    http = httpx2.Client(base_url="http://api", transport=httpx2.MockTransport(answer))
    with pytest.raises(ApiError):
        ApiClient("http://api", KEY, http).claim("CLM-1001")
    assert len(sent) == 1


class BrokenVault(FakeIdentity):
    def get_workload_access_token(self, **call: Any) -> dict[str, str]:
        raise ConnectionError("The vault isn't answering")


def test_a_vault_that_fails_is_an_api_error_so_startup_carries_on() -> None:
    sent: list[httpx2.Request] = []
    http = httpx2.Client(base_url="http://api", transport=httpx2.MockTransport(sent.append))  # type: ignore[arg-type]
    client = ApiClient("http://api", KEY, http, token=clocked_token(BrokenVault(), [0.0]))
    with pytest.raises(ApiError) as failed:
        client.register_configuration({"instructions": "x"})
    assert failed.value.status == 503  # noqa: PLR2004
    assert not sent
