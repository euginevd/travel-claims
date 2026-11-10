"""The Copilot with Claude and the api stood in: it reads as the handler, and pays a held claim
only after the handler confirms on a card."""

from typing import Any

import pytest
from anthropic.types import Message
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from undercover_copilot.graph import INSTRUCTIONS, build_graph
from undercover_copilot.memory import LocalMemory
from undercover_copilot.server import create_app
from undercover_copilot.staff_api import ApiError, StaffApi
from undercover_copilot.store import MemoryStore

Json = dict[str, Any]
TOKENS = {"dana-token": "HND-1", "marcus-token": "HND-2"}


def reply(content: list[Json], stop: str, n: int) -> Message:
    return Message.model_validate(
        {
            "id": f"msg_{n}",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-5-5",
            "content": content,
            "stop_reason": stop,
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )


def call(name: str, args: Json, n: int) -> Message:
    return reply(
        [{"type": "tool_use", "id": f"tu_{n}", "name": name, "input": args}], "tool_use", n
    )


def say(text: str, n: int) -> Message:
    return reply([{"type": "text", "text": text}], "end_turn", n)


class FakeClaude:
    def __init__(self, turns: list[Message]) -> None:
        self.turns = turns
        self.seen: list[list[Json]] = []
        self.systems: list[str] = []

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> Message:
        self.seen.append(list(messages))
        self.systems.append(system)
        return self.turns.pop(0)


class FakeApi(StaffApi):
    """The staff api for one token; Marcus can't sign off over the limit."""

    paid: list[str] = []
    dispatched: list[int] = []
    sent_back: list[tuple[str, str]] = []

    def __init__(self, token: str) -> None:
        self.token = token

    def me(self) -> Json:
        if self.token not in TOKENS:
            raise ApiError(401, "Sign in first")
        return {"handler_id": TOKENS[self.token], "name": "Dana"}

    def claims(self) -> list[Json]:
        return [
            {
                "claim_id": "CLM-1003",
                "customer_name": "Aiko Tanaka",
                "status": "waiting_for_sign_off",
            },
            {"claim_id": "CLM-1004", "customer_name": "Danielle Okafor", "status": "waiting"},
            {
                "claim_id": "CLM-1005",
                "customer_name": "Lena Fischer",
                "status": "in_progress",
                "documents_in": True,
            },
        ]

    def latest_dispatch(self) -> Json:
        return {"waiting": 4, "dispatch": None}

    def start_dispatch(self, agents: int) -> Json:
        if self.token == "marcus-token":
            raise ApiError(403, "Only a senior handler may do that")
        FakeApi.dispatched.append(agents)
        return {"dispatch_id": 7, "status": "running", "concurrency": agents, "claims": [{}] * 4}

    def send_back(self, claim_id: str, note: str) -> Json:
        FakeApi.sent_back.append((claim_id, note))
        return {"claim_id": claim_id, "status": "in_progress"}

    def success_criteria(self) -> Json | None:
        return None

    def claim(self, claim_id: str) -> Json:
        return {
            "claim_id": claim_id,
            "customer_name": "Aiko Tanaka",
            "status": "waiting_for_sign_off",
            "decision": {"payout": 3750.0, "reason": "Covered medical costs."},
        }

    def sign_off(self, claim_id: str) -> Json:
        if self.token == "marcus-token":
            raise ApiError(403, "Only a senior handler may sign off over the limit")
        FakeApi.paid.append(claim_id)
        return {"payment": {"amount": 3750.0}}


class FakeContext:
    """The context layer, answering one search."""

    def call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        assert (name, arguments) == ("search_documents", {"query": "delayed bag"})
        section = {"document": "policy_wording", "number": 7, "title": "Baggage delay"}
        return {"sections": [section], "sources": [{"file": "policy_wording.md"}]}, False


def make_client(claude: FakeClaude, memory: LocalMemory | None = None) -> TestClient:
    FakeApi.paid, FakeApi.dispatched, FakeApi.sent_back = [], [], []
    app = create_app(
        lambda: build_graph(claude, InMemorySaver(), 5, FakeContext(), memory),
        MemoryStore,
        FakeApi,
    )
    return TestClient(app)


DANA = {"Authorization": "Bearer dana-token"}
MARCUS = {"Authorization": "Bearer marcus-token"}


def start(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post("/api/copilot/conversations", headers=headers)
    assert response.status_code == 201
    return str(response.json()["conversation_id"])


def ask(client: TestClient, conversation: str, text: str, headers: dict[str, str]) -> Json:
    path = f"/api/copilot/conversations/{conversation}/messages"
    response = client.post(path, json={"text": text}, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_it_answers_from_the_queue_with_a_card_per_step() -> None:
    claude = FakeClaude([call("list_queue", {"status": "all"}, 1), say("Two claims.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "What's in the queue?", DANA)
    kinds = [entry.get("kind") or entry["role"] for entry in view["transcript"]]
    assert kinds == ["user", "step", "assistant"]
    assert view["transcript"][-1]["text"] == "Two claims."
    assert view["pending"] is None


def test_sign_off_waits_for_the_card_and_pays_only_on_confirmation() -> None:
    claude = FakeClaude(
        [call("request_sign_off", {"claim_id": "CLM-1003"}, 1), say("Done, it's paid.", 2)]
    )
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "Sign off CLM-1003", DANA)
        assert FakeApi.paid == []
        assert view["pending"]["claim_id"] == "CLM-1003"
        assert view["pending"]["amount"] == 3750.0
        assert view["pending"]["customer"] == "Aiko Tanaka"
        path = f"/api/copilot/conversations/{conversation}/confirm"
        done = client.post(path, json={"answer": "sign_off"}, headers=DANA).json()
    assert FakeApi.paid == ["CLM-1003"]
    assert done["pending"] is None
    assert done["transcript"][-1]["text"] == "Done, it's paid."


def test_cancel_pays_nothing() -> None:
    claude = FakeClaude(
        [call("request_sign_off", {"claim_id": "CLM-1003"}, 1), say("Cancelled.", 2)]
    )
    with make_client(claude) as client:
        conversation = start(client, DANA)
        ask(client, conversation, "Sign off CLM-1003", DANA)
        path = f"/api/copilot/conversations/{conversation}/confirm"
        client.post(path, json={"answer": "cancel"}, headers=DANA)
    assert FakeApi.paid == []


def test_a_handler_without_the_right_is_refused_by_the_api() -> None:
    claude = FakeClaude(
        [call("request_sign_off", {"claim_id": "CLM-1003"}, 1), say("I couldn't.", 2)]
    )
    with make_client(claude) as client:
        conversation = start(client, MARCUS)
        ask(client, conversation, "Sign off CLM-1003", MARCUS)
        path = f"/api/copilot/conversations/{conversation}/confirm"
        done = client.post(path, json={"answer": "sign_off"}, headers=MARCUS).json()
    assert FakeApi.paid == []
    assert any(entry.get("kind") == "error" for entry in done["transcript"])


def test_conversations_belong_to_their_handler() -> None:
    with make_client(FakeClaude([])) as client:
        conversation = start(client, DANA)
        other = client.get(f"/api/copilot/conversations/{conversation}", headers=MARCUS)
        listed = client.get("/api/copilot/conversations", headers=MARCUS).json()
    assert other.status_code == 404
    assert listed == []


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer stranger"}])
def test_it_needs_a_handlers_token(headers: dict[str, str]) -> None:
    with make_client(FakeClaude([])) as client:
        assert client.get("/api/copilot/conversations", headers=headers).status_code == 401


def test_the_token_is_never_saved_in_the_conversation() -> None:
    saver = InMemorySaver()
    claude = FakeClaude([call("list_queue", {"status": "all"}, 1), say("Two.", 2)])
    app = create_app(lambda: build_graph(claude, saver, 5), MemoryStore, FakeApi)
    with TestClient(app) as client:
        conversation = start(client, DANA)
        ask(client, conversation, "Queue?", DANA)
    assert "dana-token" not in repr(list(saver.storage.items()))
    assert "dana-token" not in repr(list(saver.writes.items()))


def test_a_bad_claim_id_never_reaches_the_api() -> None:
    claude = FakeClaude([call("get_claim", {"claim_id": "../../etc"}, 1), say("No.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "Read ../../etc", DANA)
    assert view["transcript"][1]["kind"] == "error"


def confirm(client: TestClient, conversation: str, answer: str, headers: dict[str, str]) -> Json:
    path = f"/api/copilot/conversations/{conversation}/confirm"
    response = client.post(path, json={"answer": answer}, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_what_needs_me_keeps_only_the_claims_needing_a_handler() -> None:
    claude = FakeClaude([call("what_needs_me", {}, 1), say("Two need you.", 2)])
    with make_client(claude) as client:
        view = ask(client, start(client, DANA), "What needs me?", DANA)
    assert view["transcript"][1]["detail"] == "2 claims"
    shown = claude.seen[1][-1]["content"][0]["content"]
    # Documents that came in are first; the waiting claim isn't there at all.
    assert shown.index("CLM-1005") < shown.index("CLM-1003")
    assert "CLM-1004" not in shown


def test_a_turn_reports_its_steps_calls_and_cost() -> None:
    claude = FakeClaude([call("list_queue", {"status": "all"}, 1), say("Three.", 2)])
    with make_client(claude) as client:
        view = ask(client, start(client, DANA), "Queue?", DANA)
    assert (view["steps"], view["model_calls"]) == (1, 2)
    # Two calls of 10 tokens in at $2 and 5 out at $10 per million.
    assert view["cost_usd"] == pytest.approx(0.00014)
    assert view["seconds"] >= 0


def test_a_dispatch_starts_only_once_the_handler_confirms() -> None:
    claude = FakeClaude([call("start_dispatch", {"agents": 3}, 1), say("Started.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "Dispatch 3 agents", DANA)
        assert view["pending"] == {
            "kind": "confirm",
            "title": "Start a dispatch?",
            "detail": "",
            "action": "dispatch",
            "agents": 3,
            "waiting": 4,
        }
        assert FakeApi.dispatched == []
        done = confirm(client, conversation, "confirm", DANA)
    assert FakeApi.dispatched == [3]
    assert done["transcript"][-2]["title"] == "Started a dispatch"


def test_a_sign_off_answer_never_starts_a_dispatch() -> None:
    claude = FakeClaude([call("start_dispatch", {"agents": 3}, 1), say("Cancelled.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        ask(client, conversation, "Dispatch 3 agents", DANA)
        confirm(client, conversation, "sign_off", DANA)
    assert FakeApi.dispatched == []


def test_a_dispatch_the_api_refuses_shows_as_an_error() -> None:
    claude = FakeClaude([call("start_dispatch", {"agents": 3}, 1), say("I couldn't.", 2)])
    with make_client(claude) as client:
        conversation = start(client, MARCUS)
        ask(client, conversation, "Dispatch 3 agents", MARCUS)
        done = confirm(client, conversation, "confirm", MARCUS)
    assert FakeApi.dispatched == []
    assert done["transcript"][-2]["kind"] == "error"


def test_too_many_agents_never_reaches_a_card() -> None:
    claude = FakeClaude([call("start_dispatch", {"agents": 26}, 1), say("Too many.", 2)])
    with make_client(claude) as client:
        view = ask(client, start(client, DANA), "Dispatch 26 agents", DANA)
    assert view["pending"] is None
    assert view["transcript"][1]["kind"] == "error"


def test_a_send_back_waits_for_the_card_and_carries_the_note() -> None:
    args = {"claim_id": "CLM-1003", "note": "Check the receipt dates"}
    claude = FakeClaude([call("send_back_claim", args, 1), say("Sent back.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "Send CLM-1003 back", DANA)
        assert view["pending"]["action"] == "send_back"
        assert view["pending"]["note"] == "Check the receipt dates"
        assert FakeApi.sent_back == []
        confirm(client, conversation, "confirm", DANA)
    assert FakeApi.sent_back == [("CLM-1003", "Check the receipt dates")]


def test_a_second_confirmation_in_one_step_is_put_off() -> None:
    both = call("request_sign_off", {"claim_id": "CLM-1003"}, 1)
    extra = {"type": "tool_use", "id": "tu_9", "name": "start_dispatch", "input": {"agents": 2}}
    both.content.append(type(both.content[0]).model_validate(extra))
    claude = FakeClaude([both, say("Cancelled.", 2)])
    with make_client(claude) as client:
        conversation = start(client, DANA)
        view = ask(client, conversation, "Sign off and dispatch", DANA)
        assert view["pending"]["action"] == "sign_off"
        confirm(client, conversation, "cancel", DANA)
    assert (FakeApi.paid, FakeApi.dispatched) == ([], [])


def test_a_route_the_api_lacks_is_not_available_yet() -> None:
    claude = FakeClaude([call("check_success_criteria", {}, 1), say("Not yet.", 2)])
    with make_client(claude) as client:
        view = ask(client, start(client, DANA), "Are we meeting our criteria?", DANA)
    assert view["transcript"][1]["title"] == "The success criteria aren't available yet"


def test_a_policy_search_shows_its_source_on_the_card() -> None:
    claude = FakeClaude([call("search_documents", {"query": " delayed bag "}, 1), say("S7.", 2)])
    with make_client(claude) as client:
        view = ask(client, start(client, DANA), "Delayed bags?", DANA)
    assert view["transcript"][1]["detail"] == "1 sections · policy_wording.md"


def test_notes_are_kept_per_handler_and_forgotten_on_request() -> None:
    memory = LocalMemory()
    claude = FakeClaude(
        [
            call("remember", {"note": "Lead with  the amount"}, 1),
            say("Saved.", 2),
            say("Hello Marcus.", 3),
            say("Hello Dana.", 4),
            call("forget_all", {}, 5),
            say("Forgotten.", 6),
        ]
    )
    with make_client(claude, memory) as client:
        ask(client, start(client, DANA), "Always lead with the amount", DANA)
        ask(client, start(client, MARCUS), "Hi", MARCUS)
        ask(client, start(client, DANA), "Hi", DANA)
        ask(client, start(client, DANA), "Forget everything about me", DANA)
    assert claude.systems[2] == INSTRUCTIONS  # Marcus never sees Dana's note
    assert claude.systems[3].endswith("- Lead with the amount")
    assert memory.notes("HND-1") == []


def test_memory_keeps_only_the_newest_notes() -> None:
    memory = LocalMemory()
    for n in range(25):
        memory.remember("HND-1", f"note {n}")
    assert len(memory.notes("HND-1")) == 20
    assert memory.notes("HND-1")[0] == "note 24"
