"""Handlers deciding referrals, the agent switch, the demo reset and the senior's spot check."""

from api_helpers import AGENT, FakeAgent, decide, start
from fastapi.testclient import TestClient

APPROVE = {"decision": "approve", "payout": 150.0, "reason_code": "evidence", "note": "Receipt ok"}


def test_a_handler_decides_a_referral_within_the_limit(
    client: TestClient, marcus: dict[str, str]
) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "refer")
    done = client.post("/api/staff/claims/CLM-1001/decide", json=APPROVE, headers=marcus).json()
    assert done["decision"]["override"]["previous_decision"] == "refer"
    assert done["payment"]["amount"] == 150.0
    over = APPROVE | {"payout": 9000.0}
    start(client, "CLM-1002")
    decide(client, "CLM-1002", "refer")
    refused = client.post("/api/staff/claims/CLM-1002/decide", json=over, headers=marcus)
    assert refused.status_code == 403
    # Only a referral: a decided approval is a senior's to override.
    start(client, "CLM-1003")
    decide(client, "CLM-1003", "decline")
    not_referred = client.post("/api/staff/claims/CLM-1003/decide", json=APPROVE, headers=marcus)
    assert not_referred.status_code == 409


def test_the_agent_switch_is_a_seniors_and_starts_the_watcher(
    client: TestClient, dana: dict[str, str], marcus: dict[str, str], agent: FakeAgent
) -> None:
    assert client.get("/api/staff/agent", headers=marcus).json()["on"] is False
    assert client.put("/api/staff/agent", json={"on": True}, headers=marcus).status_code == 403
    on = client.put("/api/staff/agent", json={"on": True}, headers=dana).json()
    assert on["on"] is True
    assert ("watch", "5", None) in agent.calls
    ready = client.get("/api/agent/queue/ready", headers=AGENT).json()
    assert ready["on"] is True
    assert "CLM-1001" in ready["claim_ids"]
    client.put("/api/staff/agent", json={"on": False}, headers=dana)
    assert client.get("/api/agent/queue/ready", headers=AGENT).json() == {
        "on": False,
        "concurrency": 0,
        "claim_ids": [],
    }


def test_a_reset_puts_claims_back_to_waiting(client: TestClient, dana: dict[str, str]) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    assert client.get("/api/staff/demo/reset", headers=dana).json()["claims_worked"] == 1
    client.put("/api/staff/agent", json={"on": True}, headers=dana)
    kept_on = {"claims": True, "agent_off": False}
    blocked = client.post("/api/staff/demo/reset", json=kept_on, headers=dana)
    assert blocked.status_code == 409
    # The defaults turn the agent and payouts off as part of the reset.
    done = client.post("/api/staff/demo/reset", json={"claims": True}, headers=dana).json()
    assert done["claims_worked"] == 0
    assert (done["agent_on"], done["payouts_paused"]) == (False, True)
    claim = client.get("/api/staff/claims/CLM-1001", headers=dana).json()
    assert claim["status"] == "waiting"
    assert claim["decision"] is None


def test_a_senior_spot_checks_a_claim_once(client: TestClient, dana: dict[str, str]) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    insights = client.get("/api/staff/insights", headers=dana).json()
    assert insights["noticed"][0]["headline"] == "Handlers kept 1 of the agent's last 1 decisions."
    body = {"verdict": "right"}
    path = "/api/staff/claims/CLM-1001/spot-check"
    assert client.post(path, json=body, headers=dana).status_code == 201
    assert client.post(path, json=body, headers=dana).status_code == 409
