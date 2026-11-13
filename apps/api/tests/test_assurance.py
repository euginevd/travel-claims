"""The console's overview, audit log, version card and agents map."""

from api_helpers import decide, start
from fastapi.testclient import TestClient
from sqlalchemy import insert, update

from undercover_api.assurance import title_of
from undercover_api.db import (
    assistant_calls,
    audit_seals,
    make_engine,
    model_calls,
    now,
    setting_changes,
)
from undercover_api.guardian import concern_of
from undercover_api.models import DecisionRequest
from undercover_api.pii import scrub


def test_the_overview_judges_five_gates_from_the_records(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    client.put("/api/staff/agent", json={"on": False, "reason": "Fresh start"}, headers=dana)
    overview = client.get("/api/engineering/overview", headers=sam).json()
    assert [g["key"] for g in overview["gates"]] == [
        "held_out",
        "red_team",
        "sign_off",
        "live_vs_exam",
        "straight_through",
    ]
    assert overview["gates"][0]["status"] == "none"
    assert "run the exam" in overview["brief"]
    assert overview["agent"]["reason"] == "Fresh start"
    attacks = client.get("/api/engineering/redteam/attacks", headers=sam).json()
    assert [a["attack_id"] for a in attacks][:1] == ["RT-01"]
    controls = client.get("/api/engineering/controls", headers=sam).json()
    assert controls["agent"]["on"] is False
    # Handlers can't read the console's records.
    assert client.get("/api/engineering/overview", headers=dana).status_code in (401, 403)


def test_the_audit_log_and_agents_map_come_from_what_happened(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    client.put("/api/staff/agent", json={"on": True, "reason": "Starting the demo"}, headers=dana)
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    entries = client.get("/api/engineering/audit", headers=sam).json()
    assert entries[0]["label"] == "Agent switch"
    assert entries[0]["change"] == "on"
    assert entries[0]["reason"] == "Starting the demo"
    nodes = {
        n["key"]: n for n in client.get("/api/engineering/agents", headers=sam).json()["nodes"]
    }
    assert nodes["api"]["calls"] == 1
    assert client.get("/api/engineering/versions/999", headers=sam).status_code == 404
    assert client.post("/api/engineering/runs/99/stop", headers=sam).status_code == 409


def test_the_output_guard_removes_personal_data() -> None:
    text, found = scrub(
        "Paid to 4111 1111 1111 1111; call 0412 345 678 or jo@example.com. TFN 123 456 782. "
        "Approved $1,234.56 for 3 nights."
    )
    assert found == ["card number", "email address", "phone number", "tax file number"]
    assert "4111" not in text
    assert "0412" not in text
    assert "@" not in text
    assert "$1,234.56 for 3 nights" in text


def test_a_version_is_named_by_what_it_changed() -> None:
    first = {"version": 1, "model": "claude-sonnet-5-5", "effort": "medium", "diff": ""}
    cheaper = {**first, "version": 3, "model": "claude-haiku-5-5", "diff": "-model: a\n+model: b"}
    assert title_of(first, None) == "First version"
    assert title_of(cheaper, first) == "Cheaper model: Sonnet → Haiku"
    lower = {**first, "effort": "low", "diff": "+Check the receipts twice."}
    assert title_of(lower, first) == "Lower effort: medium → low + New instructions"
    assert title_of(first, first) == "Same as #1"


def test_the_audit_chain_catches_a_record_changed_after_sealing(
    client: TestClient, sam: dict[str, str], dana: dict[str, str], database_url: str
) -> None:
    client.put("/api/staff/agent", json={"on": True, "reason": "Demo"}, headers=dana)
    client.put("/api/staff/agent", json={"on": False, "reason": "Done"}, headers=dana)
    chain = client.get("/api/engineering/audit/chain", headers=sam).json()
    assert chain["intact"] is True
    assert chain["sealed"] >= 2
    entries = client.get("/api/engineering/audit", headers=sam).json()
    assert entries[0]["before"] == "on"
    # Someone with the database rewrites a reason after the fact: the chain shows it.
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(
            update(setting_changes).where(setting_changes.c.reason == "Demo").values(reason="x")
        )
    engine.dispose()
    broken = client.get("/api/engineering/audit/chain", headers=sam).json()
    assert broken["intact"] is False
    assert len(broken["changed"]) == 1
    alerts = client.get("/api/engineering/alerts", headers=sam).json()
    assert any("changed after it was sealed" in a["text"] for a in alerts)


def test_the_exam_grows_only_from_a_persons_decisions(
    client: TestClient, sam: dict[str, str]
) -> None:
    growth = client.get("/api/engineering/live/exam-growth", headers=sam).json()
    assert growth["target"] == 100
    assert growth["exam_size"] >= 1
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    # The agent's own decision isn't an answer key.
    refused = client.post("/api/engineering/live/claims/CLM-1001/add-to-exam", headers=sam)
    assert refused.status_code == 409


def test_copilot_turns_count_on_the_map_and_traces_mask_people(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    counted = client.post(
        "/api/staff/assistant-calls", json={"model_calls": 3, "cost": 0.02}, headers=dana
    )
    assert counted.status_code == 201
    nodes = {
        n["key"]: n for n in client.get("/api/engineering/agents", headers=sam).json()["nodes"]
    }
    assert nodes["copilot"]["calls"] == 3
    start(client, "CLM-1001")
    decide(client, "CLM-1001", "decline")
    trace = client.get("/api/engineering/claims/CLM-1001/trace", headers=sam).json()
    assert "@" not in str(trace["steps"])


def test_the_guardian_stops_an_approval_that_doesnt_add_up(
    client: TestClient, sam: dict[str, str], database_url: str
) -> None:
    approve = {
        "decision": "approve",
        "payout": 10,
        "section": "Policy wording section 10",
        "reason": "Approved.",
        "maker": "claim_agent",
    }
    failed = DecisionRequest.model_validate(
        approve
        | {
            "checklist": [
                {"label": "Receipt matches", "result": "fail", "detail": "", "source": ""}
            ]
        }
    )
    too_much = DecisionRequest.model_validate(approve | {"payout": 1_000_000})
    engine = make_engine(database_url)
    with engine.connect() as db:
        assert "own check failed: Receipt matches" in (concern_of(db, "CLM-1001", failed) or "")
        assert "more than the" in (concern_of(db, "CLM-1001", too_much) or "")
        assert concern_of(db, "CLM-1001", DecisionRequest.model_validate(approve)) is None
    engine.dispose()
    rails = client.get("/api/engineering/detections", headers=sam).json()
    assert any(r["key"] == "guardian" for r in rails["guardrails"])
    trends = client.get("/api/engineering/trends", headers=sam).json()
    assert {a["key"] for a in trends["agents"]} >= {"claim_agent", "wattle", "copilot"}
    assert len(trends["weeks"]) <= 8


def test_a_rewritten_seal_table_shows_against_its_write_once_copy(
    client: TestClient, sam: dict[str, str], dana: dict[str, str], database_url: str
) -> None:
    copies: dict[int, str] = {}

    class Copy:
        def put(self, seq: int, record: dict[str, object]) -> None:
            copies[seq] = str(record["chain"])

        def chain_at(self, seq: int) -> str | None:
            return copies.get(seq)

    client.app.state.audit_anchor = Copy()  # type: ignore[attr-defined]
    client.put("/api/staff/agent", json={"on": True, "reason": "Demo"}, headers=dana)
    first = client.get("/api/engineering/audit/chain", headers=sam).json()
    assert first["intact"] is True
    assert first["anchored"] is True
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(update(audit_seals).values(chain="0" * 64))
    engine.dispose()
    assert client.get("/api/engineering/audit/chain", headers=sam).json()["intact"] is False


def test_cost_splits_the_spend_by_what_spent_it(
    client: TestClient, sam: dict[str, str], database_url: str
) -> None:
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(
            insert(model_calls).values(
                claim_id="CLM-1001",
                model="claude-haiku-5-5",
                input_tokens=10,
                output_tokens=5,
                cost=0.25,
                created_at=now(),
            )
        )
        db.execute(
            insert(assistant_calls).values(
                agent="wattle", model_calls=2, cost=0.1, created_at=now()
            )
        )
    engine.dispose()
    found = client.get("/api/engineering/costs?days=7", headers=sam).json()
    assert len(found["days"]) == 7
    by = {one["key"]: one["cost"] for one in found["by_source"]}
    assert by["live"] == 0.25
    assert by["wattle"] == 0.1
    assert found["today"] == 0.35
    assert found["dearest"][0]["claim_id"] == "CLM-1001"
    assert client.get("/api/engineering/costs?days=3", headers=sam).status_code == 422
