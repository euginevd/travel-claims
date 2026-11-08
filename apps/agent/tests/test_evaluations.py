# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false, reportPrivateUsage=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
from typing import Any

from fastapi.testclient import TestClient
from stubs import START, FakeApi, FakeClaude, config, decide, graph_for

from undercover_agent.dispatcher import Dispatcher
from undercover_agent.improver import RoundImprover, brief_as_text
from undercover_agent.models import Call, Proposal
from undercover_agent.runner import Runner
from undercover_agent.server import create_app

KEY = "k" * 40
Json = dict[str, Any]


def test_the_claim_agent_works_with_its_attempts_configuration() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("decline", 0.0, 1)])
    graph_for(api, claude).invoke(START, config())
    assert claude.systems[0] == ("Version two's instructions.", "claude-haiku-5-5", "low")


class RunApi(FakeApi):
    """An api holding a run's copies: one waiting, one in progress, one decided."""

    def __init__(self) -> None:
        super().__init__()
        self.statuses = {"CLM-1": "waiting", "CLM-2": "in_progress", "CLM-3": "decided"}
        self.started: list[str] = []
        self.finished: list[int] = []

    def claim(self, claim_id: str) -> Json:
        return {"claim_id": claim_id, "status": self.statuses[claim_id], "thread_id": "t-old"}

    def start(self, claim_id: str, thread_id: str) -> Json:
        self.started.append(claim_id)
        return self.claim(claim_id)

    def finish_run(self, run_id: int) -> Json:
        self.finished.append(run_id)
        return {}


class RecordingRunner(Runner):
    def __init__(self) -> None:
        self.worked: list[tuple[str, str]] = []

    def carry_on(self, claim_id: str, thread_id: str) -> None:
        self.worked.append((claim_id, thread_id))


def test_the_dispatcher_starts_waiting_copies_carries_on_others_and_finishes() -> None:
    api, runner = RunApi(), RecordingRunner()
    Dispatcher(runner, api).dispatch(7, ["CLM-1", "CLM-2", "CLM-3"], 3).join(timeout=5)
    assert api.started == ["CLM-1"]
    assert sorted(c for c, _ in runner.worked) == ["CLM-1", "CLM-2"]
    assert ("CLM-2", "t-old") in runner.worked
    assert api.finished == [7]


def test_carrying_on_a_decided_claim_does_nothing() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("decline", 0.0, 1)])
    graph = graph_for(api, claude)
    graph.invoke(START, config())
    runner = Runner(graph, api)
    runner.carry_on("CLM-1001", "t-1")
    assert claude.turns_taken == 1


BRIEF: Json = {
    "configuration": {
        "version": 1,
        "instructions": "Decide claims.",
        "model": "claude-sonnet-5-5",
        "effort": "medium",
    },
    "scores": {"accuracy": 0.6},
    "misses": [{"claim": {"summary": "Lost bag"}, "handler_decision": "approve"}],
    "models": ["claude-sonnet-5-5"],
    "efforts": ["low", "medium"],
}


class RoundApi(FakeApi):
    def __init__(self, brief: Json) -> None:
        super().__init__()
        self.brief_given = brief
        self.proposals: list[Json] = []
        self.failures: list[str] = []

    def brief(self, round_id: int) -> Json:
        return self.brief_given

    def propose(self, round_id: int, body: Json) -> Json:
        self.proposals.append(body)
        return {}

    def improver_failed(self, round_id: int, reason: str) -> Json:
        self.failures.append(reason)
        return {}


class StubImprover:
    def __init__(self, found: Proposal | None) -> None:
        self.found = found
        self.read: list[str] = []

    def propose(self, content: str) -> tuple[Proposal | None, Call]:
        self.read.append(content)
        return self.found, Call("claude-sonnet-5-5", 100, 50, 0.002)


def test_the_improver_posts_its_proposal_with_its_cost() -> None:
    api = RoundApi(BRIEF)
    proposal = Proposal(
        instructions="Decide claims carefully.",
        model="claude-sonnet-5-5",
        effort="low",
        reason="Cheaper",
    )
    stub = StubImprover(proposal)
    RoundImprover(stub, api).propose(3)
    assert api.proposals[0]["effort"] == "low"
    assert api.proposals[0]["cost"] == 0.002
    assert "<misses>" in stub.read[0]


def test_the_improver_stops_the_round_when_it_has_nothing() -> None:
    api = RoundApi(BRIEF | {"misses": []})
    RoundImprover(StubImprover(None), api).propose(3)
    assert api.failures
    assert api.proposals == []


def test_the_brief_marks_the_misses_as_data() -> None:
    text = brief_as_text(BRIEF)
    assert "<current_instructions>" in text
    assert "<misses>" in text


def test_dispatch_and_improve_need_the_agents_key() -> None:
    app = create_app(RecordingRunner, lambda: KEY)
    with TestClient(app) as http:
        body = {"run_id": 1, "claim_ids": ["CLM-1"], "concurrency": 2}
        assert http.post("/dispatch", json=body).status_code == 401
        refused = http.post("/dispatch", json=body, headers={"X-API-Key": KEY})
        assert refused.status_code == 409  # no dispatcher set up in this app
        assert http.post("/improve", json={"round_id": 1}).status_code == 401
