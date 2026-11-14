from typing import cast

from api_helpers import AGENT, FakeAgent
from fastapi.testclient import TestClient
from test_evaluations import finish, register, work_all

from undercover_api.compare import Result, answer_of


def test_compare_runs_each_model_in_turn_and_never_puts_one_in_use(
    client: TestClient, sam: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    models = client.get("/api/engineering/compare/models", headers=sam).json()
    assert [m["label"] for m in models] == ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.2"]
    assert next(m for m in models if m["in_use"])["in_use_effort"] == "medium"

    body = {
        "picks": [
            {"model": "claude-sonnet-5-5", "effort": "medium"},
            {"model": "claude-fable-5-2", "effort": "high"},
        ],
        "size": "tiny",
        "repeats": 1,
    }
    started = client.post("/api/engineering/compare", json=body, headers=sam)
    assert started.status_code == 201, started.text
    comparison = started.json()
    assert comparison["status"] == "running"
    first = comparison["results"][0]["runs"][0]
    assert agent.calls[-1][0] == "dispatch"
    assert client.post("/api/engineering/compare", json=body, headers=sam).status_code == 409

    # The first finishes; the second starts on its own.
    work_all(client, first, sam, "decline")
    finish(client, first)
    latest = client.get("/api/engineering/compare/latest", headers=sam).json()
    second = latest["results"][1]["runs"][0]
    work_all(client, second, sam, "refer")
    finish(client, second)

    done = client.get("/api/engineering/compare/latest", headers=sam).json()
    assert done["status"] == "finished"
    assert [r["finished"] for r in done["results"]] == [1, 1]
    assert done["results"][0]["straight_through"] != done["results"][1]["straight_through"]
    assert done["differences"]
    assert done["answer"]

    # Finished: the judge is handed each claim's two explanations, beside the handler's, once.
    assert agent.calls[-1][0] == "head_to_head"
    duels = agent.duels[-1]
    assert len(duels) == 5
    assert str(duels[0]["key"]).endswith("|claude-sonnet-5-5:medium|claude-fable-5-2:high")
    first = duels[0]["first"]
    assert isinstance(first, dict)
    assert {"decision", "reason"} <= set(cast(dict[str, object], first))
    assert done["head_to_head_state"] == "judging"
    verdicts = [
        {"key": d["key"], "a_score": score}
        for d, score in zip(duels, [1, 1, 0.5, 0, None], strict=True)
    ]
    path = f"/api/agent/compare/{done['compare_id']}/verdicts"
    assert client.post(path, json={"verdicts": verdicts}, headers=AGENT).status_code == 200
    # A second answer is ignored.
    again = [{"key": duels[0]["key"], "a_score": 0}]
    assert client.post(path, json={"verdicts": again}, headers=AGENT).status_code == 200
    judged = client.get("/api/engineering/compare/latest", headers=sam).json()
    assert judged["head_to_head_state"] == "done"
    assert judged["head_to_head"] == [
        {
            "a": "claude-sonnet-5-5:medium",
            "b": "claude-fable-5-2:high",
            "a_share": 0.625,
            "judged": 4,
        }
    ]
    assert client.post(path, json={"verdicts": []}, headers=sam).status_code in (401, 403)

    # A compared model stays out of Versions and can't be put in use by hand.
    fable = done["results"][1]["version"]
    versions = client.get("/api/engineering/versions", headers=sam).json()
    assert fable not in {v["version"] for v in versions}
    restore = client.post(
        f"/api/engineering/configuration/{fable}/restore",
        json={"reason": "Try it live"},
        headers=sam,
    )
    assert restore.status_code in (404, 409), restore.text


def test_propose_starts_a_round_with_the_compared_model_in_the_improvers_place(
    client: TestClient, sam: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    body = {"model": "claude-haiku-5-5", "effort": "low"}
    proposed = client.post("/api/engineering/compare/propose", json=body, headers=sam)
    assert proposed.status_code == 201, proposed.text
    round_id = proposed.json()["round_id"]
    round_ = client.get(f"/api/engineering/rounds/{round_id}", headers=sam).json()
    for run_id in (round_["baseline_eval_run"], round_["baseline_held_run"]):
        work_all(client, run_id, sam, "decline")
        finish(client, run_id)
    waiting = client.get(f"/api/engineering/rounds/{round_id}", headers=sam).json()
    assert waiting["status"] == "awaiting_review"
    assert waiting["proposal"]["model"] == "claude-haiku-5-5"
    assert ("improve", str(round_id), None) not in agent.calls


def result(label: str, accuracy: float, cost: float, low: float, high: float) -> Result:
    return Result(
        model=label,
        label=label,
        effort="medium",
        version=2,
        in_use=False,
        runs=[1],
        finished=1,
        planned=1,
        claims=25,
        accuracy=accuracy,
        low=low,
        high=high,
        by_run=[accuracy],
        payout_accuracy=accuracy,
        straight_through=0.8,
        declined=0,
        grade=None,
        cost_per_claim=cost,
        seconds_per_claim=20,
        tokens_per_claim=10_000,
        passes=accuracy >= 0.8,
    )


def test_the_answer_names_the_cheapest_pass_and_says_whether_dearer_is_clearly_better() -> None:
    cheap = result("Haiku", 0.84, 0.005, 0.65, 0.94)
    overlap = result("Sonnet", 0.92, 0.09, 0.75, 0.98)
    clear = result("Fable", 1.0, 0.38, 0.95, 1.0)
    miss = result("Opus", 0.6, 0.2, 0.4, 0.77)
    enough, picked = answer_of([cheap, overlap])
    assert enough is not None
    assert enough.startswith("Haiku at medium is enough")
    assert picked == "Haiku:medium"
    better, _ = answer_of([cheap, clear])
    assert better is not None
    assert better.startswith("Fable at medium is clearly better")
    none, nothing = answer_of([miss])
    assert none == "None meets the targets yet; the best is Opus at medium."
    assert nothing is None


def test_the_dearest_models_run_on_5_claims_and_the_improver_keeps_to_its_three(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    register(client)
    # The improvement budget, which caps each compared run too, at its lowest.
    lowest = {"round_spend_limit": 0.5, "reason": "Keep it cheap"}
    assert client.put("/api/staff/settings", json=lowest, headers=dana).status_code == 200
    body = {
        "picks": [{"model": "claude-fable-5-2", "effort": "max"}],
        "size": "whole",
        "repeats": 1,
    }
    refused = client.post("/api/engineering/compare", json=body, headers=sam)
    assert refused.status_code == 409
    assert "5 claims" in refused.json()["detail"]
    dear = {
        "picks": [
            {"model": "claude-fable-5-2", "effort": "max"},
            {"model": "claude-opus-5-5", "effort": "max"},
            {"model": "claude-sonnet-5-5", "effort": "max"},
        ],
        "size": "tiny",
        "repeats": 3,
    }
    over = client.post("/api/engineering/compare", json=dear, headers=sam)
    assert over.status_code == 409
    assert "over the" in over.json()["detail"]

    started = client.post("/api/engineering/rounds", headers=sam).json()
    for run_id in (started["baseline_eval_run"], started["baseline_held_run"]):
        work_all(client, run_id, sam, "decline")
        finish(client, run_id)
    fable = {
        "instructions": "You decide one travel insurance claim for UnderCover. " * 3,
        "model": "claude-fable-5-2",
        "effort": "max",
        "reason": "Most capable",
        "cost": 0.01,
    }
    proposed = client.post(
        f"/api/agent/rounds/{started['round_id']}/proposal", json=fable, headers=AGENT
    )
    assert proposed.status_code == 422


def test_one_claim_is_a_run_of_the_first_practice_claim(
    client: TestClient, sam: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    body = {"picks": [{"model": "claude-haiku-5-5", "effort": "low"}], "size": "one", "repeats": 1}
    started = client.post("/api/engineering/compare", json=body, headers=sam)
    assert started.status_code == 201, started.text
    kind, _, claim_ids = agent.calls[-1]
    assert kind == "dispatch"
    assert claim_ids is not None
    assert len(claim_ids.split(",")) == 1
    # One pick: nothing to judge head to head.
    assert started.json()["head_to_head_state"] == "none"
