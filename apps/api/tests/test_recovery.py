"""A claim the agent stopped working: noticed by its heartbeat, carried on once per retry."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from api_helpers import AGENT, MAYA, SAM, FakeAgent, make_settings, sign_in, start
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import RowMapping, update
from test_kill_switch import engine_of

from undercover_api import recovery
from undercover_api.claims import STALLED_AFTER, find_claim, is_stalled
from undercover_api.db import claims
from undercover_api.main import create_app

CLAIM = "CLM-1001"


def stall(client: TestClient, handler: dict[str, str], claim_id: str = CLAIM) -> dict[str, Any]:
    response = client.post(f"/api/staff/dev/claims/{claim_id}/stall", headers=handler)
    assert response.status_code == 200, response.text
    return response.json()


def staff_claim(client: TestClient, handler: dict[str, str]) -> dict[str, Any]:
    return client.get(f"/api/staff/claims/{CLAIM}", headers=handler).json()


def staff_steps(client: TestClient, handler: dict[str, str]) -> list[dict[str, Any]]:
    return client.get(f"/api/staff/claims/{CLAIM}/steps", headers=handler).json()


def retry(client: TestClient, headers: dict[str, str]) -> Any:
    return client.post(f"/api/staff/claims/{CLAIM}/retry", headers=headers)


def age_heartbeat(client: TestClient, claim_id: str = CLAIM) -> None:
    old = (datetime.now(UTC) - timedelta(minutes=5)).isoformat(timespec="seconds")
    with engine_of(client).begin() as db:
        db.execute(update(claims).where(claims.c.claim_id == claim_id).values(heartbeat_at=old))


def beat(client: TestClient, thread_id: str, claim_id: str = CLAIM) -> int:
    path = f"/api/agent/claims/{claim_id}/heartbeat"
    return client.post(path, json={"thread_id": thread_id}, headers=AGENT).status_code


def test_a_claim_is_stalled_only_in_progress_and_without_a_recent_heartbeat() -> None:
    at = datetime(2026, 11, 10, 12, tzinfo=UTC)
    recent = (at - STALLED_AFTER + timedelta(seconds=1)).isoformat()
    old = (at - STALLED_AFTER - timedelta(seconds=1)).isoformat()
    assert not is_stalled("in_progress", recent, at)
    assert is_stalled("in_progress", old, at)
    assert is_stalled("in_progress", None, at)
    assert not is_stalled("waiting", old, at)
    assert not is_stalled("decided", None, at)


def test_starting_work_starts_the_heartbeat(client: TestClient, dana: dict[str, str]) -> None:
    start(client, CLAIM)
    worked = staff_claim(client, dana)
    assert worked["heartbeat_at"] is not None
    assert worked["stalled"] is False


def test_a_heartbeat_counts_only_on_the_claims_own_thread(client: TestClient) -> None:
    start(client, CLAIM, "thread-1")
    assert beat(client, "thread-1") == 200
    assert beat(client, "an-old-thread") == 409
    assert beat(client, "thread-1", "CLM-1002") == 409  # waiting, not in progress
    path = f"/api/agent/claims/{CLAIM}/heartbeat"
    assert client.post(path, json={"thread_id": "thread-1"}).status_code == 401


def test_a_stalled_claim_shows_in_the_queue_and_on_its_page(
    client: TestClient, dana: dict[str, str]
) -> None:
    stall(client, dana)
    assert staff_claim(client, dana)["stalled"] is True
    queue = client.get("/api/staff/claims", headers=dana).json()
    assert {c["claim_id"]: c["stalled"] for c in queue}[CLAIM] is True
    assert sum(c["stalled"] for c in queue) == 1


def test_a_handler_retries_a_stalled_claim_once(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    thread_id = stall(client, dana)["thread_id"]
    response = retry(client, dana)
    assert response.status_code == 200, response.text
    assert response.json()["stalled"] is False
    assert response.json()["recoveries"] == 1
    assert agent.calls == [("carry_on", CLAIM, thread_id)]
    assert staff_steps(client, dana)[-1]["content"].startswith(
        "Dana Whitfield carried the claim on"
    )
    assert retry(client, dana).status_code == 409  # carried on, so no longer stalled
    assert len(agent.calls) == 1


def test_only_a_stalled_claim_can_be_retried(client: TestClient, dana: dict[str, str]) -> None:
    assert retry(client, dana).status_code == 409  # waiting
    start(client, CLAIM)
    assert retry(client, dana).status_code == 409  # in progress, heartbeat fresh
    missing = client.post("/api/staff/claims/CLM-999999/retry", headers=dana)
    assert missing.status_code == 404


@pytest.mark.parametrize(("failure", "code"), [("unreachable", 503), ("refusing", 502)])
def test_a_retry_the_agent_doesnt_take_leaves_the_claim_stalled(
    client: TestClient, dana: dict[str, str], agent: FakeAgent, failure: str, code: int
) -> None:
    stall(client, dana)
    getattr(agent, failure)()
    assert retry(client, dana).status_code == code
    after = staff_claim(client, dana)
    assert after["stalled"] is True
    assert after["recoveries"] == 0
    assert not any("carried the claim on" in s["content"] for s in staff_steps(client, dana))


def test_two_retries_racing_start_the_work_once(
    client: TestClient, dana: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    stall(client, dana)
    with engine_of(client).connect() as db:
        stale = find_claim(db, CLAIM)
    # Another retry takes it between this one reading the claim and taking it.
    assert retry(client, dana).status_code == 200

    def stale_claim(*_: object) -> RowMapping:
        return stale

    monkeypatch.setattr(recovery, "find_claim", stale_claim)
    with engine_of(client).connect() as db, pytest.raises(HTTPException) as raised:
        recovery.take_stalled(db, CLAIM)
    assert raised.value.status_code == 409
    assert "already being carried on" in str(raised.value.detail)


def test_only_a_handler_can_retry(client: TestClient, dana: dict[str, str]) -> None:
    stall(client, dana)
    customer = sign_in(client, MAYA, role="customer")
    engineer = sign_in(client, SAM, role="engineer")
    for headers in ({}, AGENT, customer, engineer):
        assert retry(client, headers).status_code in {401, 403}
    assert staff_claim(client, dana)["recoveries"] == 0


def test_the_agent_carries_its_own_stalled_claims_on_twice_at_most(
    client: TestClient, dana: dict[str, str]
) -> None:
    stall(client, dana)
    stalled = "/api/agent/stalled-claims"
    recover = f"/api/agent/claims/{CLAIM}/recover"
    assert client.get(stalled, headers=AGENT).json() == [{"claim_id": CLAIM}]
    first = client.post(recover, headers=AGENT)
    assert first.status_code == 200, first.text
    assert client.get(stalled, headers=AGENT).json() == []  # fresh heartbeat
    assert client.post(recover, headers=AGENT).status_code == 409
    age_heartbeat(client)
    assert client.post(recover, headers=AGENT).status_code == 200
    age_heartbeat(client)
    assert client.get(stalled, headers=AGENT).json() == []  # at the cap: a handler's now
    capped = client.post(recover, headers=AGENT)
    assert capped.status_code == 409
    assert "needs a handler" in capped.json()["detail"]
    assert retry(client, dana).status_code == 200  # a handler can still carry it on
    steps = staff_steps(client, dana)
    assert sum(s["content"].startswith("The agent carried") for s in steps) == 2


def test_the_agents_recovery_routes_need_its_key(client: TestClient, dana: dict[str, str]) -> None:
    stall(client, dana)
    assert client.get("/api/agent/stalled-claims", headers=dana).status_code == 401
    assert client.post(f"/api/agent/claims/{CLAIM}/recover", headers=dana).status_code == 401


def test_evaluation_copies_are_left_to_their_run(client: TestClient, dana: dict[str, str]) -> None:
    stall(client, dana)
    with engine_of(client).begin() as db:
        db.execute(update(claims).where(claims.c.claim_id == CLAIM).values(source="evaluation"))
    assert client.get("/api/agent/stalled-claims", headers=AGENT).json() == []


def test_the_stall_route_moves_only_a_waiting_claim(
    client: TestClient, dana: dict[str, str]
) -> None:
    start(client, CLAIM)
    assert client.post(f"/api/staff/dev/claims/{CLAIM}/stall", headers=dana).status_code == 409
    assert client.post("/api/staff/dev/claims/CLM-1002/stall").status_code == 401


def test_the_stall_route_is_only_on_the_laptop(database_url: str) -> None:
    issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_"
    settings = make_settings(
        database_url,
        environment="dev",
        local_sign_in=False,
        handler_password=None,
        staff_token_issuer=f"{issuer}staff",
        customer_token_issuer=f"{issuer}customers",
        engineering_token_issuer=f"{issuer}engineering",
    )
    client = TestClient(create_app(settings, agent_service=FakeAgent()))
    assert client.post(f"/api/staff/dev/claims/{CLAIM}/stall").status_code == 404
