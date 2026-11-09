"""Tier 2's switches: the agent on AgentCore Runtime and receipts in S3, with stand-ins for AWS.
Both stay off unless their setting is given, so tier 1 runs as before."""

import io
import json
import os
from typing import Any

import pytest

from undercover_api.agent_service import (
    AgentRefusedError,
    AgentUnavailableError,
    HttpAgentService,
    Outcome,
    RuntimeAgentService,
)
from undercover_api.main import make_agent_service, make_receipts
from undercover_api.storage import S3ReceiptStore

from .api_helpers import make_settings

KEY = "k" * 64
ARN = "arn:aws:bedrock-agentcore:ap-southeast-2:111122223333:runtime/travel_claims_agent-abc"


class FakeRuntime:
    """invoke_agent_runtime's stand-in: records each call and answers with the next envelope."""

    def __init__(self, *answers: object) -> None:
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    def invoke_agent_runtime(self, **call: Any) -> dict[str, Any]:
        self.calls.append(call)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return {"response": io.BytesIO(json.dumps(answer).encode())}


def test_work_goes_through_the_runtime_without_the_key_and_with_a_long_session_id() -> None:
    runtime = FakeRuntime({"status": 202, "body": {"accepted": True}})
    RuntimeAgentService(ARN, runtime).work("CLM-1001", "thread-1")
    call = runtime.calls[0]
    assert call["agentRuntimeArn"] == ARN
    assert len(call["runtimeSessionId"]) >= 33  # noqa: PLR2004 - Runtime's minimum
    assert json.loads(call["payload"]) == {
        "path": "/work",
        "body": {"claim_id": "CLM-1001", "thread_id": "thread-1"},
    }


def test_each_request_gets_its_own_session() -> None:
    runtime = FakeRuntime(*[{"status": 202, "body": {"accepted": True}}] * 2)
    service = RuntimeAgentService(ARN, runtime)
    service.resume("CLM-1001", "thread-1", Outcome.SIGNED_OFF)
    service.improve(3)
    first, second = (c["runtimeSessionId"] for c in runtime.calls)
    assert first != second


def test_a_refusal_comes_back_with_its_reason() -> None:
    runtime = FakeRuntime({"status": 409, "body": {"refused": "Already working CLM-1001"}})
    with pytest.raises(AgentRefusedError, match="Already working CLM-1001"):
        RuntimeAgentService(ARN, runtime).work("CLM-1001", "thread-1")


def test_an_unreachable_runtime_is_unavailable() -> None:
    runtime = FakeRuntime(TimeoutError("read timed out"))
    with pytest.raises(AgentUnavailableError):
        RuntimeAgentService(ARN, runtime).work("CLM-1001", "thread-1")


def test_a_draft_returns_the_agents_answer() -> None:
    runtime = FakeRuntime({"status": 200, "body": {"summary": "Bag delayed"}})
    assert RuntimeAgentService(ARN, runtime).draft({"text": "x"}) == {"summary": "Bag delayed"}


def test_the_runtime_needs_an_arn() -> None:
    with pytest.raises(ValueError, match="ARN"):
        RuntimeAgentService("http://agent:8080", FakeRuntime())


def test_without_a_runtime_arn_the_agent_is_reached_over_http(database_url: str) -> None:
    assert isinstance(make_agent_service(make_settings(database_url)), HttpAgentService)
    assert not isinstance(make_agent_service(make_settings(database_url)), RuntimeAgentService)


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803 - boto3's names
        self.objects[(Bucket, Key)] = Body

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's names
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


def test_receipts_in_s3_keep_random_names_and_read_back() -> None:
    s3 = FakeS3()
    store = S3ReceiptStore("travel-claims-receipts-dev", s3)
    name = store.save(b"%PDF-1.7 receipt")
    assert len(name) == 32  # noqa: PLR2004 - 16 random bytes in hex
    assert store.read(name) == b"%PDF-1.7 receipt"
    assert ("travel-claims-receipts-dev", name) in s3.objects


def test_without_a_bucket_receipts_stay_in_the_folder(database_url: str) -> None:
    assert make_receipts(make_settings(database_url)) is None


def test_app_secret_fills_in_only_what_the_environment_lacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from undercover_api.settings import load_app_secret  # noqa: PLC0415

    monkeypatch.setenv("APP_SECRET", "travel-claims/dev/app")
    monkeypatch.setenv("KEPT", "from-environment")
    monkeypatch.delenv("FILLED", raising=False)
    asked: list[str] = []

    def fetch(name: str) -> str:
        asked.append(name)
        return '{"KEPT": "from-secret", "FILLED": "from-secret"}'

    load_app_secret(fetch)
    assert asked == ["travel-claims/dev/app"]
    assert (os.environ["KEPT"], os.environ["FILLED"]) == ("from-environment", "from-secret")


def test_without_app_secret_nothing_is_fetched(monkeypatch: pytest.MonkeyPatch) -> None:
    from undercover_api.settings import load_app_secret  # noqa: PLC0415

    monkeypatch.delenv("APP_SECRET", raising=False)
    load_app_secret(lambda name: pytest.fail(f"fetched {name}"))


class FakeCognito:
    """initiate_auth's stand-in: answers with a token for the one right password."""

    def __init__(self, password: str) -> None:
        self.password = password
        self.calls: list[dict[str, Any]] = []

    def initiate_auth(self, **call: Any) -> dict[str, Any]:
        self.calls.append(call)
        if call["AuthParameters"]["PASSWORD"] != self.password:
            raise RuntimeError("NotAuthorizedException: password for oliver.grant@example.com")
        return {"AuthenticationResult": {"IdToken": "cognito-token", "ExpiresIn": 3600}}


def demo_settings(database_url: str) -> Any:
    issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_"
    return make_settings(
        database_url,
        environment="dev",
        local_sign_in=False,
        handler_password=None,
        test_accounts_secret="travel-claims/dev/test-accounts",
        staff_token_issuer=f"{issuer}staff",
        customer_token_issuer=f"{issuer}customers",
        customer_token_audience="customer-client",
        engineering_token_issuer=f"{issuer}engineering",
    )


def test_a_test_account_signs_in_through_its_cognito_client(database_url: str) -> None:
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from undercover_api.demo_sign_in import CognitoTestSignIn  # noqa: PLC0415
    from undercover_api.main import create_app  # noqa: PLC0415

    cognito = FakeCognito("right")
    app = create_app(demo_settings(database_url))
    app.state.test_sign_in = CognitoTestSignIn(
        "travel-claims/dev/test-accounts",
        lambda _: json.dumps({"oliver.grant@example.com": "right"}),
        cognito,
    )
    client = TestClient(app)
    answer = client.post("/api/customer/dev/test-sign-in", json={"account": "customer"})
    assert answer.json() == {"id_token": "cognito-token", "expires_in": 3600}
    assert cognito.calls[0]["ClientId"] == "customer-client"
    assert client.post("/api/customer/dev/test-sign-in", json={"account": "x"}).status_code == 404
    # The red team's account and the password sign-in stay local.
    assert (
        client.post("/api/customer/dev/redteam-sign-in", json={"account": "attacker"}).status_code
        == 404
    )  # noqa: E501
    assert (
        client.post(
            "/api/customer/dev/sign-in", json={"email": "a@b.c", "password": "p"}
        ).status_code
        == 404
    )  # noqa: E501


def test_a_failed_cognito_sign_in_never_echoes_the_password() -> None:
    from fastapi import HTTPException  # noqa: PLC0415

    from undercover_api.demo_sign_in import CognitoTestSignIn  # noqa: PLC0415

    signer = CognitoTestSignIn(
        "s", lambda _: json.dumps({"oliver.grant@example.com": "stale"}), FakeCognito("right")
    )
    with pytest.raises(HTTPException) as raised:
        signer.sign_in("oliver.grant@example.com", "client")
    assert raised.value.status_code == 503  # noqa: PLR2004
    assert "stale" not in str(raised.value.detail)
    assert raised.value.__cause__ is None


def test_without_test_accounts_there_are_no_demo_routes(database_url: str) -> None:
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from undercover_api.main import create_app  # noqa: PLC0415

    settings = demo_settings(database_url).model_copy(update={"test_accounts_secret": None})
    client = TestClient(create_app(settings))
    assert (
        client.post("/api/customer/dev/test-sign-in", json={"account": "customer"}).status_code
        == 404
    )  # noqa: E501
    assert client.get("/api/demo/stats").status_code == 404  # noqa: PLR2004


def test_test_accounts_are_refused_alongside_the_local_stand_in(database_url: str) -> None:
    with pytest.raises(ValueError, match="TEST_ACCOUNTS_SECRET"):
        make_settings(database_url, test_accounts_secret="travel-claims/dev/test-accounts")
