"""The settings page's values and their audit history, and the success criteria worked out
from them in code."""

from typing import Any, cast

from api_helpers import AGENT
from fastapi.testclient import TestClient
from sqlalchemy import Engine, insert, select
from test_evaluations import finish, register, start_run, work_all
from test_flow import approve, claim, pay

from undercover_api.db import payments, setting_changes
from undercover_api.evaluations import StartRunRequest, create_run, need_current

SETTINGS = "/api/staff/settings"
CRITERIA = "/api/staff/success-criteria"


def engine_of(client: TestClient) -> Engine:
    app: Any = client.app
    return cast(Engine, app.state.engine)


def change(client: TestClient, headers: dict[str, str], **values: Any) -> Any:
    return client.put(SETTINGS, json=values, headers=headers)


def criteria(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    found = client.get(CRITERIA, headers=headers).json()
    return {c["key"]: c for c in found["criteria"]} | {"met": found["met"]}


def test_every_handler_and_engineer_reads_the_settings(
    client: TestClient, marcus: dict[str, str], sam: dict[str, str]
) -> None:
    found = client.get(SETTINGS, headers=marcus).json()
    assert found["values"] == {
        "approval_limit": 1000.0,
        "round_spend_limit": 2.0,
        "accuracy_objective": 0.8,
        "straight_through_objective": 0.7,
        "agents_at_once": 5,
    }
    assert found["ranges"]["approval_limit"] == {"min": 100, "max": 5000}
    assert found["changes"] == []
    assert client.get("/api/engineering/settings", headers=sam).json() == found
    # Each audience's token is refused at the other's route, and nobody reads without one.
    assert client.get(SETTINGS, headers=sam).status_code == 401
    assert client.get("/api/engineering/settings", headers=marcus).status_code == 401
    assert client.get(SETTINGS).status_code == 401
    assert client.get(SETTINGS, headers=AGENT).status_code == 403


def test_only_a_senior_handler_changes_a_setting_and_each_change_is_kept(
    client: TestClient, dana: dict[str, str], marcus: dict[str, str], sam: dict[str, str]
) -> None:
    assert change(client, marcus, approval_limit=2000).status_code == 403
    assert change(client, AGENT, approval_limit=2000).status_code == 403
    assert client.put("/api/engineering/settings", json={}, headers=sam).status_code == 405
    saved = change(
        client, dana, approval_limit=1500, agents_at_once=5, reason="  Quarterly review  "
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["values"]["approval_limit"] == 1500.0
    # One row for the value that changed; the one sent unchanged leaves no trace.
    assert saved.json()["changes"] == [
        {
            "key": "approval_limit",
            "old": 1000.0,
            "new": 1500.0,
            "changed_by": "Dana Whitfield",
            "changed_at": saved.json()["changes"][0]["changed_at"],
            "reason": "Quarterly review",
        }
    ]
    change(client, dana, accuracy_objective=0.9, straight_through_objective=0.6)
    with engine_of(client).connect() as db:
        rows = db.execute(select(setting_changes).order_by(setting_changes.c.change_id)).mappings()
        kept = [(r["key"], r["old_value"], r["value"], r["changed_by_id"]) for r in rows]
    assert kept == [
        ("approval_limit", 1000.0, 1500.0, "HND-01"),
        ("accuracy_objective", 0.8, 0.9, "HND-01"),
        ("straight_through_objective", 0.7, 0.6, "HND-01"),
    ]


def test_a_value_outside_its_range_is_refused(client: TestClient, dana: dict[str, str]) -> None:
    for body in (
        {"approval_limit": 99},
        {"approval_limit": 5000.01},
        {"round_spend_limit": 0.4},
        {"accuracy_objective": 0.49},
        {"straight_through_objective": 1.1},
        {"agents_at_once": 26},
        {"agents_at_once": 2.5},
        {"approval_limit": "lots"},
        {"payouts_paused": False},
        {"reason": "x" * 201},
    ):
        assert change(client, dana, **body).status_code == 422, body
    assert client.get(SETTINGS, headers=dana).json()["changes"] == []


def test_a_new_limit_leaves_held_and_paid_claims_as_they_are(
    client: TestClient, dana: dict[str, str]
) -> None:
    paid = approve(client, "CLM-1001", "trip_delay", 420, "expense")
    assert pay(client, "CLM-1001", paid) == 200
    held = approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    assert claim(client, "CLM-1003")["status"] == "waiting_for_sign_off"

    # Raised over the held payout: it stays held, and the agent still can't pay it.
    assert change(client, dana, approval_limit=5000).status_code == 200
    assert pay(client, "CLM-1003", held) == 403
    assert claim(client, "CLM-1003")["status"] == "waiting_for_sign_off"
    assert claim(client, "CLM-1003")["payment"] is None

    # Lowered under what was already paid: the payment stands, and it isn't a breach.
    assert change(client, dana, approval_limit=100).status_code == 200
    assert claim(client, "CLM-1001")["payment"]["amount"] == paid
    assert criteria(client, dana)["signed_off"]["met"] is True
    # A decision made now is held under the new limit.
    assert approve(client, "CLM-1004", "trip_delay", 420, "expense") > 100
    assert claim(client, "CLM-1004")["status"] == "waiting_for_sign_off"


def test_the_criteria_have_no_data_until_a_held_out_run_finishes(
    client: TestClient, dana: dict[str, str], sam: dict[str, str]
) -> None:
    before = criteria(client, dana)
    assert before["met"] is False
    assert before["accuracy"]["met"] is None
    assert before["accuracy"]["actual"] is None
    assert before["straight_through"]["detail"] == "No held-out run of the version in use yet"
    assert before["signed_off"]["met"] is True

    register(client)
    assert start_run(client, sam, "held_out").status_code == 409  # the exam isn't run by hand
    with engine_of(client).begin() as db:
        body = StartRunRequest(label_set="held_out", size="tiny", concurrency=5)
        run_id, _ = create_run(db, body, need_current(db), "Sam Carter")
    work_all(client, run_id, sam, "decline")
    scores = finish(client, run_id)["scores"]
    after = criteria(client, dana)
    assert after["straight_through"]["actual"] == scores["straight_through"] == 1.0
    assert after["straight_through"]["met"] is True
    assert after["accuracy"]["actual"] == scores["accuracy"]
    assert after["accuracy"]["met"] is (scores["accuracy"] >= 0.8)
    assert after["met"] is after["accuracy"]["met"]
    assert f"Run {run_id}" in after["accuracy"]["detail"]
    assert (
        client.get("/api/engineering/success-criteria", headers=sam).json()["met"] is (after["met"])
    )
    assert client.get(CRITERIA, headers=sam).status_code == 401

    # The objective is a setting: moved to what the run scored, the criterion is met.
    change(client, dana, accuracy_objective=max(0.5, scores["accuracy"]))
    assert criteria(client, dana)["accuracy"]["met"] is (scores["accuracy"] >= 0.5)


def test_a_payment_over_the_limit_counts_only_when_no_person_signed_it_off(
    client: TestClient, dana: dict[str, str]
) -> None:
    approve(client, "CLM-1003", "emergency_medical", 3800, "expense")
    assert client.post("/api/staff/claims/CLM-1003/sign-off", headers=dana).status_code == 200
    signed = criteria(client, dana)["signed_off"]
    assert (signed["actual"], signed["met"]) == (0, True)
    assert signed["detail"].startswith("1 paid over the approval limit")

    # A payment over the limit that no route would make, put straight into the table.
    amount = approve(client, "CLM-1008", "emergency_medical", 3000, "expense")
    with engine_of(client).begin() as db:
        db.execute(insert(payments).values(claim_id="CLM-1008", amount=amount, paid_at="2026"))
    breached = criteria(client, dana)
    assert (breached["signed_off"]["actual"], breached["signed_off"]["met"]) == (1, False)
    assert breached["met"] is False
