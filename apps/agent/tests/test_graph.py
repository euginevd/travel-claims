# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
from langgraph.types import Command
from stubs import START, FakeApi, FakeClaude, config, decide, graph_for, tool_use


def test_an_approval_under_the_limit_is_paid_by_code() -> None:
    api = FakeApi()
    claude = FakeClaude(
        [
            tool_use("read_section", {"document": "policy_wording", "number": 6}, 1),
            decide("approve", 120.0, 2),
        ]
    )
    graph_for(api, claude).invoke(START, config())
    assert api.paid == [120.0]
    assert api.status == "decided"
    kinds = [kind for kind, _ in api.steps_recorded]
    assert kinds[0] == "screening"
    assert "lookup" in kinds


def test_a_payout_over_the_limit_waits_then_finishes_on_sign_off() -> None:
    api = FakeApi()
    graph = graph_for(api, FakeClaude([decide("approve", 2500.0, 1)]))
    graph.invoke(START, config())
    assert api.status == "waiting_for_sign_off"
    assert api.paid == []
    api.status = "decided"  # the api pays on sign-off
    graph.invoke(Command(resume="signed_off"), config())
    assert api.paid == []
    assert ("message", "A handler signed off the payout.") in api.steps_recorded


def test_a_decision_sent_back_is_decided_again() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("approve", 2500.0, 1), decide("decline", 0.0, 2)])
    graph = graph_for(api, claude)
    graph.invoke(START, config())
    api.notes.append("Check the waiting period.")
    api.status, api.decision = "in_progress", None  # what the api does on send-back
    graph.invoke(Command(resume="sent_back"), config())
    assert api.decision is not None
    assert api.decision["decision"] == "decline"
    assert claude.turns_taken == 2


def test_a_claim_with_hidden_instructions_never_reaches_the_claim_model() -> None:
    api = FakeApi()
    claude = FakeClaude([], flagged=True)
    graph_for(api, claude).invoke(START, config("CLM-1901"))
    assert claude.turns_taken == 0
    assert api.decision is not None
    assert api.decision["decision"] == "refer"
    assert api.decision["maker"] == "hidden_instruction_check"
