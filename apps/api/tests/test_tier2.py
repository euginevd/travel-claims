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
    """Cognito's stand-in: keeps each password set, and signs in only with the one kept."""

    def __init__(self, fail_sets: int = 0) -> None:
        self.passwords: dict[str, str] = {}
        self.pools: list[str] = []
        self.clients: list[str] = []
        self.fail_sets = fail_sets

    def admin_set_user_password(self, **call: Any) -> None:
        if self.fail_sets:
            self.fail_sets -= 1
            raise RuntimeError(f"InvalidPasswordException: {call['Password']}")
        assert call["Permanent"] is True
        self.pools.append(call["UserPoolId"])
        self.passwords[call["Username"]] = call["Password"]

    def initiate_auth(self, **call: Any) -> dict[str, Any]:
        self.clients.append(call["ClientId"])
        given = call["AuthParameters"]
        assert self.passwords[given["USERNAME"]] == given["PASSWORD"]
        return {"AuthenticationResult": {"IdToken": "cognito-token", "ExpiresIn": 3600}}


ISSUER = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_"


def demo_settings(database_url: str) -> Any:
    return make_settings(
        database_url,
        environment="dev",
        local_sign_in=False,
        handler_password=None,
        test_sign_in=True,
        staff_token_issuer=f"{ISSUER}staff",
        customer_token_issuer=f"{ISSUER}customers",
        customer_token_audience="customer-client",
        engineering_token_issuer=f"{ISSUER}engineering",
    )


def test_a_test_account_signs_in_with_a_fresh_password_in_its_own_pool(database_url: str) -> None:
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from undercover_api.demo_sign_in import CognitoTestSignIn  # noqa: PLC0415
    from undercover_api.main import create_app  # noqa: PLC0415

    cognito = FakeCognito()
    app = create_app(demo_settings(database_url))
    app.state.test_sign_in = CognitoTestSignIn(cognito)
    client = TestClient(app)
    path = "/api/customer/dev/test-sign-in"
    answer = client.post(path, json={"account": "customer"})
    first = cognito.passwords["oliver.grant@example.com"]
    client.post(path, json={"account": "customer"})
    assert answer.json() == {"id_token": "cognito-token", "expires_in": 3600}
    assert cognito.pools == ["ap-southeast-2_customers"] * 2
    assert cognito.clients == ["customer-client"] * 2
    assert cognito.passwords["oliver.grant@example.com"] != first
    assert client.post(path, json={"account": "x"}).status_code == 404  # noqa: PLR2004
    # The red team's account and the password sign-in stay local.
    redteam = {"account": "attacker"}
    assert client.post("/api/customer/dev/redteam-sign-in", json=redteam).status_code == 404  # noqa: PLR2004
    login = {"email": "a@b.c", "password": "p"}
    assert client.post("/api/customer/dev/sign-in", json=login).status_code == 404  # noqa: PLR2004


def test_a_failed_sign_in_tries_again_and_never_echoes_the_password() -> None:
    from fastapi import HTTPException  # noqa: PLC0415

    from undercover_api.demo_sign_in import CognitoTestSignIn  # noqa: PLC0415

    assert CognitoTestSignIn(FakeCognito(fail_sets=1)).sign_in("o@x.y", "pool", "c").id_token
    with pytest.raises(HTTPException) as raised:
        CognitoTestSignIn(FakeCognito(fail_sets=2)).sign_in("o@x.y", "pool", "c")
    assert raised.value.status_code == 503  # noqa: PLR2004
    assert "InvalidPassword" not in str(raised.value.detail)
    assert raised.value.__cause__ is None


def test_without_test_sign_in_there_are_no_demo_routes(database_url: str) -> None:
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from undercover_api.main import create_app  # noqa: PLC0415

    settings = demo_settings(database_url).model_copy(update={"test_sign_in": False})
    client = TestClient(create_app(settings))
    body = {"account": "customer"}
    assert client.post("/api/customer/dev/test-sign-in", json=body).status_code == 404  # noqa: PLR2004
    assert client.get("/api/demo/stats").status_code == 404  # noqa: PLR2004


def test_test_sign_in_is_refused_alongside_the_local_stand_in(database_url: str) -> None:
    with pytest.raises(ValueError, match="TEST_SIGN_IN"):
        make_settings(database_url, test_sign_in=True)
