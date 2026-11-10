from api_helpers import AGENT, FakeAgent
from fastapi.testclient import TestClient


def start(client: TestClient, headers: dict[str, str], concurrency: int = 3):  # noqa: ANN201
    return client.post("/api/staff/dispatches", json={"concurrency": concurrency}, headers=headers)


def test_a_senior_handler_dispatches_the_waiting_claims_oldest_first(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    response = start(client, dana)
    assert response.status_code == 201, response.text
    dispatch = response.json()
    assert dispatch["status"] == "running"
    assert dispatch["not_started"] == len(dispatch["claims"]) > 0
    kind, dispatch_id, ids = agent.calls[-1]
    assert (kind, dispatch_id) == ("dispatch", str(dispatch["dispatch_id"]))
    assert ids == ",".join(c["claim_id"] for c in dispatch["claims"])
    assert not any(c["claim_id"].startswith("CLM-9") for c in dispatch["claims"])

    assert start(client, dana).status_code == 409
    finished = client.post(f"/api/agent/dispatches/{dispatch_id}/finish", headers=AGENT)
    assert finished.json()["status"] == "finished"
    latest = client.get("/api/staff/dispatches/latest", headers=dana).json()
    assert latest["dispatch"]["dispatch_id"] == dispatch["dispatch_id"]


def test_only_a_senior_handler_starts_one_but_every_handler_sees_it(
    client: TestClient, marcus: dict[str, str], sam: dict[str, str]
) -> None:
    assert start(client, marcus).status_code == 403
    assert start(client, sam).status_code == 401
    assert start(client, {}).status_code == 401
    assert client.post(
        "/api/staff/dispatches", json={"concurrency": 26}, headers=marcus
    ).status_code in (403, 422)
    latest = client.get("/api/staff/dispatches/latest", headers=marcus)
    assert latest.status_code == 200
    assert latest.json()["dispatch"] is None
    assert latest.json()["waiting"] > 0
    assert client.post("/api/agent/dispatches/1/finish", headers=marcus).status_code == 401


def test_a_dispatch_the_agent_wont_take_is_stopped_with_why(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    agent.unreachable()
    assert start(client, dana).status_code == 503
    latest = client.get("/api/staff/dispatches/latest", headers=dana).json()["dispatch"]
    assert latest["status"] == "stopped"
    assert "isn't answering" in latest["stopped_reason"]
