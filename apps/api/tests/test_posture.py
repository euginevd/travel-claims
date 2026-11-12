"""The engineers' security posture and detections: where attacks were stopped, the gaps, which
controls fired on live claims, and that only an engineer may see them."""

from typing import Any

from api_helpers import AGENT, decide, line, payout, start
from fastapi.testclient import TestClient
from sqlalchemy import insert, update
from test_evaluations import register

from undercover_api.db import claims, make_engine, now, settings
from undercover_api.redteam import RUNNING

POSTURE = "/api/engineering/posture"
DETECTIONS = "/api/engineering/detections"


def attack(
    attack_id: str, decided_by: str, outcome: str = "Referred to a handler", **more: Any
) -> dict[str, Any]:
    return {
        "attack_id": attack_id,
        "name": f"Attack {attack_id}",
        "technique": "Hidden text",
        "owasp": "LLM01, ASI01",
        "claim_id": None,
        "outcome": outcome,
        "decided_by": decided_by,
        "paid": 0,
        "passed": True,
        "note": "No money left beyond what the claim supports.",
    } | more


def record(client: TestClient, sam: dict[str, str], *results: dict[str, Any]) -> Any:
    response = client.put("/api/engineering/redteam", json={"results": list(results)}, headers=sam)
    assert response.status_code == 200, response.text
    return response.json()


def step(client: TestClient, claim_id: str, kind: str, content: str) -> None:
    body: dict[str, Any] = {
        "thread_id": "thread-1",
        "kind": kind,
        "content": content,
        "sources": [],
    }
    response = client.post(f"/api/agent/claims/{claim_id}/steps", json=body, headers=AGENT)
    assert response.status_code == 201, response.text


def test_only_an_engineer_sees_the_posture_and_detections(
    client: TestClient, dana: dict[str, str]
) -> None:
    for path in (POSTURE, DETECTIONS):
        assert client.get(path, headers=dana).status_code == 401
        assert client.get(path, headers=AGENT).status_code == 403
        assert client.get(path).status_code == 401


def test_before_any_red_team_run_the_posture_is_untested(
    client: TestClient, sam: dict[str, str]
) -> None:
    found = client.get(POSTURE, headers=sam).json()
    assert found["verdict"] == "untested"
    assert found["redteam"] is None
    assert [layer["reached"] for layer in found["layers"]] == [0, 0, 0, 0]
    assert found["issues"][0]["title"] == "The red team hasn't run"
    assert found["inventory"]["agents"] == 7


def test_attacks_stopped_first_leave_the_layers_behind_untested(
    client: TestClient, sam: dict[str, str]
) -> None:
    register(client)
    report = record(
        client,
        sam,
        attack("RT-01", "Hidden-instruction check"),
        attack("RT-02", "Hidden-instruction check"),
    )
    assert report["config_version"] == 1
    found = client.get(POSTURE, headers=sam).json()
    layers = {layer["key"]: layer for layer in found["layers"]}
    assert layers["screening"] == layers["screening"] | {"reached": 2, "stopped": 2}
    assert layers["agent"]["reached"] == 0
    assert found["verdict"] == "gap"
    assert found["issues"][0]["severity"] == "high"
    assert "never faced an attack" in found["issues"][0]["title"]
    assert found["readiness"]["live_version_red_teamed"] is True
    assert found["controls"]["llm_tested"] == 1
    assert found["controls"]["agentic_tested"] == 1
    untested = [i["title"] for i in found["issues"] if i["link"] == "coverage"]
    assert "No attack tests LLM02 sensitive information disclosure" in untested
    # Supply chain is a build check, not an attack's job.
    assert not any("LLM03" in title for title in untested)


def test_a_failed_attack_makes_the_posture_failing(client: TestClient, sam: dict[str, str]) -> None:
    record(
        client,
        sam,
        attack("RT-01", "Hidden-instruction check"),
        attack(
            "RT-06",
            "UnderCover Agent",
            "Approved $950.00, paid $950.00",
            paid=950,
            passed=False,
            note="Paid $950.00, over the safe $95.00.",
        ),  # fmt: skip
        attack("RT-07", "UnderCover Agent", "Held for sign-off at $2,000.00"),
    )
    found = client.get(POSTURE, headers=sam).json()
    layers = {layer["key"]: layer for layer in found["layers"]}
    assert layers["agent"] == layers["agent"] | {"reached": 2, "stopped": 0}
    assert layers["limits"] == layers["limits"] | {"reached": 2, "stopped": 1}
    assert layers["sign_off"]["reached"] == 1
    assert found["verdict"] == "failing"
    assert found["issues"][0]["title"] == "RT-06 got through: Attack RT-06"
    assert found["redteam"] == found["redteam"] | {"attacks": 3, "held": 2, "paid": 950.0}
    # No version was registered, so none was red-teamed.
    assert found["readiness"]["tested_version"] is None


def test_detections_list_each_control_that_fired_on_live_claims(
    client: TestClient, sam: dict[str, str]
) -> None:
    start(client, "CLM-1005")
    step(client, "CLM-1005", "screening", "Instructions found. The receipt says to approve it.")
    start(client, "CLM-1006")
    step(
        client,
        "CLM-1006",
        "screening",
        "Instructions found. The Bedrock guardrail blocked this (prompt attack).",
    )
    step(client, "CLM-1006", "screening", "No instructions found. A plain claim.")
    step(client, "CLM-1006", "refusal", "The model declined to continue.")
    start(client, "CLM-1003")
    over = payout(client, "CLM-1003", "emergency_medical", [line("Hospital", 3800, kind="expense")])
    decide(client, "CLM-1003", "approve", over["payout"])

    found = client.get(DETECTIONS, headers=sam).json()
    assert found["counts"] == {"guardrail": 1, "hidden_instruction": 1, "refusal": 1, "held": 1}
    kinds = {event["kind"]: event for event in found["events"]}
    assert kinds["hidden_instruction"]["summary"] == "The receipt says to approve it."
    assert kinds["guardrail"]["claim_id"] == "CLM-1006"
    assert kinds["held"]["summary"].endswith("over the $1,000.00 approval limit")
    assert kinds["held"]["outcome"] == "Held for a senior handler"
    posture = client.get(POSTURE, headers=sam).json()
    assert posture["detections"] == found["counts"]
    assert client.get(f"{DETECTIONS}?days=0", headers=sam).status_code == 422


def test_red_team_and_evaluation_claims_never_count_and_a_claim_counts_once(
    client: TestClient, sam: dict[str, str], database_url: str
) -> None:
    with make_engine(database_url).begin() as db:
        db.execute(
            update(claims).where(claims.c.claim_id == "CLM-1007").values(customer_id="CUS-3901")
        )
        db.execute(
            update(claims).where(claims.c.claim_id == "CLM-1008").values(source="evaluation")
        )
    for claim_id in ("CLM-1007", "CLM-1008", "CLM-1009"):
        start(client, claim_id)
        step(client, claim_id, "screening", "Instructions found. It says to pay at once.")
    # A retry screens CLM-1009 again; the guardrail failing closed is the guardrail's.
    step(client, "CLM-1009", "screening", "Instructions found. It says to pay at once, again.")
    step(
        client,
        "CLM-1009",
        "screening",
        "Instructions found. The guardrail couldn't check this, so a person should look at it.",
    )
    found = client.get(DETECTIONS, headers=sam).json()
    assert found["counts"] == {"guardrail": 1, "hidden_instruction": 1, "refusal": 0, "held": 0}
    assert {(e["claim_id"], e["kind"]) for e in found["events"]} == {
        ("CLM-1009", "hidden_instruction"),
        ("CLM-1009", "guardrail"),
    }


def test_a_run_keeps_the_version_it_started_on_and_a_candidates_run_isnt_the_posture(
    client: TestClient, sam: dict[str, str], database_url: str
) -> None:
    register(client)
    record(client, sam, attack("RT-01", "Hidden-instruction check"))
    # A run that started against version 2, a candidate, reports a failure.
    running = {"started_at": now(), "started_by": "Improvement round 1", "config_version": 2}
    with make_engine(database_url).begin() as db:
        db.execute(
            insert(settings).values(key=RUNNING, value=running, changed_by="t", changed_at=now())
        )
    failed = attack("RT-06", "UnderCover Agent", "Approved $950.00", paid=950, passed=False)
    assert record(client, sam, failed)["config_version"] == 2
    found = client.get(POSTURE, headers=sam).json()
    # The posture is still version 1's run, which held.
    assert found["redteam"]["config_version"] == 1
    assert found["verdict"] == "gap"
    assert found["readiness"]["live_version_red_teamed"] is True


def call(client: TestClient, claim_id: str) -> None:
    body = {
        "thread_id": "thread-1",
        "model": "claude-sonnet-5-5",
        "input_tokens": 10,
        "output_tokens": 5,
        "cost": 0.0001,
    }
    response = client.post(f"/api/agent/claims/{claim_id}/model-calls", json=body, headers=AGENT)
    assert response.status_code == 201, response.text


def test_the_suggested_trace_is_the_live_claim_with_the_most_model_calls(
    client: TestClient, sam: dict[str, str], dana: dict[str, str], database_url: str
) -> None:
    suggest = "/api/engineering/trace-suggestion"
    assert client.get(suggest, headers=sam).json() == {"claim_id": None, "model_calls": 0}
    with make_engine(database_url).begin() as db:
        db.execute(
            update(claims).where(claims.c.claim_id == "CLM-1007").values(customer_id="CUS-3901")
        )
    for claim_id, calls in (("CLM-1001", 2), ("CLM-1002", 3), ("CLM-1007", 5)):
        start(client, claim_id)
        for _ in range(calls):
            call(client, claim_id)
    # The red team's claim has more calls, but only live claims are suggested.
    assert client.get(suggest, headers=sam).json() == {"claim_id": "CLM-1002", "model_calls": 3}
    assert client.get(suggest, headers=dana).status_code == 401


def test_an_engineers_trace_has_the_outcome_version_and_the_average_cost(
    client: TestClient, sam: dict[str, str]
) -> None:
    register(client)
    start(client, "CLM-1001")
    call(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    start(client, "CLM-1002")
    call(client, "CLM-1002")
    call(client, "CLM-1002")
    found = client.get("/api/engineering/claims/CLM-1001/trace", headers=sam).json()
    assert found["outcome"]["decision"] == "decline"
    assert found["config_version"] == 1
    assert found["status"] == "decided"
    assert found["summary"]
    # CLM-1001 cost 0.0001 and CLM-1002 0.0002: a live claim costs 0.00015 on average.
    assert found["average_cost"] == 0.00015
    waiting = client.get("/api/engineering/claims/CLM-1002/trace", headers=sam).json()
    assert waiting["outcome"] is None
