"""The judge: a finished run's explanations go to it once, its grades come back and are shown
beside the scores, and nothing it says can keep a version or reach the claim agent."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from api_helpers import AGENT, FakeAgent
from fastapi.testclient import TestClient
from sqlalchemy import Engine, update
from test_evaluations import copies, finish, register, start_run, work_all

from undercover_api.db import runs
from undercover_api.evaluations import Scores
from undercover_api.improvement import verdict


def finished_run(client: TestClient, sam: dict[str, str]) -> int:
    register(client)
    run_id = start_run(client, sam).json()["run_id"]
    work_all(client, run_id, sam, "decline")
    finish(client, run_id)
    return run_id


def grade(claim_id: str, score: int | None = 3, **changes: Any) -> dict[str, Any]:
    return {
        "claim_id": claim_id,
        "score": score,
        "same_grounds": True,
        "same_section": True,
        "note": "Same grounds and section.",
        "cost": 0.002,
    } | changes


def post_grades(client: TestClient, run_id: int, found: list[dict[str, Any]], headers: Any = AGENT):
    return client.post(f"/api/agent/runs/{run_id}/grades", json={"grades": found}, headers=headers)


def test_a_finished_run_goes_to_the_judge_once_with_reasons_but_never_the_claim(
    client: TestClient, sam: dict[str, str], agent: FakeAgent
) -> None:
    run_id = finished_run(client, sam)
    assert [c for c in agent.calls if c[0] == "judge"] == [("judge", str(run_id), None)]
    pairs = agent.judged[0]
    assert len(pairs) == 5
    assert all(p["agent_decision"] == "decline" and p["handler_reason"] for p in pairs)
    assert not {"story", "items", "summary", "documents"} & {k for p in pairs for k in p}
    finish(client, run_id)
    assert len(agent.judged) == 1


def test_a_run_grades_while_the_judge_works_then_shows_each_grade(
    client: TestClient, sam: dict[str, str]
) -> None:
    run_id = finished_run(client, sam)
    found = copies(client, run_id, sam)
    run = client.get(f"/api/engineering/runs/{run_id}", headers=sam).json()
    assert run["status"] == "finished"
    assert run["grading"] is True
    assert run["scores"]["grade"] is None

    first, second, *rest = [c["claim_id"] for c in found]
    answered = [grade(first, 3), grade(second, 1, same_section=False)]
    answered += [grade(c, None, same_grounds=True, note="Couldn't grade") for c in rest]
    assert post_grades(client, run_id, answered).status_code == 200

    run = client.get(f"/api/engineering/runs/{run_id}", headers=sam).json()
    assert run["grading"] is False
    assert run["scores"]["grade"] == 2.0
    assert run["scores"]["graded"] == 2
    assert run["scores"]["judge_cost"] == 0.01
    by_id = {c["claim_id"]: c for c in run["claims"]}
    assert by_id[second]["grade"] == 1
    assert by_id[second]["same_section"] is False
    ungraded = by_id[rest[0]]
    assert ungraded["judged"] is True
    assert ungraded["grade"] is None
    assert ungraded["same_grounds"] is None
    listed = client.get("/api/engineering/runs", headers=sam).json()
    assert next(r for r in listed if r["run_id"] == run_id)["scores"]["grade"] == 2.0


def test_a_copy_keeps_its_first_grade(client: TestClient, sam: dict[str, str]) -> None:
    run_id = finished_run(client, sam)
    claim_id = copies(client, run_id, sam)[0]["claim_id"]
    post_grades(client, run_id, [grade(claim_id, 3)])
    post_grades(client, run_id, [grade(claim_id, 0)])
    run = client.get(f"/api/engineering/runs/{run_id}", headers=sam).json()
    assert next(c for c in run["claims"] if c["claim_id"] == claim_id)["grade"] == 3


def test_a_judge_that_cant_be_reached_leaves_the_run_finished_without_grades(
    client: TestClient, sam: dict[str, str], agent: FakeAgent
) -> None:
    register(client)
    run_id = start_run(client, sam).json()["run_id"]
    work_all(client, run_id, sam, "decline")
    agent.unreachable()
    run = finish(client, run_id)
    assert run["status"] == "finished"
    assert run["grading"] is False
    assert run["scores"]["accuracy"] == 0.2


def test_a_run_stops_waiting_for_the_judge_after_ten_minutes(
    client: TestClient, sam: dict[str, str]
) -> None:
    run_id = finished_run(client, sam)
    engine: Engine = cast(Any, client.app).state.engine
    long_ago = (datetime.now(UTC) - timedelta(minutes=11)).isoformat()
    with engine.begin() as db:
        db.execute(update(runs).where(runs.c.run_id == run_id).values(grading_since=long_ago))
    run = client.get(f"/api/engineering/runs/{run_id}", headers=sam).json()
    assert run["grading"] is False


def test_only_the_agent_records_grades(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    run_id = finished_run(client, sam)
    claim_id = copies(client, run_id, sam)[0]["claim_id"]
    for headers in (sam, dana, {}):
        assert post_grades(client, run_id, [grade(claim_id)], headers).status_code == 401


def test_grades_outside_the_rubric_or_the_run_are_refused(
    client: TestClient, sam: dict[str, str]
) -> None:
    run_id = finished_run(client, sam)
    claim_id = copies(client, run_id, sam)[0]["claim_id"]
    for bad in (
        grade(claim_id, 4),
        grade(claim_id, -1),
        grade(claim_id, note="x" * 201),
        grade(claim_id, cost=-1),
        grade(claim_id) | {"extra": "field"},
        grade("CLM-1001"),
    ):
        assert post_grades(client, run_id, [bad]).status_code == 422, bad
    assert post_grades(client, 999, [grade(claim_id)]).status_code == 404
    run = client.get(f"/api/engineering/runs/{run_id}", headers=sam).json()
    assert run["scores"]["graded"] == 0


def test_a_grade_never_changes_a_rounds_verdict() -> None:
    base = Scores(
        claims=5,
        decided=5,
        accuracy=0.8,
        payout_accuracy=0.8,
        straight_through=0.8,
        cost_per_claim=0.04,
        seconds_per_claim=15,
        total_cost=0.2,
    )
    better = base.model_copy(update={"accuracy": 1.0, "payout_accuracy": 1.0})

    def outcome(found: dict[str, Any]) -> tuple[object, object]:
        return found["kept"], found["why"]

    for low, high in ((None, None), (3.0, 0.0), (0.0, 3.0)):
        graded_base = base.model_copy(update={"grade": low})
        graded_better = better.model_copy(update={"grade": high})
        assert outcome(verdict(graded_base, graded_better)) == outcome(verdict(base, better))
        assert outcome(verdict(graded_better, graded_base)) == outcome(verdict(better, base))
