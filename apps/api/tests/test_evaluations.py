from typing import Any

from api_helpers import AGENT, FakeAgent, decide, line, payout, start
from fastapi.testclient import TestClient

from undercover_api.evaluations import Scores
from undercover_api.improvement import verdict

INSTRUCTIONS = "You decide one travel insurance claim for UnderCover. " * 3
TINY_EVALUATION = {"CLM-1007", "CLM-1015", "CLM-1017", "CLM-1020", "CLM-1021"}
TINY_HELD_OUT = {"CLM-1104", "CLM-1106", "CLM-1110", "CLM-1112", "CLM-1114"}


def register(client: TestClient) -> None:
    body = {"instructions": INSTRUCTIONS, "model": "claude-sonnet-5-5", "effort": "medium"}
    response = client.post("/api/agent/configuration/initial", json=body, headers=AGENT)
    assert response.status_code == 200, response.text


def start_run(client: TestClient, headers: dict[str, str], label_set: str = "evaluation") -> Any:
    body = {"label_set": label_set, "size": "tiny", "concurrency": 5}
    return client.post("/api/staff/runs", json=body, headers=headers)


def copies(client: TestClient, run_id: int, headers: dict[str, str]) -> list[dict[str, Any]]:
    response = client.get(f"/api/staff/runs/{run_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["claims"]


def work_all(client: TestClient, run_id: int, headers: dict[str, str], decision: str) -> None:
    for copy in copies(client, run_id, headers):
        start(client, copy["claim_id"], f"t-{copy['claim_id']}")
        assert decide(client, copy["claim_id"], decision).status_code == 200


def finish(client: TestClient, run_id: int) -> dict[str, Any]:
    response = client.post(f"/api/agent/runs/{run_id}/finish", headers=AGENT)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_run_copies_the_tiny_set_and_hands_it_to_the_dispatcher(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    response = start_run(client, dana)
    assert response.status_code == 201, response.text
    run = response.json()
    found = copies(client, run["run_id"], dana)
    assert {c["original_claim_id"] for c in found} == TINY_EVALUATION
    assert agent.calls[-1][0] == "dispatch"
    queue = {c["claim_id"] for c in client.get("/api/staff/claims", headers=dana).json()}
    assert not queue & {c["claim_id"] for c in found}


def test_only_a_senior_handler_starts_a_run(client: TestClient, marcus: dict[str, str]) -> None:
    register(client)
    assert start_run(client, marcus).status_code == 403


def test_a_copy_is_never_paid_and_an_approval_over_the_limit_isnt_held(
    client: TestClient, dana: dict[str, str]
) -> None:
    register(client)
    run_id = start_run(client, dana).json()["run_id"]
    claim_id = copies(client, run_id, dana)[0]["claim_id"]
    start(client, claim_id, "t-1")
    amount = payout(client, claim_id, "baggage", [line("Suitcase and clothes", 3000)])["payout"]
    decided = decide(client, claim_id, "approve", amount).json()
    assert decided["status"] == "decided"
    paid = client.post(
        f"/api/agent/claims/{claim_id}/payment", json={"amount": amount}, headers=AGENT
    )
    assert paid.status_code == 409


def test_a_copy_says_it_is_an_evaluation_and_no_payment_path_reaches_it(
    client: TestClient, dana: dict[str, str]
) -> None:
    register(client)
    run_id = start_run(client, dana).json()["run_id"]
    claim_id = copies(client, run_id, dana)[0]["claim_id"]
    start(client, claim_id, "t-1")
    claim = client.get(f"/api/agent/claims/{claim_id}", headers=AGENT).json()
    assert claim["evaluation"] is True
    amount = payout(client, claim_id, "baggage", [line("Suitcase", 200)])["payout"]
    decide(client, claim_id, "approve", amount)
    for paused in (True, False):
        client.put("/api/staff/payouts", json={"paused": paused, "reason": "Testing"}, headers=dana)
        paid = client.post(
            f"/api/agent/claims/{claim_id}/payment", json={"amount": amount}, headers=AGENT
        )
        assert paid.status_code in (409, 423)
        assert client.post(f"/api/staff/claims/{claim_id}/sign-off", headers=dana).status_code in (
            404,
            409,
            423,
        )
    assert client.get(f"/api/agent/claims/{claim_id}", headers=AGENT).json()["payment"] is None


def test_a_finished_run_is_scored_against_the_handlers(
    client: TestClient, dana: dict[str, str]
) -> None:
    register(client)
    run_id = start_run(client, dana).json()["run_id"]
    work_all(client, run_id, dana, "decline")
    scores = finish(client, run_id)["scores"]
    # One of the five tiny claims was declined by its handler.
    assert scores["claims"] == 5
    assert scores["accuracy"] == 0.2
    assert scores["straight_through"] == 1.0


def test_a_round_proposes_reviews_and_rolls_back_a_version_that_doesnt_help(
    client: TestClient, dana: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    started = client.post("/api/staff/rounds", headers=dana)
    assert started.status_code == 201, started.text
    round_ = started.json()
    for run_id in (round_["baseline_eval_run"], round_["baseline_held_run"]):
        work_all(client, run_id, dana, "decline")
        finish(client, run_id)
    assert agent.calls[-1] == ("improve", str(round_["round_id"]), None)

    brief = client.get(f"/api/agent/rounds/{round_['round_id']}/brief", headers=AGENT).json()
    assert len(brief["misses"]) == 4
    held_out = {c["summary"] for c in copies(client, round_["baseline_held_run"], dana)}
    assert not held_out & {m["claim"]["summary"] for m in brief["misses"]}

    proposal = {
        "instructions": INSTRUCTIONS + "Refer when the documents are thin.",
        "model": "claude-sonnet-5-5",
        "effort": "high",
        "reason": "More care on thin documents",
        "cost": 0.01,
    }
    proposed = client.post(
        f"/api/agent/rounds/{round_['round_id']}/proposal", json=proposal, headers=AGENT
    ).json()
    assert proposed["status"] == "awaiting_review"
    assert "+effort: high" in proposed["diff"]

    reviewed = client.post(
        f"/api/staff/rounds/{round_['round_id']}/review",
        json={"approve": True, "reason": "Worth a try"},
        headers=dana,
    ).json()
    assert reviewed["status"] == "evaluating"
    work_all(client, reviewed["candidate_held_run"], dana, "decline")
    finish(client, reviewed["candidate_held_run"])

    done = client.get(f"/api/staff/rounds/{round_['round_id']}", headers=dana).json()
    assert done["status"] == "rolled_back"
    configurations = client.get("/api/staff/configuration", headers=dana).json()
    assert next(c for c in configurations if c["current"])["version"] == 1


def test_a_rejected_proposal_ends_the_round(client: TestClient, dana: dict[str, str]) -> None:
    register(client)
    round_ = client.post("/api/staff/rounds", headers=dana).json()
    for run_id in (round_["baseline_eval_run"], round_["baseline_held_run"]):
        work_all(client, run_id, dana, "refer")
        finish(client, run_id)
    proposal = {
        "instructions": INSTRUCTIONS + " Be bolder.",
        "model": "claude-haiku-5-5",
        "effort": "low",
        "reason": "Cheaper",
        "cost": 0.0,
    }
    client.post(f"/api/agent/rounds/{round_['round_id']}/proposal", json=proposal, headers=AGENT)
    rejected = client.post(
        f"/api/staff/rounds/{round_['round_id']}/review",
        json={"approve": False, "reason": "Too risky"},
        headers=dana,
    ).json()
    assert rejected["status"] == "rejected"


def test_the_verdict_keeps_a_cheaper_version_that_is_as_accurate() -> None:
    base = Scores(
        claims=5,
        decided=5,
        accuracy=1.0,
        payout_accuracy=1.0,
        straight_through=0.8,
        cost_per_claim=0.04,
        seconds_per_claim=15,
        total_cost=0.2,
    )
    cheaper = base.model_copy(update={"cost_per_claim": 0.003, "seconds_per_claim": 18})
    assert verdict(base, cheaper)["kept"] is True
    assert verdict(base, cheaper.model_copy(update={"accuracy": 0.8}))["kept"] is False
    assert verdict(base, base)["kept"] is False
