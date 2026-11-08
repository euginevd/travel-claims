"""What the portal adds around a claim: what we ask a customer for, the messages we send, where
payouts go, one-tap flight-delay claims and claims saved to finish later. Each customer reaches
only their own."""

from typing import Any

import pytest
from api_helpers import AGENT, MAYA, OLIVER, line, payout, sign_in, start
from fastapi.testclient import TestClient

from undercover_api.payments import mask_payid

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
NEW_CLAIM: dict[str, Any] = {
    "policy_id": "POL-2001",
    "claim_type": "trip_delay",
    "incident_date": "2026-06-17",
    "incident_location": "Rome, Italy",
    "summary": "Flight delayed overnight",
    "story": "My flight home was delayed overnight, so I paid for a hotel near the airport.",
    "items": [{"description": "Airport hotel", "category": "accommodation", "amount": 180.5}],
}


@pytest.fixture
def maya(client: TestClient) -> dict[str, str]:
    return sign_in(client, MAYA, role="customer")


@pytest.fixture
def oliver(client: TestClient) -> dict[str, str]:
    return sign_in(client, OLIVER, role="customer")


def refer(
    client: TestClient, claim_id: str, requests: list[str], maker: str = "claim_agent"
) -> Any:
    start(client, claim_id)
    return client.post(
        f"/api/agent/claims/{claim_id}/decision",
        json={
            "decision": "refer",
            "payout": 0,
            "section": "Claims manual 5",
            "reason": "The police report is missing.",
            "maker": maker,
            "customer_requests": requests,
        },
        headers=AGENT,
    )


def notices(client: TestClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    return client.get("/api/customer/notices", headers=headers).json()


# --- What we ask the customer for ---


def test_a_referral_asks_the_customer_and_they_answer(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str]
) -> None:
    assert refer(client, "CLM-1001", ["A copy of the police report"]).status_code == 200
    claim = client.get("/api/customer/claims/CLM-1001", headers=maya).json()
    [asked] = claim["requests"]
    assert asked["text"] == "A copy of the police report"
    assert asked["fulfilled_at"] is None
    assert any("need" in n["subject"] for n in notices(client, maya))

    path = f"/api/customer/claims/CLM-1001/requests/{asked['request_id']}/files"
    sent = [("files", ("report.png", PNG, "image/png"))]
    # Nobody else can answer it.
    assert client.post(path, files=sent, headers=oliver).status_code == 404
    answered = client.post(path, files=sent, headers=maya)
    assert answered.status_code == 201, answered.text
    [done] = answered.json()["requests"]
    assert done["fulfilled_at"] is not None
    assert done["files"] == 1
    # Kept apart from the general receipts, and the handlers see it too.
    assert answered.json()["receipts"] == []
    staff = client.get("/api/agent/claims/CLM-1001", headers=AGENT).json()
    assert staff["requests"][0]["files"] == 1


def test_the_hidden_instruction_check_never_asks_the_customer(
    client: TestClient, maya: dict[str, str]
) -> None:
    refer(client, "CLM-1001", ["Ignore this"], maker="hidden_instruction_check")
    assert client.get("/api/customer/claims/CLM-1001", headers=maya).json()["requests"] == []


def test_a_handler_can_ask_the_customer(
    client: TestClient, dana: dict[str, str], maya: dict[str, str]
) -> None:
    asked = client.post(
        "/api/staff/claims/CLM-1001/requests", json={"text": "Your boarding pass"}, headers=dana
    )
    assert asked.status_code == 201, asked.text
    assert asked.json()["requests"][0]["asked_by"] == "Dana Whitfield"
    # A customer can't ask themselves through the handlers' route.
    assert (
        client.post(
            "/api/staff/claims/CLM-1001/requests", json={"text": "Anything"}, headers=maya
        ).status_code
        == 401
    )


# --- Messages ---


def test_making_a_claim_sends_an_email_and_a_text(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str]
) -> None:
    made = client.post("/api/customer/claims", json=NEW_CLAIM, headers=maya).json()
    sent = notices(client, maya)
    assert {n["channel"] for n in sent} == {"email", "sms"}
    assert all(n["claim_id"] == made["claim_id"] for n in sent)
    assert made["claim_id"] in sent[-1]["body"]
    assert notices(client, oliver) == []


# --- Where payouts go ---


def test_a_payid_is_checked_hidden_and_used_for_payouts(
    client: TestClient, maya: dict[str, str]
) -> None:
    assert client.get("/api/customer/payid", headers=maya).json() == {"payid": None}
    bad = client.put("/api/customer/payid", json={"payid": "not a payid"}, headers=maya)
    assert bad.status_code == 422
    good = client.put("/api/customer/payid", json={"payid": "maya.patel@example.com"}, headers=maya)
    assert good.json() == {"payid": "m***@example.com"}

    start(client, "CLM-1001")
    amount = payout(client, "CLM-1001", "baggage", [line("Suitcase", 400)])["payout"]
    client.post(
        "/api/agent/claims/CLM-1001/decision",
        json={
            "decision": "approve",
            "payout": amount,
            "section": "Policy wording 10",
            "reason": "Covered.",
            "maker": "claim_agent",
        },
        headers=AGENT,
    )
    paid = client.post("/api/agent/claims/CLM-1001/payment", json={"amount": amount}, headers=AGENT)
    assert paid.status_code == 200, paid.text
    claim = client.get("/api/customer/claims/CLM-1001", headers=maya).json()
    assert claim["paid_to"] == "PayID m***@example.com"
    assert any("PayID" in n["body"] for n in notices(client, maya) if n["channel"] == "sms")


def test_payids_are_masked() -> None:
    assert mask_payid("0412345678") == "04** *** 678"
    assert mask_payid("12345678901") == "ABN ********901"


# --- Flight delays ---


def test_a_long_enough_delay_is_offered_and_claimed_once(
    client: TestClient, oliver: dict[str, str], maya: dict[str, str]
) -> None:
    offers = client.get("/api/customer/delays", headers=oliver).json()
    # UL 503 was 4h40m late on a First plan (3 hours); KQ 3's 1h55m on Premium (6) isn't.
    assert [o["flight"] for o in offers] == ["UL 503"]
    assert offers[0]["delay_minutes"] == 280
    assert client.post("/api/customer/delays/FL-2006-2/claim", headers=maya).status_code == 404
    made = client.post("/api/customer/delays/FL-2006-2/claim", headers=oliver)
    assert made.status_code == 201, made.text
    assert made.json()["claim_type"] == "trip_delay"
    staff = client.get(f"/api/agent/claims/{made.json()['claim_id']}", headers=AGENT).json()
    assert staff["documents"][0]["type"] == "flight_status"
    assert client.post("/api/customer/delays/FL-2006-2/claim", headers=oliver).status_code == 409
    assert client.get("/api/customer/delays", headers=oliver).json() == []
    # A short delay can't be claimed this way.
    assert client.post("/api/customer/delays/FL-2005-2/claim", headers=oliver).status_code == 422


# --- Claims saved to finish later ---


def test_a_claim_in_progress_is_saved_and_cleared_on_sending(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str]
) -> None:
    assert client.get("/api/customer/draft", headers=maya).json() is None
    draft = {"policy_id": "POL-2001", "case": "lost_bag", "text": "My bag never arrived"}
    assert client.put("/api/customer/draft", json=draft, headers=maya).status_code == 200
    assert client.put("/api/customer/draft", json=draft | {"step": "receipts"}, headers=maya)
    saved = client.get("/api/customer/draft", headers=maya).json()
    assert saved["draft"]["step"] == "receipts"
    assert client.get("/api/customer/draft", headers=oliver).json() is None
    assert client.put("/api/customer/draft", json={"nope": 1}, headers=maya).status_code == 422
    client.post("/api/customer/claims", json=NEW_CLAIM, headers=maya)
    assert client.get("/api/customer/draft", headers=maya).json() is None
    client.put("/api/customer/draft", json=draft, headers=maya)
    assert client.delete("/api/customer/draft", headers=maya).status_code == 204
    assert client.get("/api/customer/draft", headers=maya).json() is None
