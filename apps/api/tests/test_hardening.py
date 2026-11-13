"""The edges a reviewer found: tokens signed with the api's own key but wrong, money when the
limit moves or a request races, the hand-over to the agent, and what the logs may hold."""

import base64
import hashlib
import hmac
import json
import logging
import sys
import time
from typing import Any, cast

import jwt
import pytest
from api_helpers import AGENT, DANA, FakeAgent, decide, line, make_settings, payout, start
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, select, update

from undercover_api import main
from undercover_api.db import claims, make_engine, payments, policies, settings
from undercover_api.local_sign_in import LocalIssuer
from undercover_api.logs import JsonFormatter, configure_logging, redact, redact_names
from undercover_api.main import create_app

# --- Tokens signed with the api's own key, each with one thing wrong ---


def part(value: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


def issuer_of(client: TestClient, audience: str = "staff") -> LocalIssuer:
    """One of the local sign-in stand-in's two issuers inside the api under test."""
    return cast(LocalIssuer, getattr(cast(FastAPI, client.app).state, f"{audience}_issuer"))


def own_token(client: TestClient, **changes: Any) -> dict[str, str]:
    issuer = issuer_of(client)
    now = int(time.time())
    claims_: dict[str, Any] = {
        "iss": issuer.issuer,
        "aud": issuer.audience,
        "sub": "s",
        "email": DANA,
        "email_verified": True,
        "cognito:groups": ["handlers"],
        "token_use": "id",
        "iat": now,
        "exp": now + 60,
    } | changes
    claims_ = {k: v for k, v in claims_.items() if v is not None}
    key = issuer._key  # pyright: ignore[reportPrivateUsage]
    token = jwt.encode(claims_, key, algorithm="RS256", headers={"kid": issuer.key_id})
    return {"Authorization": f"Bearer {token}"}


def test_a_good_token_from_the_api_key_is_taken(client: TestClient) -> None:
    assert client.get("/api/staff/me", headers=own_token(client)).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://someone-else.example"},
        {"aud": "another-app"},
        {"exp": int(time.time()) - 10},
        {"token_use": "access"},
        {"email_verified": False},
        {"email_verified": None},
        {"email": None},
        {"sub": None},
    ],
)
def test_a_token_with_one_thing_wrong_is_refused(
    client: TestClient, changes: dict[str, Any]
) -> None:
    assert client.get("/api/staff/me", headers=own_token(client, **changes)).status_code == 401


@pytest.mark.parametrize("groups", [None, "handlers", ["customers"], []])
def test_a_token_without_the_handlers_group_is_kept_from_handler_routes(
    client: TestClient, groups: object
) -> None:
    code = client.get(
        "/api/staff/me", headers=own_token(client, **{"cognito:groups": groups})
    ).status_code
    assert code in {401, 403}


def test_an_hs256_token_keyed_with_the_public_key_is_refused(client: TestClient) -> None:
    issuer = issuer_of(client)
    public = json.dumps(issuer.public_jwk()).encode()
    now = int(time.time())
    body: dict[str, Any] = {"iss": issuer.issuer, "aud": issuer.audience, "sub": "s", "email": DANA}
    body |= {"email_verified": True, "token_use": "id", "iat": now, "exp": now + 60}
    # Built by hand: PyJWT itself won't sign with a public key as an HMAC secret.
    signing_input = f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part(body)}"
    signature = hmac.new(public, signing_input.encode(), hashlib.sha256).digest()
    token = f"{signing_input}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"
    assert (
        client.get("/api/staff/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    )


def test_a_handler_is_found_whatever_the_emails_case(client: TestClient) -> None:
    headers = own_token(client, email=DANA.upper())
    assert client.get("/api/staff/me", headers=headers).json()["name"] == "Dana Whitfield"


# --- Money ---


def approve_under_the_limit(client: TestClient) -> float:
    start(client, "CLM-1001")
    worked = payout(client, "CLM-1001", "trip_delay", [line("Taxis", 420, kind="expense")])
    assert decide(client, "CLM-1001", "approve", worked["payout"]).status_code == 200
    return worked["payout"]


def pay(client: TestClient, amount: float) -> int:
    return client.post(
        "/api/agent/claims/CLM-1001/payment", json={"amount": amount}, headers=AGENT
    ).status_code


def test_with_no_limit_set_nothing_is_paid_and_it_waits_for_a_sign_off(
    client: TestClient, database_url: str
) -> None:
    amount = approve_under_the_limit(client)
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(delete(settings).where(settings.c.key == "approval_limit"))
    engine.dispose()
    response = client.post(
        "/api/agent/claims/CLM-1001/payment", json={"amount": amount}, headers=AGENT
    )
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["payment"] is None


def test_a_limit_lowered_after_the_decision_holds_the_payment_for_a_sign_off(
    client: TestClient, database_url: str
) -> None:
    amount = approve_under_the_limit(client)
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(update(settings).where(settings.c.key == "approval_limit").values(value=100))
    engine.dispose()
    response = client.post(
        "/api/agent/claims/CLM-1001/payment", json={"amount": amount}, headers=AGENT
    )
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["payment"] is None


def no_decision(*_: object) -> None:
    return None


def test_a_decision_racing_in_gets_a_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    start(client, "CLM-1001")
    assert decide(client, "CLM-1001", "refer").status_code == 200
    # As if another request had read "no decision yet" a moment before this one landed.
    monkeypatch.setattr(main, "find_decision", no_decision)
    assert decide(client, "CLM-1001", "decline").status_code == 409


def test_a_payment_replayed_against_a_restarted_api_pays_once(
    client: TestClient, database_url: str
) -> None:
    amount = approve_under_the_limit(client)
    assert pay(client, amount) == 200
    restarted = create_app(make_settings(database_url), agent_service=FakeAgent())
    with TestClient(restarted) as again:
        assert pay(again, amount) == 200
        assert pay(again, amount + 1) == 409
    engine = make_engine(database_url)
    with engine.connect() as db:
        assert len(db.execute(select(payments)).all()) == 1
    engine.dispose()


def test_a_sign_off_tells_the_agent_and_records_the_handler(
    client: TestClient, dana: dict[str, str], agent: FakeAgent, database_url: str
) -> None:
    start(client, "CLM-1003")
    worked = payout(
        client, "CLM-1003", "emergency_medical", [line("Hospital", 3800, kind="expense")]
    )
    decide(client, "CLM-1003", "approve", worked["payout"])
    assert client.post("/api/staff/claims/CLM-1003/sign-off", headers=dana).status_code == 200
    assert agent.calls == [("resume", "CLM-1003", "signed_off")]
    engine = make_engine(database_url)
    with engine.connect() as db:
        paid = db.execute(select(payments.c.signed_off_by_id)).scalar_one()
    engine.dispose()
    assert paid == "HND-01"


def test_a_sign_off_pays_even_when_the_agent_cant_be_told(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    start(client, "CLM-1003")
    worked = payout(
        client, "CLM-1003", "emergency_medical", [line("Hospital", 3800, kind="expense")]
    )
    decide(client, "CLM-1003", "approve", worked["payout"])
    agent.unreachable()
    signed = client.post("/api/staff/claims/CLM-1003/sign-off", headers=dana)
    assert signed.json()["payment"]["amount"] == worked["payout"]


def test_an_unknown_plan_is_a_409_not_a_crash(client: TestClient, database_url: str) -> None:
    engine = make_engine(database_url)
    with engine.begin() as db:
        record = db.execute(
            select(policies.c.record)
            .join(claims, claims.c.policy_id == policies.c.policy_id)
            .where(claims.c.claim_id == "CLM-1001")
        ).scalar_one()
        db.execute(
            update(policies)
            .where(policies.c.policy_id == record["policy_id"])
            .values(record=record | {"plan": "platinum"})
        )
    engine.dispose()
    start(client, "CLM-1001")
    response = client.post(
        "/api/agent/claims/CLM-1001/payout",
        json={"benefit": "baggage", "lines": [], "paid_by_others": 0},
        headers=AGENT,
    )
    assert response.status_code == 409


# --- Handing work to the agent ---


def status(client: TestClient, claim_id: str) -> str:
    return client.get(f"/api/agent/claims/{claim_id}", headers=AGENT).json()["status"]


def test_work_moves_a_waiting_claim_and_asks_the_agent(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    worked = client.post("/api/staff/claims/CLM-1001/work", headers=dana)
    assert worked.status_code == 200, worked.text
    body = worked.json()
    assert (body["status"], body["attempts"]) == ("in_progress", 1)
    assert agent.calls == [("work", "CLM-1001", None)]
    assert client.post("/api/staff/claims/CLM-1001/work", headers=dana).status_code == 409


@pytest.mark.parametrize(("failure", "code"), [("unreachable", 503), ("refusing", 502)])
def test_work_the_agent_doesnt_take_is_undone(
    client: TestClient, dana: dict[str, str], agent: FakeAgent, failure: str, code: int
) -> None:
    getattr(agent, failure)()
    response = client.post("/api/staff/claims/CLM-1001/work", headers=dana)
    assert response.status_code == code
    assert "agent" in response.json()["detail"]
    claim = client.get("/api/agent/claims/CLM-1001", headers=AGENT).json()
    assert (claim["status"], claim["attempts"], claim["thread_id"]) == ("waiting", 0, None)


def test_a_sent_back_claim_the_agent_missed_is_worked_later(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    start(client, "CLM-1003")
    worked = payout(
        client, "CLM-1003", "emergency_medical", [line("Hospital", 3800, kind="expense")]
    )
    decide(client, "CLM-1003", "approve", worked["payout"])
    agent.unreachable()
    sent = client.post(
        "/api/staff/claims/CLM-1003/send-back", json={"note": "Look again"}, headers=dana
    )
    assert sent.json()["status"] == "sent_back"
    agent.failure = None
    assert (
        client.post("/api/staff/claims/CLM-1003/work", headers=dana).json()["status"]
        == "in_progress"
    )
    assert agent.calls == [("resume", "CLM-1003", "sent_back")]


# --- What the dashboard reads ---


def test_a_claim_carries_its_policy_plan_and_the_limit(
    client: TestClient, dana: dict[str, str]
) -> None:
    claim = client.get("/api/staff/claims/CLM-1001", headers=dana).json()
    assert claim["policy"]["plan"] in {"economy", "premium", "first"}
    assert claim["approval_limit"] == 1000.0
    [summary] = [
        c
        for c in client.get("/api/staff/claims", headers=dana).json()
        if c["claim_id"] == "CLM-1001"
    ]
    assert summary["plan"] == claim["policy"]["plan"]


def test_handlers_read_the_steps_in_order(client: TestClient, dana: dict[str, str]) -> None:
    for content in ("first", "second"):
        client.post(
            "/api/agent/claims/CLM-1001/steps",
            json={"thread_id": None, "kind": "message", "content": content, "sources": []},
            headers=AGENT,
        )
    steps = client.get("/api/staff/claims/CLM-1001/steps", headers=dana).json()
    assert [s["content"] for s in steps] == ["first", "second"]
    assert "created_at" in steps[0]


def test_a_screening_referral_is_named_and_flagged(client: TestClient) -> None:
    start(client, "CLM-1901")
    body = {"decision": "refer", "payout": 0, "section": "Claims manual 3", "reason": "r"}
    referred = client.post(
        "/api/agent/claims/CLM-1901/decision",
        json=body | {"maker": "hidden_instruction_check"},
        headers=AGENT,
    ).json()["decision"]
    assert (referred["decided_by"], referred["by_screening"]) == ("Hidden-instruction check", True)


def test_the_hidden_instruction_check_may_only_refer(client: TestClient) -> None:
    start(client, "CLM-1001")
    body = {"decision": "decline", "payout": 0, "section": "s", "reason": "r"}
    response = client.post(
        "/api/agent/claims/CLM-1001/decision",
        json=body | {"maker": "hidden_instruction_check"},
        headers=AGENT,
    )
    assert response.status_code == 422


# --- Bounds at the door ---


@pytest.mark.parametrize(
    "changes",
    [
        {"model": "m" * 101},
        {"input_tokens": 2**31},
        {"output_tokens": 2**31},
        {"cost": 10_000_000},
        {"thread_id": "t" * 101},
    ],
)
def test_a_model_call_out_of_the_columns_bounds_is_refused(
    client: TestClient, changes: dict[str, Any]
) -> None:
    body = {"thread_id": None, "model": "m", "input_tokens": 1, "output_tokens": 1, "cost": 0}
    response = client.post(
        "/api/agent/claims/CLM-1001/model-calls", json=body | changes, headers=AGENT
    )
    assert response.status_code == 422


@pytest.mark.parametrize("claim_id", ["CLM-1001x", "1001", "CLM-1%27"])
def test_a_malformed_claim_id_is_refused(client: TestClient, claim_id: str) -> None:
    assert client.get(f"/api/agent/claims/{claim_id}", headers=AGENT).status_code == 422


# --- Settings ---


def test_the_environment_must_be_named() -> None:
    values = make_settings("sqlite://").model_dump() | {"environment": None}
    with pytest.raises(ValidationError):
        type(make_settings("sqlite://")).model_validate(values)


def test_a_plain_http_issuer_is_refused_outside_a_laptop() -> None:
    with pytest.raises(ValidationError, match="must be https"):
        make_settings("sqlite://", environment="dev", local_sign_in=False)


# --- Logs ---


def test_logs_redact_customers_names_even_from_errors() -> None:
    redact_names(["Maya Patel"])
    try:
        raise RuntimeError("could not save the claim for Maya Patel")
    except RuntimeError:
        record = logging.LogRecord("t", logging.ERROR, "f", 1, "saving Patel", None, None)
        record.exc_info = sys.exc_info()
    entry = json.loads(JsonFormatter().format(record))
    assert "Patel" not in json.dumps(entry)
    assert "Maya" not in json.dumps(entry)
    assert redact("a claim for maya patel") == "a claim for [name]"


def test_uvicorns_errors_go_through_the_redacting_formatter() -> None:
    configure_logging()
    error_logger = logging.getLogger("uvicorn.error")
    assert error_logger.handlers == []
    assert error_logger.propagate
    [handler] = logging.getLogger().handlers
    assert isinstance(handler.formatter, JsonFormatter)


def test_the_api_loads_customers_names_to_redact(client: TestClient) -> None:
    assert redact("Maya Patel called") == "[name] called"


def test_logs_redact_mobile_numbers_a_payid_can_be() -> None:
    for number in ("0412 345 678", "0412345678", "+61 412 345 678", "+61412345678"):
        assert redact(f"paid to PayID {number} today") == "paid to PayID [phone] today"
    assert redact("claim CLM-1001 for $1,412.50") == "claim CLM-1001 for $1,412.50"


def test_the_demo_counts_what_needs_a_handler(client: TestClient) -> None:
    before = client.get("/api/demo/stats").json()
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "refer")
    after = client.get("/api/demo/stats").json()
    assert after["decided"] == before["decided"] + 1
    assert after["need_a_handler"] == before["need_a_handler"] + 1
    assert after["traced"] <= after["decided"]
    assert set(after) >= {"claims", "auto_paid", "redteam_attacks", "held_out_claims"}
