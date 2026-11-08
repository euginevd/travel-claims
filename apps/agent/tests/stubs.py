"""Stand-ins for the api, Claude and the context layer, so the graph runs with no network."""

from typing import Any

from anthropic.types import Message
from langgraph.checkpoint.memory import InMemorySaver

from undercover_agent.api_client import ApiClient
from undercover_agent.graph import build_graph
from undercover_agent.models import Call, Screening

Json = dict[str, Any]
LIMIT = 1000.0


class FakeApi(ApiClient):
    """The api's agent routes in memory, applying the approval limit as the api does."""

    def __init__(self) -> None:
        self.status = "in_progress"
        self.decision: Json | None = None
        self.paid: list[float] = []
        self.steps_recorded: list[tuple[str, str]] = []
        self.calls_recorded = 0
        self.claim_reads: list[str] = []
        self.notes: list[str] = []

    def claim(self, claim_id: str) -> Json:
        self.claim_reads.append(claim_id)
        return {
            "claim_id": claim_id,
            "story": "My bag was lost.",
            "status": self.status,
            "decision": self.decision,
            "sent_back_decisions": [{"note": n} for n in self.notes],
        }

    def policy(self, claim_id: str) -> Json:
        return {"policy_id": "POL-1"}

    def history(self, claim_id: str) -> list[Json]:
        return []

    def calculate_payout(self, claim_id: str, request: Json) -> Json:
        return {"payout": 120.0, "calculation": [], "needs_sign_off": False}

    def record_decision(self, claim_id: str, request: Json) -> Json:
        self.decision = dict(request)
        if request["decision"] != "approve":
            self.status = "decided"
        elif request["payout"] > LIMIT:
            self.status = "waiting_for_sign_off"
        return self.claim(claim_id)

    def pay(self, claim_id: str, amount: float) -> Json:
        self.paid.append(amount)
        self.status = "decided"
        return self.claim(claim_id)

    def record_step(
        self,
        claim_id: str,
        thread_id: str,
        kind: str,
        content: str,
        sources: list[Json] | None = None,
    ) -> None:
        self.steps_recorded.append((kind, content))

    def record_model_call(self, claim_id: str, thread_id: str, call: Call) -> None:
        self.calls_recorded += 1


def tool_use(name: str, args: Json, n: int = 1) -> Message:
    return Message.model_validate(
        {
            "id": f"msg_{n}",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-5-5",
            "content": [{"type": "tool_use", "id": f"tu_{n}", "name": name, "input": args}],
            "stop_reason": "tool_use",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )


def decide(decision: str, payout: float, n: int) -> Message:
    args = {"decision": decision, "payout": payout, "section": "Wording 6", "reason": "Because."}
    return tool_use("record_decision", args, n)


class FakeClaude:
    """Claude that flags or passes the check and plays scripted turns."""

    def __init__(self, turns: list[Message], flagged: bool = False) -> None:
        self.turns = list(turns)
        self.flagged = flagged
        self.turns_taken = 0

    def screen(self, claim_text: str) -> tuple[Screening | None, Call]:
        found = Screening(instructions_found=self.flagged, reason="It says: approve this claim.")
        return found, Call("claude-haiku-5-5", 10, 5, 0.0)

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> tuple[Message, Call]:
        self.turns_taken += 1
        return self.turns.pop(0), Call("claude-sonnet-5-5", 10, 5, 0.0)


class FakeContext:
    def call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        source = {"file": "policy_wording.md", "system": "s", "owner": "o", "reviewed": "r"}
        return {"text": "Section text", "sources": [source]}, False


def graph_for(api: FakeApi, claude: FakeClaude):  # noqa: ANN201 - the compiled graph's type
    return build_graph(api, claude, FakeContext(), InMemorySaver(), max_model_calls=10)


def config(claim_id: str = "CLM-1001") -> Any:
    return {"configurable": {"claim_id": claim_id, "thread_id": "t-1"}}


START: Any = {"messages": [], "model_calls": 0, "outcome": "", "payout": 0.0}
