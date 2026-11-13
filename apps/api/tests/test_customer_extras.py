"""What the portal adds around a claim: what we ask a customer for, the messages we send, where
payouts go, one-tap flight-delay claims and claims saved to finish later. Each customer reaches
only their own."""

from typing import Any

import pytest
from api_helpers import AGENT, MAYA, OLIVER, line, payout, png, sign_in, start
from fastapi.testclient import TestClient

from undercover_api.payments import mask_payid

PNG = png()
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


def test_a_customer_sees_what_each_trip_covers(
    client: TestClient, oliver: dict[str, str], maya: dict[str, str]
) -> None:
    cover = client.get("/api/customer/cover", headers=oliver).json()
    by_trip = {c["policy_id"]: c for c in cover}
    assert by_trip["POL-2006"]["plan"]["trip_delay_waiting_hours"] == 3
    assert {c["policy_id"] for c in client.get("/api/customer/cover", headers=maya).json()} == {
        "POL-2001"
    }


# --- Decision letters ---


def approve_and_pay(client: TestClient, claim_id: str) -> None:
    start(client, claim_id)
    amount = payout(client, claim_id, "baggage", [line("Suitcase", 400)])["payout"]
    client.post(
        f"/api/agent/claims/{claim_id}/decision",
        json={
            "decision": "approve",
            "payout": amount,
            "section": "Policy wording 10",
            "reason": "Covered.",
            "maker": "claim_agent",
        },
        headers=AGENT,
    )
    client.post(f"/api/agent/claims/{claim_id}/payment", json={"amount": amount}, headers=AGENT)


def test_a_handler_drafts_edits_and_sends_a_decision_letter(
    client: TestClient, dana: dict[str, str], maya: dict[str, str], agent: Any
) -> None:
    path = "/api/staff/claims/CLM-1001/letter"
    assert client.post(f"{path}/draft", headers=dana).status_code == 409  # not decided yet
    approve_and_pay(client, "CLM-1001")
    drafted = client.post(f"{path}/draft", headers=dana)
    assert drafted.status_code == 200, drafted.text
    assert drafted.json()["subject"] == "Your claim is approved"
    assert agent.letters[0]["decision"] == "approve"
    assert agent.letters[0]["first_name"] == "Maya"
    letter = {"subject": "Good news", "body": "Dear Maya, it's paid.", "drafted_by_ai": True}
    sent = client.put(path, json=letter, headers=dana)
    assert sent.status_code == 200, sent.text
    assert sent.json()["letter"]["sent_by"] == "Dana Whitfield"
    mine = client.get("/api/customer/claims/CLM-1001", headers=maya).json()
    assert mine["letter"]["body"] == "Dear Maya, it's paid."
    assert any(n["subject"] == "Good news" for n in notices(client, maya))
    assert client.put(path, json=letter, headers=maya).status_code == 401


def test_a_referral_gets_no_letter(client: TestClient, dana: dict[str, str]) -> None:
    refer(client, "CLM-1001", [])
    assert client.post("/api/staff/claims/CLM-1001/letter/draft", headers=dana).status_code == 409


# --- Ask UnderCover ---


def test_ask_undercover_sends_only_the_customers_own_records(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str], agent: Any
) -> None:
    asked = client.post(
        "/api/customer/ask", json={"question": "Am I covered for delays?"}, headers=maya
    )
    assert asked.status_code == 200, asked.text
    assert asked.json()["sources"] == ["Policy wording section 6"]
    sent = agent.questions[0]
    assert sent["first_name"] == "Maya"
    assert {p["policy_id"] for p in sent["policies"]} == {"POL-2001"}
    assert all(c["claim_id"] != "CLM-1005" for c in sent["claims"])  # Oliver's, never Maya's
    too_long = client.post("/api/customer/ask", json={"question": "x" * 600}, headers=maya)
    assert too_long.status_code == 422
    assert client.post("/api/customer/ask", json={"question": "hi"}).status_code == 401


def test_ask_undercover_answers_about_the_claim_on_screen_only_if_its_the_customers(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str], agent: Any
) -> None:
    question = {"question": "What's holding this up?", "about": "CLM-1005"}
    assert client.post("/api/customer/ask", json=question, headers=oliver).status_code == 200
    assert agent.questions[-1]["about"] == "CLM-1005"
    # Another customer's claim number is ignored, never looked up or passed on.
    assert client.post("/api/customer/ask", json=question, headers=maya).status_code == 200
    assert agent.questions[-1]["about"] == ""
    odd = {"question": "hi", "about": "DROP TABLE"}
    assert client.post("/api/customer/ask", json=odd, headers=maya).status_code == 422


def test_wattle_shows_a_claim_it_names_only_if_its_the_customers(
    client: TestClient, maya: dict[str, str], oliver: dict[str, str], agent: Any
) -> None:
    def naming(request: dict[str, object]) -> dict[str, object]:
        agent.questions.append(request)
        return {
            "answer": "Here it is.",
            "sources": [],
            "action": "show_claim",
            "claim_id": "CLM-1005",
            "replies": ["Thanks"],
            "screened": False,
        }

    agent.ask = naming
    mine = client.post("/api/customer/ask", json={"question": "my passport claim"}, headers=oliver)
    assert (mine.json()["action"], mine.json()["claim_id"]) == ("show_claim", "CLM-1005")
    # Oliver's claim, named to Maya: she gets her own list instead, never his claim.
    theirs = client.post("/api/customer/ask", json={"question": "CLM-1005"}, headers=maya)
    assert (theirs.json()["action"], theirs.json()["claim_id"]) == ("show_claims", "")


def test_a_customer_changes_their_mobile_and_stops_texts(
    client: TestClient, oliver: dict[str, str]
) -> None:
    shown = client.get("/api/customer/settings", headers=oliver).json()
    assert shown == {
        "email": "oliver.grant@example.com",
        "mobile": "+1 303 555 0109",
        "text_updates": True,
    }
    changed = client.put(
        "/api/customer/settings",
        json={"mobile": "0412 345 678", "text_updates": False},
        headers=oliver,
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["mobile"] == "0412 345 678"
    assert client.get("/api/customer/settings", headers=oliver).json()["text_updates"] is False
    for bad in ("call me", "1    1", "+", "0412-345-678"):
        sent = {"mobile": bad, "text_updates": True}
        assert client.put("/api/customer/settings", json=sent, headers=oliver).status_code == 422
    cleared = {"mobile": "", "text_updates": False}
    assert client.put("/api/customer/settings", json=cleared, headers=oliver).json()["mobile"] == ""
    assert client.get("/api/customer/settings").status_code == 401


def test_with_texts_off_only_the_email_goes(
    client: TestClient, oliver: dict[str, str], database_url: str
) -> None:
    from undercover_api.db import make_engine  # noqa: PLC0415 - only this test writes directly
    from undercover_api.notices import EMAIL, SMS, send  # noqa: PLC0415 - the module under test

    client.put(
        "/api/customer/settings",
        json={"mobile": "0412 345 678", "text_updates": False},
        headers=oliver,
    )
    engine = make_engine(database_url)
    with engine.begin() as db:
        send(db, "CUS-3005", "CLM-1005", EMAIL, "Paid", "We've paid.")
        send(db, "CUS-3005", "CLM-1005", SMS, "Paid", "We've paid.")
    engine.dispose()
    sent = client.get("/api/customer/notices", headers=oliver).json()
    assert [n["channel"] for n in sent if n["subject"] == "Paid"] == ["email"]


def test_wattle_for_engineers_sends_a_read_only_snapshot_and_named_traces(
    client: TestClient, sam: dict[str, str], maya: dict[str, str], agent: Any
) -> None:
    asked = client.post(
        "/api/engineering/ask", json={"question": "Explain clm-1001 and CLM-9999"}, headers=sam
    )
    assert asked.status_code == 200, asked.text
    sent = agent.explained[0]
    assert sent["first_name"] == "Sam"
    assert set(sent["traces"]) == {"CLM-1001"}
    assert {"runs", "rounds", "redteam", "threats"} <= set(sent)
    assert (
        client.post("/api/engineering/ask", json={"question": "hi"}, headers=maya).status_code
        == 401
    )
