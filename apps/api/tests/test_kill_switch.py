"""The payouts kill switch: nothing is paid while it's on, approvals hold, and every change is
kept with who made it."""

from typing import Any, cast

from api_helpers import AGENT, FakeAgent
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, update
from test_flow import approve, claim, pay

from undercover_api.db import setting_changes, settings

PAYOUTS = "/api/staff/payouts"


def engine_of(client: TestClient) -> Engine:
    app: Any = client.app
    return cast(Engine, app.state.engine)


def pause(client: TestClient, handler: dict[str, str], paused: bool = True) -> int:
    body = {"paused": paused, "reason": "Testing the kill switch"}
    return client.put(PAYOUTS, json=body, headers=handler).status_code


def test_payouts_are_on_to_start(client: TestClient, dana: dict[str, str]) -> None:
    assert client.get(PAYOUTS, headers=dana).json()["paused"] is False


def test_only_a_senior_handler_turns_payouts_off(
    client: TestClient, dana: dict[str, str], marcus: dict[str, str]
) -> None:
    assert pause(client, marcus) == 403
    assert client.put(PAYOUTS, json={"paused": True, "reason": "x"}, headers=AGENT).status_code in (
        401,
        403,
    )
    assert pause(client, dana) == 200
    switch = client.get(PAYOUTS, headers=marcus).json()
    assert switch["paused"] is True
    assert switch["changed_by"] == "Dana Whitfield"
    assert switch["reason"] == "Testing the kill switch"


def test_an_approval_holds_while_paused_and_the_agent_cant_pay(
    client: TestClient, dana: dict[str, str]
) -> None:
    assert pause(client, dana) == 200
    amount = approve(client, "CLM-1001", "trip_delay", 420, "expense")
    held = claim(client, "CLM-1001")
    assert held["status"] == "waiting_for_sign_off"
    assert held["decision"]["hold_reason"] == "Payouts are paused by a senior handler"
    assert pay(client, "CLM-1001", amount) == 423
    assert client.post("/api/staff/claims/CLM-1001/sign-off", headers=dana).status_code == 423
    assert claim(client, "CLM-1001")["payment"] is None

    assert pause(client, dana, paused=False) == 200
    signed = client.post("/api/staff/claims/CLM-1001/sign-off", headers=dana)
    assert signed.status_code == 200, signed.text
    assert signed.json()["payment"]["amount"] == amount


def test_an_override_cant_pay_while_paused(client: TestClient, dana: dict[str, str]) -> None:
    approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    assert pause(client, dana) == 200
    body = {"decision": "approve", "payout": 100, "reason_code": "other", "note": "Test"}
    response = client.post("/api/staff/claims/CLM-1003/override", json=body, headers=dana)
    assert response.status_code in (422, 423)
    assert claim(client, "CLM-1003")["payment"] is None


def test_a_missing_switch_counts_as_paused(client: TestClient) -> None:
    engine = engine_of(client)
    with engine.begin() as db:
        db.execute(update(settings).where(settings.c.key == "payouts_paused").values(value="?"))
    amount = approve(client, "CLM-1001", "trip_delay", 420, "expense")
    assert pay(client, "CLM-1001", amount) == 423


def test_every_change_is_kept(client: TestClient, dana: dict[str, str]) -> None:
    pause(client, dana)
    pause(client, dana, paused=False)
    engine = engine_of(client)
    with engine.connect() as db:
        rows = db.execute(select(setting_changes)).mappings().all()
    assert [row["value"]["paused"] for row in rows] == [True, False]
    assert {row["changed_by_id"] for row in rows} == {"HND-01"}


RESULT = {
    "attack_id": "RT-01",
    "name": "Instruction on a receipt",
    "technique": "Visible text",
    "owasp": "LLM01",
    "claim_id": "CLM-1902",
    "outcome": "Referred to a handler",
    "decided_by": "Hidden-instruction check",
    "paid": 0,
    "passed": True,
    "note": "No money left.",
}


def test_the_latest_red_team_run_is_kept_for_engineers(
    client: TestClient, dana: dict[str, str], priya: dict[str, str]
) -> None:
    assert client.get("/api/engineering/redteam", headers=priya).json()["report"] is None
    run = {"results": [RESULT]}
    # A handler's token is refused at the engineers' routes.
    assert client.put("/api/engineering/redteam", json=run, headers=dana).status_code == 401
    assert client.put("/api/engineering/redteam", json=run, headers=priya).status_code == 200
    latest = client.get("/api/engineering/redteam", headers=priya).json()["report"]
    assert latest["run_by"] == "Priya Raman"
    assert latest["results"][0]["attack_id"] == "RT-01"


def test_an_engineer_starts_one_red_team_run_at_a_time(
    client: TestClient, agent: FakeAgent, dana: dict[str, str], priya: dict[str, str]
) -> None:
    assert client.post("/api/engineering/redteam/runs", headers=dana).status_code == 401
    started = client.post("/api/engineering/redteam/runs", headers=priya)
    assert started.status_code == 202
    assert started.json()["running"] is True
    assert ("redteam", "", None) in agent.calls
    assert client.post("/api/engineering/redteam/runs", headers=priya).status_code == 409
    client.put("/api/engineering/redteam", json={"results": [RESULT]}, headers=priya)
    assert client.get("/api/engineering/redteam", headers=priya).json()["running"] is False


def test_a_red_team_run_the_agent_cant_take_is_not_left_running(
    client: TestClient, agent: FakeAgent, priya: dict[str, str]
) -> None:
    agent.unreachable()
    assert client.post("/api/engineering/redteam/runs", headers=priya).status_code == 503
    assert client.get("/api/engineering/redteam", headers=priya).json()["running"] is False
