# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""Heartbeats while a claim works, carrying a stalled claim on, and the watchdog."""

import threading
import time
from typing import Any

from anthropic.types import Message
from fastapi.testclient import TestClient
from stubs import START, FakeApi, FakeClaude, FakeContext, config, decide, graph_for, tool_use

from undercover_agent.api_client import ApiError
from undercover_agent.graph import build_graph
from undercover_agent.models import Call
from undercover_agent.runner import Busy, Runner, Watchdog
from undercover_agent.server import create_app

KEY = "k" * 40
THREAD = "t-1"


class BeatingApi(FakeApi):
    def __init__(self) -> None:
        super().__init__()
        self.beats: list[tuple[str, str]] = []

    def heartbeat(self, claim_id: str, thread_id: str) -> None:
        self.beats.append((claim_id, thread_id))


class SlowClaude(FakeClaude):
    """Claude that takes a while over each turn, so heartbeats go by."""

    def turn(self, *args: Any, **kwargs: Any) -> tuple[Message, Call]:
        time.sleep(0.15)
        return super().turn(*args, **kwargs)


class CrashingClaude(FakeClaude):
    """Claude that fails on one turn, as a process dying mid-claim would leave it."""

    def __init__(self, turns: list[Message], crash_on: int) -> None:
        super().__init__(turns)
        self.crash_on = crash_on

    def turn(self, *args: Any, **kwargs: Any) -> tuple[Message, Call]:
        if self.turns_taken + 1 == self.crash_on:
            self.turns_taken += 1
            raise RuntimeError("the process died")
        return super().turn(*args, **kwargs)


def test_a_claim_beats_while_it_works_and_stops_when_done() -> None:
    api = BeatingApi()
    claude = SlowClaude(
        [tool_use("get_claim", {"claim_id": "CLM-1001"}, 1), decide("decline", 0, 2)]
    )
    runner = Runner(graph_for(api, claude), api, heartbeat_seconds=0.05)
    runner.work("CLM-1001", THREAD).join(timeout=5)
    assert api.decision is not None
    assert len(api.beats) >= 2
    assert set(api.beats) == {("CLM-1001", THREAD)}
    after = len(api.beats)
    time.sleep(0.2)
    assert len(api.beats) == after


def test_a_failed_heartbeat_never_stops_the_claim() -> None:
    class RefusingApi(BeatingApi):
        def heartbeat(self, claim_id: str, thread_id: str) -> None:
            raise ApiError(409, "Claim CLM-1001 isn't in progress on that thread")

    api = RefusingApi()
    claude = SlowClaude([decide("decline", 0, 1)])
    Runner(graph_for(api, claude), api, heartbeat_seconds=0.05).work("CLM-1001", THREAD).join(5)
    assert api.decision is not None


def test_a_crashed_claim_carries_on_from_its_last_saved_step() -> None:
    api = BeatingApi()
    lookup = tool_use("read_section", {"document": "policy_wording", "number": 6}, 1)
    graph = graph_for(api, CrashingClaude([lookup], crash_on=2))
    Runner(graph, api).work("CLM-1001", THREAD).join(timeout=5)
    assert api.decision is None
    assert api.steps_recorded[-1] == ("error", "The agent stopped: RuntimeError")
    screened = [kind for kind, _ in api.steps_recorded].count("screening")

    # The same saved progress, worked by a new process with Claude back.
    claude = FakeClaude([decide("decline", 0, 2)])
    Runner(graph_for_saver(api, claude, graph), api).carry_on("CLM-1001", THREAD)
    assert api.decision is not None
    assert api.decision["decision"] == "decline"
    assert claude.turns_taken == 1  # the lookup wasn't asked for again
    assert [kind for kind, _ in api.steps_recorded].count("screening") == screened


class ImageRefusingClaude(FakeClaude):
    """Claude refusing a receipt image it can't open, as the API does with a 400."""

    def turn(self, *args: Any, **kwargs: Any) -> tuple[Message, Call]:
        self.turns_taken += 1
        raise RuntimeError(
            "Error code: 400 - {'error': {'type': 'invalid_request_error', "
            "'message': 'Could not process image'}}"
        )


def test_a_receipt_the_model_cant_open_refers_the_claim_instead_of_stalling_it() -> None:
    api = BeatingApi()
    Runner(graph_for(api, ImageRefusingClaude([])), api).work("CLM-1001", THREAD).join(5)
    assert api.decision is not None
    assert api.decision["decision"] == "refer"
    assert "clearer copy" in api.decision["reason"]
    assert api.status == "decided"
    assert not any(content.startswith("The agent stopped") for _, content in api.steps_recorded)


def graph_for_saver(api: FakeApi, claude: FakeClaude, old: Any) -> Any:
    """A graph with new Claude over the old graph's saved progress."""
    return build_graph(api, claude, FakeContext(), old.checkpointer, max_model_calls=10)


def test_a_send_back_whose_resume_never_arrived_is_decided_again() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("approve", 2500.0, 1), decide("decline", 0.0, 2)])
    graph = graph_for(api, claude)
    graph.invoke(START, config())
    assert api.status == "waiting_for_sign_off"
    api.notes.append("Check the waiting period.")
    api.status, api.decision = "in_progress", None  # sent back; the resume was lost
    Runner(graph, api).carry_on("CLM-1001", THREAD)
    assert api.decision is not None
    assert api.decision["decision"] == "decline"


def test_a_held_or_signed_off_claim_is_not_carried_on() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("approve", 2500.0, 1)])
    graph = graph_for(api, claude)
    graph.invoke(START, config())
    for status in ("waiting_for_sign_off", "decided"):
        api.status = status
        Runner(graph, api).carry_on("CLM-1001", THREAD)
    assert claude.turns_taken == 1
    assert ("message", "A handler signed off the payout.") not in api.steps_recorded


class SweepApi(FakeApi):
    def __init__(self, stalled: list[str], refused: set[str] | None = None) -> None:
        super().__init__()
        self.stalled = stalled
        self.refused = refused or set()
        self.recovered: list[str] = []

    def stalled_claims(self) -> list[str]:
        return self.stalled

    def recover(self, claim_id: str) -> dict[str, Any]:
        if claim_id in self.refused:
            raise ApiError(409, f"Claim {claim_id} is already being carried on")
        self.recovered.append(claim_id)
        return {"claim_id": claim_id, "thread_id": f"thread-of-{claim_id}"}


class RecordingRunner(Runner):
    def __init__(self, busy: set[str] | None = None) -> None:
        self.carried: list[tuple[str, str]] = []
        self.busy = busy or set()

    def carry_on_later(self, claim_id: str, thread_id: str) -> threading.Thread:
        if claim_id in self.busy:
            raise Busy("busy")
        self.carried.append((claim_id, thread_id))
        return threading.current_thread()


def test_the_watchdog_carries_on_each_stalled_claim_the_api_lets_it_take() -> None:
    api = SweepApi(["CLM-1", "CLM-2", "CLM-3"], refused={"CLM-2"})
    runner = RecordingRunner(busy={"CLM-3"})
    assert Watchdog(runner, api).sweep() == ["CLM-1"]
    assert runner.carried == [("CLM-1", "thread-of-CLM-1")]
    assert api.recovered == ["CLM-1", "CLM-3"]


def test_the_watchdog_waits_for_the_api() -> None:
    class DownApi(SweepApi):
        def stalled_claims(self) -> list[str]:
            raise ApiError(503, "The api isn't answering")

    runner = RecordingRunner()
    assert Watchdog(runner, DownApi([])).sweep() == []
    assert runner.carried == []


def test_the_watchdog_sweeps_on_its_own_until_stopped() -> None:
    api = SweepApi(["CLM-1"])
    runner = RecordingRunner()
    watchdog = Watchdog(runner, api, every_seconds=0.02)
    thread = watchdog.start()
    deadline = time.monotonic() + 2
    while not runner.carried and time.monotonic() < deadline:
        time.sleep(0.01)
    watchdog.stop()
    thread.join(timeout=1)
    assert runner.carried[0] == ("CLM-1", "thread-of-CLM-1")
    assert not thread.is_alive()


class StubRunner(Runner):
    def __init__(self) -> None:
        self.carried: list[str] = []

    def carry_on_later(self, claim_id: str, thread_id: str) -> threading.Thread:
        if claim_id in self.carried:
            raise Busy("busy")
        self.carried.append(claim_id)
        return threading.current_thread()


def test_carry_on_needs_the_key_and_is_refused_while_busy() -> None:
    body = {"claim_id": "CLM-1001", "thread_id": THREAD}
    with TestClient(create_app(StubRunner, lambda: KEY)) as http:
        assert http.post("/carry-on", json=body).status_code == 401
        first = http.post("/carry-on", json=body, headers={"X-API-Key": KEY})
        again = http.post("/carry-on", json=body, headers={"X-API-Key": KEY})
        through_runtime = http.post(
            "/invocations", json={"path": "/carry-on", "body": body, "key": KEY}
        )
    assert (first.status_code, first.json()) == (202, {"accepted": True})
    assert again.status_code == 409
    assert through_runtime.json() == {"status": 409, "body": {"refused": "busy"}}


def test_the_service_runs_the_watchdog_while_it_is_up() -> None:
    watchdogs: list[Watchdog] = []

    def make_watchdog(runner: Runner) -> Watchdog:
        watchdog = Watchdog(runner, SweepApi([]), every_seconds=60)
        watchdogs.append(watchdog)
        return watchdog

    with TestClient(create_app(StubRunner, lambda: KEY, make_watchdog=make_watchdog)):
        assert any(t.name == "watchdog" and t.is_alive() for t in threading.enumerate())
    assert len(watchdogs) == 1
