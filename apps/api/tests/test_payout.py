"""The payout rules, with the original's cases, worked out through the api."""

from typing import Any

import pytest
from api_helpers import line, payout, start
from fastapi.testclient import TestClient


def steps(result: dict[str, Any]) -> list[tuple[str, float]]:
    return [(s["step"], s["amount"]) for s in result["calculation"]]


@pytest.fixture(autouse=True)
def started(client: TestClient) -> None:
    for claim_id in (
        "CLM-1001",
        "CLM-1002",
        "CLM-1003",
        "CLM-1007",
        "CLM-1009",
        "CLM-1015",
        "CLM-1019",
    ):
        start(client, claim_id)


def test_electronics_over_the_per_item_limit(client: TestClient) -> None:
    result = payout(client, "CLM-1007", "baggage", [line("Smartphone", 1099, kind="electronics")])
    assert result["payout"] == 50.0
    assert steps(result) == [
        ("Smartphone, limited to $150.00", 150.0),
        ("Less the deductible", -100.0),
    ]
    assert result["needs_sign_off"] is False


def test_a_payout_over_the_limit_needs_sign_off(client: TestClient) -> None:
    result = payout(
        client, "CLM-1003", "emergency_medical", [line("Emergency room", 3800, kind="expense")]
    )
    assert (result["payout"], result["needs_sign_off"]) == (3750.0, True)


def test_items_with_what_others_paid(client: TestClient) -> None:
    lines = [line("Suitcase", 280), line("Wool suit", 420), line("Four shirts", 120, quantity=4)]
    result = payout(client, "CLM-1002", "baggage", lines, paid_by_others=100)
    assert result["payout"] == 550.0
    assert ("Wool suit, limited to $300.00", 300.0) in steps(result)
    assert ("Less what others have paid or refunded", -100.0) in steps(result)


def test_a_trip_delay_has_no_deductible(client: TestClient) -> None:
    lines = [
        line("Hotel", 245, kind="hotel", nights=1),
        line("Meals", 95, kind="expense"),
        line("Taxis", 80, kind="expense"),
    ]
    result = payout(client, "CLM-1001", "trip_delay", lines)
    assert result["payout"] == 420.0
    assert "Less the deductible" not in [step for step, _ in steps(result)]


def test_the_per_item_limit_counts_each_item(client: TestClient) -> None:
    result = payout(client, "CLM-1007", "baggage", [line("Three jackets", 600, quantity=3)])
    assert steps(result)[0] == ("Three jackets, limited to $450.00", 450.0)


def test_electronics_plus_raises_the_limit(client: TestClient) -> None:
    result = payout(
        client,
        "CLM-1009",
        "baggage",
        [line("Camera", 1500, kind="electronics"), line("Speaker", 400)],
    )
    assert steps(result)[:2] == [
        ("Camera, limited to $1,200.00", 1200.0),
        ("Speaker, limited to $300.00", 300.0),
    ]


def test_cash_is_limited_in_all(client: TestClient) -> None:
    lines = [line("Cash in a wallet", 80, kind="cash"), line("Cash in a bag", 70, kind="cash")]
    result = payout(client, "CLM-1002", "baggage", lines)
    assert steps(result)[0] == ("Cash, up to $100 in all", 100.0)
    assert result["payout"] == 50.0


def test_a_hotel_is_limited_by_rooms_and_nights(client: TestClient) -> None:
    result = payout(client, "CLM-1015", "trip_delay", [line("Hotel", 2500, kind="hotel", nights=2)])
    assert steps(result)[0] == ("Hotel, limited to $2,100.00", 2100.0)


def test_meals_without_receipts_per_traveler_per_day(client: TestClient) -> None:
    result = payout(
        client,
        "CLM-1015",
        "trip_delay",
        [line("Meals", 900, kind="meals_without_receipts", hours=30)],
    )
    assert steps(result)[0] == ("Meals, limited to $420.00", 420.0)


def test_the_benefit_maximum(client: TestClient) -> None:
    lines = [line("Hotel", 700, kind="hotel", nights=2), line("Meals", 300, kind="expense")]
    result = payout(client, "CLM-1001", "trip_delay", lines)
    assert steps(result)[-1] == ("Less the amount over the maximum of $800", -200.0)
    assert result["payout"] == 800.0


@pytest.mark.parametrize("benefit", ["trip_cancellation", "trip_interruption"])
def test_cancellation_is_capped_at_the_trip_cost(client: TestClient, benefit: str) -> None:
    result = payout(client, "CLM-1019", benefit, [line("Flights and hotel", 1600, kind="expense")])
    assert steps(result) == [
        ("Flights and hotel", 1600.0),
        ("Less the amount over the maximum of $1,400", -200.0),
    ]


def test_an_interruption_is_capped_at_the_plan_maximum(client: TestClient) -> None:
    result = payout(
        client, "CLM-1015", "trip_interruption", [line("Flights home", 12000, kind="expense")]
    )
    assert steps(result)[-1] == ("Less the amount over the maximum of $9,600", -2400.0)


def test_nothing_below_zero(client: TestClient) -> None:
    result = payout(
        client, "CLM-1001", "trip_delay", [line("Taxi", 40, kind="expense")], paid_by_others=60
    )
    assert steps(result)[-1] == ("Nothing is left to pay", 20.0)
    assert result["payout"] == 0.0


def test_working_out_a_payout_decides_nothing(client: TestClient) -> None:
    payout(client, "CLM-1001", "trip_delay", [line("Taxis", 80, kind="expense")])
    claim = client.get("/api/agent/claims/CLM-1001", headers={"X-API-Key": "k" * 64}).json()
    assert (claim["status"], claim["decision"]) == ("in_progress", None)


def test_money_is_compared_in_cents_not_floats() -> None:
    from undercover_api.payout import needs_sign_off, same_amount  # noqa: PLC0415

    assert 0.1 + 0.2 != 0.3  # noqa: PLR2004
    assert same_amount(0.1 + 0.2, 0.3)
    assert not same_amount(100.0, 100.01)
    assert not needs_sign_off(1000.0000001, 1000.0)
    assert needs_sign_off(1000.01, 1000.0)
