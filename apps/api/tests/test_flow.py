"""A claim's way through decision, payment, hold, sign-off and send-back."""

from typing import Any

from api_helpers import AGENT, decide, line, payout, start
from fastapi.testclient import TestClient


def claim(client: TestClient, claim_id: str) -> dict[str, Any]:
    return client.get(f"/api/claims/{claim_id}", headers=AGENT).json()


def approve(client: TestClient, claim_id: str, benefit: str, amount: float, kind: str) -> float:
    start(client, claim_id)
    worked = payout(client, claim_id, benefit, [line("Covered costs", amount, kind=kind)])
    response = decide(client, claim_id, "approve", worked["payout"])
    assert response.status_code == 200, response.text
    return worked["payout"]


def pay(client: TestClient, claim_id: str, amount: float) -> int:
    return client.post(
        f"/api/agent/claims/{claim_id}/payment", json={"amount": amount}, headers=AGENT
    ).status_code


def test_an_approval_under_the_limit_is_paid_once(client: TestClient) -> None:
    amount = approve(client, "CLM-1001", "trip_delay", 420, "expense")
    assert pay(client, "CLM-1001", amount) == 200
    paid = claim(client, "CLM-1001")
    assert paid["status"] == "decided"
    assert paid["payment"] == {
        "amount": amount,
        "paid_at": paid["payment"]["paid_at"],
        "signed_off_by": None,
    }
    assert pay(client, "CLM-1001", amount) == 200  # the same payment again changes nothing
    assert pay(client, "CLM-1001", amount - 1) == 409


def test_a_payment_over_the_limit_is_refused_before_the_claim_is_read(client: TestClient) -> None:
    assert pay(client, "CLM-NOT-REAL", 1000.01) == 403


def test_the_payment_must_be_the_approved_payout(client: TestClient) -> None:
    amount = approve(client, "CLM-1001", "trip_delay", 420, "expense")
    assert pay(client, "CLM-1001", amount - 20) == 422


def test_nothing_is_paid_without_an_approval(client: TestClient) -> None:
    start(client, "CLM-1001")
    assert decide(client, "CLM-1001", "decline").status_code == 200
    assert pay(client, "CLM-1001", 100) == 409


def test_an_approval_over_the_limit_waits_for_sign_off(
    client: TestClient, dana: dict[str, str]
) -> None:
    amount = approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    assert claim(client, "CLM-1003")["status"] == "waiting_for_sign_off"
    assert pay(client, "CLM-1003", amount) == 403
    signed = client.post("/api/claims/CLM-1003/sign-off", headers=dana)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["status"] == "decided"
    assert body["payment"]["signed_off_by"] == "Dana Whitfield"
    assert body["decision"]["signed_off_by"] == "Dana Whitfield"
    assert client.post("/api/claims/CLM-1003/sign-off", headers=dana).status_code == 409


def test_only_a_senior_handler_signs_off(client: TestClient, marcus: dict[str, str]) -> None:
    approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    assert client.post("/api/claims/CLM-1003/sign-off", headers=marcus).status_code == 403
    sent = client.post("/api/claims/CLM-1003/send-back", json={"note": "Check"}, headers=marcus)
    assert sent.status_code == 403
    assert claim(client, "CLM-1003")["payment"] is None


def test_a_send_back_keeps_the_decision_with_the_note(
    client: TestClient, dana: dict[str, str]
) -> None:
    approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    note = "Check the hospital invoice against the plan maximum."
    sent = client.post("/api/claims/CLM-1003/send-back", json={"note": note}, headers=dana)
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert (body["status"], body["decision"], body["payment"]) == ("sent_back", None, None)
    [returned] = body["sent_back_decisions"]
    assert (returned["note"], returned["sent_back_by"]) == (note, "Dana Whitfield")
    assert returned["decision"]["decision"] == "approve"
    took = client.post("/api/agent/claims/CLM-1003/take", headers=AGENT)
    assert took.json()["status"] == "in_progress"
    # The old calculation went with the decision: a new approval needs its own.
    assert decide(client, "CLM-1003", "approve", 3750).status_code == 422


def test_a_note_over_1000_characters_is_refused(client: TestClient, dana: dict[str, str]) -> None:
    approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    sent = client.post("/api/claims/CLM-1003/send-back", json={"note": "x" * 1001}, headers=dana)
    assert sent.status_code == 422


def test_section_14_refusals(client: TestClient) -> None:
    start(client, "CLM-1001")
    no_calculation = decide(client, "CLM-1001", "approve", 420)
    assert no_calculation.status_code == 422
    assert "Claims manual section 14" in no_calculation.json()["detail"]
    payout(client, "CLM-1001", "trip_delay", [line("Taxis", 80, kind="expense")])
    wrong = decide(client, "CLM-1001", "approve", 81)
    assert "the payout must be the calculation's $80.00" in wrong.json()["detail"]
    assert decide(client, "CLM-1001", "decline", 10).status_code == 422
    blank = client.post(
        "/api/agent/claims/CLM-1001/decision",
        json={"decision": "refer", "payout": 0, "section": " ", "reason": "r", "decided_by": "a"},
        headers=AGENT,
    )
    assert "the section relied on" in blank.json()["detail"]


def test_a_decision_records_the_manual_version_and_maker(client: TestClient) -> None:
    approve(client, "CLM-1001", "trip_delay", 80, "expense")
    decision = claim(client, "CLM-1001")["decision"]
    assert decision["manual_version"] == "2026.2"
    assert decision["decided_by"] == "UnderCover Agent v1"
    assert decision["calculation"]["payout"] == 80.0


def test_a_decision_is_recorded_once(client: TestClient) -> None:
    start(client, "CLM-1001")
    assert decide(client, "CLM-1001", "refer").status_code == 200
    assert decide(client, "CLM-1001", "refer").status_code == 200  # the same again is fine
    assert decide(client, "CLM-1001", "decline").status_code == 409


def test_a_claim_starts_once(client: TestClient) -> None:
    start(client, "CLM-1001")
    again = client.post("/api/agent/claims/CLM-1001/start", json={"thread_id": "t2"}, headers=AGENT)
    assert again.status_code == 409


def test_a_payout_needs_a_claim_in_progress(client: TestClient) -> None:
    response = client.post(
        "/api/agent/claims/CLM-1001/payout",
        json={"benefit": "trip_delay", "lines": [], "paid_by_others": 0},
        headers=AGENT,
    )
    assert response.status_code == 409


def test_a_hold_waits_for_sign_off(client: TestClient) -> None:
    approve(client, "CLM-1001", "trip_delay", 80, "expense")
    held = client.post(
        "/api/agent/claims/CLM-1001/hold", json={"reason": "Gateway said no"}, headers=AGENT
    )
    assert held.json()["status"] == "waiting_for_sign_off"
    assert held.json()["decision"]["hold_reason"] == "Gateway said no"
    again = client.post("/api/agent/claims/CLM-1001/hold", json={"reason": "again"}, headers=AGENT)
    assert again.status_code == 200
    assert pay(client, "CLM-1001", 80) == 403


def test_a_hold_needs_an_approval(client: TestClient) -> None:
    start(client, "CLM-1001")
    held = client.post("/api/agent/claims/CLM-1001/hold", json={"reason": "x"}, headers=AGENT)
    assert held.status_code == 409


def test_steps_and_model_calls_are_recorded(client: TestClient) -> None:
    start(client, "CLM-1001")
    source = {"file": "claims_manual.md", "system": "s", "owner": "o", "reviewed": "2026-09-01"}
    step = client.post(
        "/api/agent/claims/CLM-1001/steps",
        json={
            "thread_id": "thread-1",
            "kind": "lookup",
            "content": "Read section 14",
            "sources": [source],
        },
        headers=AGENT,
    )
    assert step.status_code == 201
    call = client.post(
        "/api/agent/claims/CLM-1001/model-calls",
        json={
            "thread_id": "thread-1",
            "model": "claude-sonnet-5-5",
            "input_tokens": 10,
            "output_tokens": 5,
            "cost": 0.0001,
        },
        headers=AGENT,
    )
    assert call.status_code == 201


def test_the_agent_reads_only_its_claims_policy_and_history(client: TestClient) -> None:
    policy = client.get("/api/agent/claims/CLM-1001/policy", headers=AGENT).json()
    history = client.get("/api/agent/claims/CLM-1001/history", headers=AGENT).json()
    assert policy["policy_id"] == "POL-2001"
    assert [c["claim_id"] for c in history] == ["CLM-0412"]
    assert client.get("/api/agent/claims/CLM-9999/policy", headers=AGENT).status_code == 404


def test_the_queue_lists_every_claim(client: TestClient, marcus: dict[str, str]) -> None:
    queue = client.get("/api/claims", headers=marcus).json()
    assert len(queue) == 26
    assert {c["status"] for c in queue} == {"waiting"}
