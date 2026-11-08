"""The Copilot with Claude and the api stood in: it reads as the handler, and pays a held claim
only after the handler confirms on a card."""

from typing import Any

import pytest
from anthropic.types import Message
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from undercover_copilot.graph import build_graph
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

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> Message:
        self.seen.append(list(messages))
        return self.turns.pop(0)


class FakeApi(StaffApi):
    """The staff api for one token; Marcus can't sign off over the limit."""

    paid: list[str] = []

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
        ]

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


def make_client(claude: FakeClaude) -> TestClient:
    FakeApi.paid = []
    app = create_app(
        lambda: build_graph(claude, InMemorySaver(), max_model_calls=5),
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
