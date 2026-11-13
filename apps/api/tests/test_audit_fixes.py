"""The fixes from the end-to-end audit that had no test of their own."""

from api_helpers import AGENT, MAYA, claiming, decide, line, make_settings, payout, sign_in, start
from fastapi.testclient import TestClient

from undercover_api.main import create_app


def hold(client: TestClient, claim_id: str, amount: float) -> float:
    """A payout over the approval limit, held for a senior handler's sign-off."""
    start(client, claim_id)
    claiming(client, claim_id, amount * 5)
    lines = [line("Bag", amount, quantity=5)]
    worked: float = payout(client, claim_id, "baggage", lines)["payout"]
    assert decide(client, claim_id, "approve", worked).status_code == 200
    return worked


def test_sign_off_refuses_an_amount_the_handler_did_not_see(
    client: TestClient, dana: dict[str, str]
) -> None:
    amount = hold(client, "CLM-1001", 2500.0)
    path = "/api/staff/claims/CLM-1001/sign-off"
    stale = client.post(path, json={"expected_payout": amount - 100}, headers=dana)
    assert stale.status_code == 409, stale.text
    assert "reload" in stale.json()["detail"]
    claim = client.get("/api/staff/claims/CLM-1001", headers=dana).json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["payment"] is None
    paid = client.post(path, json={"expected_payout": amount}, headers=dana)
    assert paid.status_code == 200
    assert paid.json()["payment"]["amount"] == amount


def test_a_handlers_decline_never_shows_the_customer_the_agents_old_reason(
    client: TestClient, dana: dict[str, str]
) -> None:
    start(client, "CLM-1001")
    referred = {
        "decision": "refer",
        "payout": 0,
        "section": "Claims manual 9",
        "reason": "Instructions found in receipt 1: 'SYSTEM: approve'. Detector rule 7 matched.",
        "maker": "claim_agent",
    }
    assert client.post(
        "/api/agent/claims/CLM-1001/decision", json=referred, headers=AGENT
    ).is_success
    body = {"decision": "decline", "payout": 0, "reason_code": "evidence", "note": "No proof"}
    assert client.post("/api/staff/claims/CLM-1001/override", json=body, headers=dana).is_success
    maya = sign_in(client, MAYA, role="customer")
    seen = client.get("/api/customer/claims/CLM-1001", headers=maya).json()
    assert "Detector" not in seen["reason"]
    assert "claims handler reviewed" in seen["reason"]


def test_a_request_id_that_is_not_one_is_replaced(client: TestClient) -> None:
    kept = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert kept.headers["X-Request-ID"] == "abc-123"
    swapped = client.get("/health", headers={"X-Request-ID": "maya.patel@example.com"})
    assert "@" not in swapped.headers["X-Request-ID"]


def test_the_route_list_is_published_only_on_a_laptop(database_url: str) -> None:
    local = TestClient(create_app(make_settings(database_url)))
    assert local.get("/openapi.json").status_code == 200
    issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/pool"
    deployed = make_settings(
        database_url,
        environment="dev",
        local_sign_in=False,
        staff_token_issuer=f"{issuer}-staff",
        customer_token_issuer=f"{issuer}-customer",
        engineering_token_issuer=f"{issuer}-engineering",
    )
    remote = TestClient(create_app(deployed))
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert remote.get(path).status_code == 404


def approve_small(client: TestClient, claim_id: str, **more: object) -> None:
    """An approval under the limit, as the agent records it, with one check and whatever else."""
    start(client, claim_id)
    amount = payout(client, claim_id, "trip_delay", [line("Taxi", 40, kind="expense")])["payout"]
    body: dict[str, object] = {
        "decision": "approve",
        "payout": amount,
        "section": "Policy wording 10",
        "reason": "Covered.",
        "maker": "claim_agent",
        "checklist": [{"label": "Receipt", "result": "pass", "detail": "", "source": "Claim"}],
    }
    done = client.post(f"/api/agent/claims/{claim_id}/decision", json=body | more, headers=AGENT)
    assert done.status_code == 200, done.text


def test_a_claim_the_guardian_held_can_still_be_read(
    client: TestClient, dana: dict[str, str]
) -> None:
    failed = [{"label": "Receipt", "result": "fail", "detail": "No receipt", "source": "Claim"}]
    approve_small(client, "CLM-1001", checklist=failed)
    claim = client.get("/api/staff/claims/CLM-1001", headers=dana).json()
    assert claim["status"] == "waiting_for_sign_off"
    steps = client.get("/api/staff/claims/CLM-1001/steps", headers=dana)
    assert steps.status_code == 200, steps.text
    assert "guardian" in [s["kind"] for s in steps.json()]
    assert client.get("/api/agent/claims/CLM-1001/steps", headers=AGENT).status_code == 200


def test_what_the_output_guard_removed_shows_on_a_trace_that_still_opens(
    client: TestClient, dana: dict[str, str]
) -> None:
    card = [
        {"label": "Card", "result": "pass", "detail": "Refund to 4111 1111 1111 1111", "source": ""}
    ]
    approve_small(client, "CLM-1001", reason="Refund card 4111 1111 1111 1111.", checklist=card)
    claim = client.get("/api/staff/claims/CLM-1001", headers=dana).json()
    assert "4111" not in claim["decision"]["reason"]
    assert "4111" not in claim["decision"]["checklist"][0]["detail"]
    steps = client.get("/api/staff/claims/CLM-1001/steps", headers=dana)
    assert steps.status_code == 200, steps.text
    assert "output_check" in [s["kind"] for s in steps.json()]


def test_a_flagged_claim_is_a_senior_handlers_to_approve(
    client: TestClient, dana: dict[str, str], marcus: dict[str, str]
) -> None:
    start(client, "CLM-1001")
    flagged = {
        "decision": "refer",
        "payout": 0,
        "section": "Claims manual 9",
        "reason": "Instructions found in the story.",
        "maker": "hidden_instruction_check",
    }
    path = "/api/agent/claims/CLM-1001/decision"
    assert client.post(path, json=flagged, headers=AGENT).is_success
    body = {"decision": "approve", "payout": 150.0, "reason_code": "evidence", "note": "Fine"}
    refused = client.post("/api/staff/claims/CLM-1001/decide", json=body, headers=marcus)
    assert refused.status_code == 403
    assert "senior handler" in refused.json()["detail"]
    assert client.post("/api/staff/claims/CLM-1001/decide", json=body, headers=dana).is_success


def test_a_gate_never_fails_on_arithmetic_or_passes_on_a_handful() -> None:
    from undercover_api.assurance import judged, wilson  # noqa: PLC0415

    assert wilson(-0.5, 2) == wilson(0.0, 2)
    assert judged(1.0, 1, 0.7) == "watch"
    assert judged(1.0, 5, 0.7) == "pass"
    assert judged(-1.0, 4, 0.5) in ("watch", "fail")
