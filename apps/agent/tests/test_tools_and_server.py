import threading

from fastapi.testclient import TestClient
from stubs import FakeApi, FakeContext

from undercover_agent.runner import Busy, Runner
from undercover_agent.server import create_app
from undercover_agent.tools import TOOLS, run_tool

KEY = "k" * 40


def test_tools_work_on_the_graphs_claim_whatever_the_model_names() -> None:
    api = FakeApi()
    run_tool(api, FakeContext(), "CLM-1001", "get_claim", {"claim_id": "CLM-9999"})
    assert api.claim_reads == ["CLM-1001"]


def test_every_tool_is_strict() -> None:
    for definition in TOOLS:
        schema = definition["input_schema"]
        assert definition["strict"] is True
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])


def test_a_decision_always_names_the_claim_agent_as_maker() -> None:
    api = FakeApi()
    args = {"decision": "decline", "payout": 0, "section": "6", "reason": "r"}
    run_tool(api, FakeContext(), "CLM-1001", "record_decision", args | {"maker": "x"})
    assert api.decision is not None
    assert api.decision["maker"] == "claim_agent"


class StubRunner(Runner):
    def __init__(self) -> None:
        self.started: list[str] = []

    def work(self, claim_id: str, thread_id: str) -> threading.Thread:
        if claim_id in self.started:
            raise Busy("busy")
        self.started.append(claim_id)
        return threading.current_thread()


def client() -> TestClient:
    return TestClient(create_app(StubRunner, lambda: KEY))


def test_work_needs_the_agents_key() -> None:
    with client() as http:
        body = {"claim_id": "CLM-1001", "thread_id": "t"}
        assert http.post("/work", json=body).status_code == 401
        assert http.post("/work", json=body, headers={"X-API-Key": "wrong"}).status_code == 401


def test_work_is_accepted_once_then_refused_while_busy() -> None:
    with client() as http:
        body = {"claim_id": "CLM-1001", "thread_id": "t"}
        first = http.post("/work", json=body, headers={"X-API-Key": KEY})
        second = http.post("/work", json=body, headers={"X-API-Key": KEY})
    assert (first.status_code, first.json()) == (202, {"accepted": True})
    assert second.status_code == 409
    assert "refused" in second.json()


def test_health_says_ok() -> None:
    with client() as http:
        assert http.get("/health").json() == {"status": "ok"}
