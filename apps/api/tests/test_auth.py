"""Who may call what: the agent's key, a handler's token, and nothing else."""

import base64
import json
import time
from typing import Any

import jwt
import pytest
from api_helpers import AGENT, AGENT_KEY, PASSWORD
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

Route = tuple[str, str, dict[str, Any] | None]

AGENT_ROUTES: list[Route] = [
    ("post", "/api/agent/claims/CLM-1001/start", {"thread_id": "t"}),
    ("post", "/api/agent/claims/CLM-1001/take", None),
    ("get", "/api/agent/claims/CLM-1001/policy", None),
    ("get", "/api/agent/claims/CLM-1001/history", None),
    (
        "post",
        "/api/agent/claims/CLM-1001/payout",
        {"benefit": "baggage", "lines": [], "paid_by_others": 0},
    ),
    (
        "post",
        "/api/agent/claims/CLM-1001/decision",
        {"decision": "refer", "payout": 0, "section": "s", "reason": "r", "maker": "claim_agent"},
    ),
    ("post", "/api/agent/claims/CLM-1001/payment", {"amount": 10}),
    ("post", "/api/agent/claims/CLM-1001/hold", {"reason": "r"}),
    (
        "post",
        "/api/agent/claims/CLM-1001/steps",
        {"thread_id": None, "kind": "message", "content": "c", "sources": []},
    ),
    (
        "post",
        "/api/agent/claims/CLM-1001/model-calls",
        {"thread_id": None, "model": "m", "input_tokens": 1, "output_tokens": 1, "cost": 0},
    ),
]
HANDLER_ROUTES: list[Route] = [
    ("get", "/api/staff/me", None),
    ("get", "/api/staff/claims", None),
    ("post", "/api/staff/claims/CLM-1001/sign-off", None),
    ("post", "/api/staff/claims/CLM-1001/send-back", {"note": "n"}),
    ("post", "/api/staff/claims/CLM-1001/work", None),
]


def call(client: TestClient, method: str, path: str, body: object, headers: dict[str, str]) -> int:
    return client.request(method, path, json=body, headers=headers).status_code


@pytest.mark.parametrize(("method", "path", "body"), AGENT_ROUTES)
def test_agent_routes_refuse_a_handler_and_no_one(
    client: TestClient, dana: dict[str, str], method: str, path: str, body: object
) -> None:
    assert call(client, method, path, body, {}) == 401
    # A handler's token is no key: the agent's routes don't read it.
    assert call(client, method, path, body, dana) == 401
    assert call(client, method, path, body, {"X-API-Key": "wrong" * 10}) == 401


@pytest.mark.parametrize(("method", "path", "body"), HANDLER_ROUTES)
def test_handler_routes_refuse_the_agents_key(
    client: TestClient, dana: dict[str, str], method: str, path: str, body: object
) -> None:
    assert call(client, method, path, body, {}) == 401
    assert call(client, method, path, body, AGENT) == 403
    # The key refuses the request even beside a handler's token.
    assert call(client, method, path, body, AGENT | dana) == 403


def test_a_claim_is_read_by_the_agent_and_a_handler_on_their_own_routes(
    client: TestClient, marcus: dict[str, str]
) -> None:
    assert client.get("/api/agent/claims/CLM-1001", headers=AGENT).status_code == 200
    assert client.get("/api/staff/claims/CLM-1001", headers=marcus).status_code == 200
    assert client.get("/api/staff/claims/CLM-1001").status_code == 401
    assert client.get("/api/staff/claims/CLM-1001", headers=AGENT).status_code == 403
    assert client.get("/api/agent/claims/CLM-1001", headers=marcus).status_code == 401


def test_me_is_the_handler_signed_in(client: TestClient, marcus: dict[str, str]) -> None:
    me = client.get("/api/staff/me", headers=marcus).json()
    assert (me["name"], me["can_approve_over_limit"]) == ("Marcus Oyelaran", False)


def test_sign_in_refuses_a_wrong_password_or_unknown_email(client: TestClient) -> None:
    wrong = {"email": "dana.whitfield@undercover.example", "password": "nope"}
    unknown = {"email": "someone@undercover.example", "password": PASSWORD}
    assert client.post("/api/staff/dev/sign-in", json=wrong).status_code == 401
    assert client.post("/api/staff/dev/sign-in", json=unknown).status_code == 401


def test_the_key_set_is_published(client: TestClient) -> None:
    [key] = client.get("/api/staff/dev/.well-known/jwks.json").json()["keys"]
    assert (key["kty"], key["alg"], key["use"]) == ("RSA", "RS256", "sig")
    assert "d" not in key  # never the private part


def forged(client: TestClient, **claims: object) -> dict[str, str]:
    """A token signed by a key the api didn't make."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    body = {
        "iss": "http://127.0.0.1:8000/api/staff/dev",
        "aud": "undercover-staff",
        "sub": "x",
        "email": "dana.whitfield@undercover.example",
        "token_use": "id",
        "iat": now,
        "exp": now + 60,
    } | claims
    return {"Authorization": f"Bearer {jwt.encode(body, key, algorithm='RS256')}"}


def test_a_token_signed_by_another_key_is_refused(client: TestClient) -> None:
    assert client.get("/api/staff/me", headers=forged(client)).status_code == 401


def test_an_unsigned_token_is_refused(client: TestClient) -> None:
    def part(value: dict[str, Any]) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    claims = {"email": "dana.whitfield@undercover.example", "token_use": "id"}
    token = f"{part({'alg': 'none', 'typ': 'JWT'})}.{part(claims)}."
    assert (
        client.get("/api/staff/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    )


def test_the_agent_key_is_compared_whole(client: TestClient) -> None:
    assert (
        client.get("/api/agent/claims/CLM-1001", headers={"X-API-Key": AGENT_KEY[:-1]}).status_code
        == 401
    )


AGENT_ISSUER = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_agent"
AGENT_CLIENT = "agent-client-id"
AGENT_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class AgentKeys:
    """The agent pool's key set, as RemoteKeys would fetch it."""

    def signing_key(self, token: str) -> Any:  # noqa: ARG002 - the same shape as RemoteKeys
        return AGENT_SIGNING_KEY.public_key()


def agent_token(key: Any = AGENT_SIGNING_KEY, **claims: object) -> dict[str, str]:
    now = int(time.time())
    body = {
        "iss": AGENT_ISSUER,
        "sub": AGENT_CLIENT,
        "client_id": AGENT_CLIENT,
        "token_use": "access",
        "scope": "undercover-api/agent",
        "iat": now,
        "exp": now + 600,
    } | claims
    return {"Authorization": f"Bearer {jwt.encode(body, key, algorithm='RS256')}"}


@pytest.fixture
def on_aws(client: TestClient) -> TestClient:
    """The api as on AWS: the agent's routes take its machine token from the agent's issuer."""
    from undercover_api.auth import AgentTokenVerifier  # noqa: PLC0415

    app: Any = client.app
    app.state.agent_verifier = AgentTokenVerifier(AgentKeys(), AGENT_ISSUER, AGENT_CLIENT)
    return client


CLAIM = "/api/agent/claims/CLM-1001"


def test_the_agents_machine_token_is_accepted(on_aws: TestClient) -> None:
    assert on_aws.get(CLAIM, headers=agent_token()).status_code == 200


@pytest.mark.parametrize(
    "claims",
    [
        {"client_id": "someone-else"},
        {"scope": "undercover-api/other"},
        {"scope": ""},
        {"iss": "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_other"},
        {"token_use": "id"},
        {"exp": int(time.time()) - 60},
    ],
)
def test_a_token_that_isnt_the_agents_is_refused(
    on_aws: TestClient, claims: dict[str, object]
) -> None:
    assert on_aws.get(CLAIM, headers=agent_token(**claims)).status_code == 401


def test_a_token_signed_by_another_key_is_refused_for_the_agent(on_aws: TestClient) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert on_aws.get(CLAIM, headers=agent_token(other)).status_code == 401


def test_on_aws_the_shared_key_is_refused_even_with_a_token(on_aws: TestClient) -> None:
    assert on_aws.get(CLAIM, headers=AGENT).status_code == 401
    assert on_aws.get(CLAIM, headers=AGENT | agent_token()).status_code == 401
    assert on_aws.get(CLAIM).status_code == 401


def test_the_agents_token_never_stands_in_for_a_handler(on_aws: TestClient) -> None:
    assert on_aws.get("/api/staff/me", headers=agent_token()).status_code == 401


def test_locally_the_key_works_and_a_token_does_not(client: TestClient) -> None:
    assert client.get(CLAIM, headers=AGENT).status_code == 200
    assert client.get(CLAIM, headers=agent_token()).status_code == 401


def test_with_no_shared_key_set_no_key_is_the_agents(on_aws: TestClient) -> None:
    app: Any = on_aws.app
    app.state.settings = app.state.settings.model_copy(update={"undercover_api_key": None})
    app.state.agent_verifier = None
    assert on_aws.get(CLAIM, headers=AGENT).status_code == 401


def id_token(key: Any, **claims: object) -> str:
    now = int(time.time())
    body = {
        "iss": "https://issuer.example",
        "aud": "staff-client",
        "sub": "s",
        "email": "dana.whitfield@undercover.example",
        "cognito:groups": ["handlers"],
        "token_use": "id",
        "iat": now,
        "exp": now + 60,
    } | claims
    return jwt.encode(body, key, algorithm="RS256")


def test_an_identity_center_email_counts_as_verified_and_nothing_else_does() -> None:
    from fastapi import HTTPException  # noqa: PLC0415

    from undercover_api.auth import TokenVerifier  # noqa: PLC0415

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class Keys:
        def signing_key(self, token: str) -> Any:  # noqa: ARG002 - the same shape as RemoteKeys
            return key.public_key()

    verifier = TokenVerifier(Keys(), "https://issuer.example", "staff-client")
    saml = [{"providerName": "IdentityCenter", "providerType": "SAML"}]
    email = "dana.whitfield@undercover.example"
    assert verifier.identity(id_token(key, email_verified=False, identities=saml)) == (
        email,
        ["handlers"],
    )
    assert verifier.identity(id_token(key, email_verified=True))[0] == email
    for unverified in (
        {"email_verified": False},
        {"email_verified": False, "identities": [{"providerType": "Google"}]},
        {"email_verified": "true", "identities": "SAML"},
    ):
        with pytest.raises(HTTPException):
            verifier.identity(id_token(key, **unverified))
