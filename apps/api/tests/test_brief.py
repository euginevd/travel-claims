"""The case brief, override, trace, review requests and the drafting assistant."""

from typing import Any

import pytest
from api_helpers import (
    AGENT,
    MAYA,
    OLIVER,
    FakeAgent,
    decide,
    line,
    make_settings,
    payout,
    png,
    sign_in,
    start,
)
from fastapi.testclient import TestClient

from undercover_api.main import create_app

PNG = png()
CHECKS = [
    {"label": "Policy active on the date", "result": "pass", "detail": "", "source": "Policy"},
    {
        "label": "Item over the per-item limit",
        "result": "warn",
        "detail": "Capped at $500.00",
        "source": "Policy wording 10",
    },
]


def claim(client: TestClient, claim_id: str, headers: dict[str, str]) -> Any:
    return client.get(f"/api/staff/claims/{claim_id}", headers=headers).json()


def approve_with_checklist(client: TestClient, claim_id: str, item: float) -> float:
    start(client, claim_id)
    amount = payout(client, claim_id, "baggage", [line("Bag", item, quantity=5)])["payout"]
    client.post(
        f"/api/agent/claims/{claim_id}/steps",
        json={"thread_id": "thread-1", "kind": "screening", "content": "Clear", "sources": []},
        headers=AGENT,
    )
    response = client.post(
        f"/api/agent/claims/{claim_id}/decision",
        json={
            "decision": "approve",
            "payout": amount,
            "section": "Policy wording 10",
            "reason": "Covered.",
            "maker": "claim_agent",
            "checklist": CHECKS,
        },
        headers=AGENT,
    )
    assert response.status_code == 200, response.text
    return amount


def test_a_decision_keeps_its_checklist_and_the_claim_its_stages(
    client: TestClient, dana: dict[str, str]
) -> None:
    approve_with_checklist(client, "CLM-1001", 100.0)
    body = claim(client, "CLM-1001", dana)
    assert [c["result"] for c in body["decision"]["checklist"]] == ["pass", "warn"]
    stages = body["stages"]
    assert stages["received"]
    assert stages["checked"]
    assert stages["decided"]
    assert stages["paid"] is None


def test_a_held_payout_is_never_paid_without_a_handler(
    client: TestClient, dana: dict[str, str]
) -> None:
    amount = approve_with_checklist(client, "CLM-1001", 2500.0)
    assert claim(client, "CLM-1001", dana)["status"] == "waiting_for_sign_off"
    paid = client.post("/api/agent/claims/CLM-1001/payment", json={"amount": amount}, headers=AGENT)
    assert paid.status_code == 403
    assert claim(client, "CLM-1001", dana)["payment"] is None


def test_a_senior_handler_overrides_and_an_approval_pays(
    client: TestClient, dana: dict[str, str], marcus: dict[str, str]
) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    body = {"decision": "approve", "payout": 150.0, "reason_code": "evidence", "note": "Receipt ok"}
    refused = client.post("/api/staff/claims/CLM-1001/override", json=body, headers=marcus)
    assert refused.status_code == 403
    done = client.post("/api/staff/claims/CLM-1001/override", json=body, headers=dana).json()
    assert done["decision"]["override"]["previous_decision"] == "decline"
    assert done["decision"]["decided_by"] == "Dana Whitfield"
    assert done["payment"]["amount"] == 150.0
    again = client.post("/api/staff/claims/CLM-1001/override", json=body, headers=dana)
    assert again.status_code == 409


def test_an_override_never_pays_more_than_was_claimed(
    client: TestClient, dana: dict[str, str]
) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    claimed = claim(client, "CLM-1001", dana)["amount_claimed"]
    body = {"decision": "approve", "payout": 900_000.0, "reason_code": "evidence", "note": "Ok"}
    refused = client.post("/api/staff/claims/CLM-1001/override", json=body, headers=dana)
    assert refused.status_code == 422
    assert "at most" in refused.json()["detail"]
    assert claim(client, "CLM-1001", dana)["payment"] is None
    over = {**body, "payout": claimed + 0.01}
    assert (
        client.post("/api/staff/claims/CLM-1001/override", json=over, headers=dana).status_code
        == 422
    )
    exact = {**body, "payout": claimed}
    done = client.post("/api/staff/claims/CLM-1001/override", json=exact, headers=dana)
    assert done.status_code == 200, done.text
    assert done.json()["payment"]["amount"] == claimed


def test_an_override_must_pay_only_an_approval(client: TestClient, dana: dict[str, str]) -> None:
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "refer")
    body = {"decision": "decline", "payout": 50.0, "reason_code": "other", "note": "No"}
    response = client.post("/api/staff/claims/CLM-1001/override", json=body, headers=dana)
    assert response.status_code == 422


def test_the_trace_lists_steps_and_model_calls(client: TestClient, dana: dict[str, str]) -> None:
    approve_with_checklist(client, "CLM-1001", 100.0)
    client.post(
        "/api/agent/claims/CLM-1001/model-calls",
        json={
            "thread_id": "thread-1",
            "model": "claude-haiku-5-5",
            "input_tokens": 100,
            "output_tokens": 20,
            "cost": 0.0002,
            "latency_ms": 850,
        },
        headers=AGENT,
    )
    trace = client.get("/api/staff/claims/CLM-1001/trace", headers=dana).json()
    assert trace["model_calls"][0]["latency_ms"] == 850
    assert trace["total_tokens"] == 120
    assert trace["steps"][0]["kind"] == "screening"


@pytest.fixture
def maya(client: TestClient) -> dict[str, str]:
    return sign_in(client, MAYA, role="customer")


def test_a_customer_asks_for_a_person_once_their_claim_is_decided(
    client: TestClient, maya: dict[str, str], dana: dict[str, str]
) -> None:
    made = client.post(
        "/api/customer/claims",
        json={
            "policy_id": "POL-2001",
            "claim_type": "trip_delay",
            "incident_date": "2026-06-17",
            "incident_location": "Rome, Italy",
            "summary": "Flight delayed",
            "story": "Delayed overnight.",
            "items": [{"description": "Hotel", "category": "accommodation", "amount": 100.0}],
        },
        headers=maya,
    ).json()
    claim_id = made["claim_id"]
    early = client.post(f"/api/customer/claims/{claim_id}/review-request", json={}, headers=maya)
    assert early.status_code == 409
    start(client, claim_id)
    decide(client, claim_id, "decline")
    asked = client.post(
        f"/api/customer/claims/{claim_id}/review-request", json={"note": "Please"}, headers=maya
    ).json()
    assert asked["review_requested"] is True
    assert asked["can_request_review"] is False
    queue = client.get("/api/staff/claims", headers=dana).json()
    assert next(c for c in queue if c["claim_id"] == claim_id)["review_requested"] is True


def test_another_customer_cant_ask_for_a_review(client: TestClient) -> None:
    oliver = sign_in(client, OLIVER, role="customer")
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    response = client.post("/api/customer/claims/CLM-1001/review-request", json={}, headers=oliver)
    assert response.status_code == 404


def draft(client: TestClient, headers: dict[str, str], **form: str) -> Any:
    return client.post(
        "/api/customer/drafts",
        data={"policy_id": "POL-2001"} | form,
        files=[("files", ("r.png", PNG, "image/png"))],
        headers=headers,
    )


def test_the_assistant_drafts_from_a_receipt_and_a_few_words(
    client: TestClient, maya: dict[str, str], agent: FakeAgent
) -> None:
    response = draft(client, maya, text="bag lost", case="lost_bag")
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["source"] == "Receipt 1"
    sent = agent.drafts[0]
    assert sent["case"] == "lost_bag"
    assert sent["receipts"][0]["media_type"] == "image/png"  # type: ignore[index]


def test_a_draft_that_doesnt_make_sense_is_refused(
    client: TestClient, maya: dict[str, str], agent: FakeAgent
) -> None:
    agent.draft_answer = {"summary": "x" * 500}
    assert draft(client, maya, text="bag").status_code == 502


def test_drafts_are_limited_per_customer(client: TestClient, maya: dict[str, str]) -> None:
    codes = [draft(client, maya, text="bag").status_code for _ in range(11)]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429


def test_a_draft_is_only_on_the_customers_own_policy(
    client: TestClient, maya: dict[str, str]
) -> None:
    response = client.post(
        "/api/customer/drafts", data={"policy_id": "POL-2002", "text": "bag"}, headers=maya
    )
    assert response.status_code == 404


def test_the_test_buttons_sign_in_only_the_fixed_accounts(client: TestClient) -> None:
    senior = client.post("/api/staff/dev/test-sign-in", json={"account": "senior"})
    assert senior.status_code == 200
    headers = {"Authorization": f"Bearer {senior.json()['id_token']}"}
    assert client.get("/api/staff/me", headers=headers).json()["can_approve_over_limit"] is True
    customer = client.post("/api/customer/dev/test-sign-in", json={"account": "customer"})
    headers = {"Authorization": f"Bearer {customer.json()['id_token']}"}
    assert client.get("/api/customer/profile", headers=headers).json()["name"] == "Oliver Grant"
    assert client.post("/api/staff/dev/test-sign-in", json={"account": "nobody"}).status_code == 404
    other = client.post("/api/customer/dev/test-sign-in", json={"account": "senior"})
    assert other.status_code == 404


def test_the_red_team_signs_in_as_its_own_customer_only(client: TestClient) -> None:
    attacker = client.post("/api/customer/dev/redteam-sign-in", json={"account": "attacker"})
    assert attacker.status_code == 200
    headers = {"Authorization": f"Bearer {attacker.json()['id_token']}"}
    assert client.get("/api/customer/profile", headers=headers).json()["name"] == "Derek Vance"
    # The portal's test button can't become the attacker, and the red team can't become Oliver.
    body = {"account": "attacker"}
    assert client.post("/api/customer/dev/test-sign-in", json=body).status_code == 404
    body = {"account": "customer"}
    assert client.post("/api/customer/dev/redteam-sign-in", json=body).status_code == 404


def test_the_test_buttons_dont_exist_without_local_sign_in(database_url: str) -> None:
    settings = make_settings(
        database_url,
        local_sign_in=False,
        staff_token_issuer="https://staff.example",
        customer_token_issuer="https://customer.example",
    )
    with TestClient(create_app(settings, agent_service=FakeAgent())) as remote:
        body = {"account": "senior"}
        assert remote.post("/api/staff/dev/test-sign-in", json=body).status_code == 404
        assert remote.post("/api/customer/dev/test-sign-in", json=body).status_code == 404
