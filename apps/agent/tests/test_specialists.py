# pyright: reportUnknownMemberType=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""The specialists: the claim agent consults the document checker, the duplicate check and the
medical reviewer as tools, and their findings come back as evidence it cites."""

from langgraph.checkpoint.memory import InMemorySaver
from stubs import START, FakeApi, FakeClaude, FakeContext, config, decide, graph_for, tool_use

from undercover_agent.graph import build_graph
from undercover_agent.tools import duplicates_text


def test_the_agent_consults_the_specialists_and_records_their_cost() -> None:
    api = FakeApi()
    api.seen_elsewhere = [{"receipt": 1, "matches": []}]
    claude = FakeClaude(
        [
            tool_use("check_documents", {}, 1),
            tool_use("find_duplicate_receipts", {}, 2),
            tool_use("review_medical", {}, 3),
            decide("approve", 120.0, 4),
        ]
    )
    graph_for(api, claude).invoke(START, config())
    assert claude.consulted == ["documents", "medical"]
    results = [content for kind, content in api.steps_recorded if kind == "tool_result"]
    assert any("documents look fine." in r for r in results)
    assert any("not seen on any other claim" in r for r in results)
    # The screening call, four claim-agent turns and two specialists.
    assert api.calls_recorded == 7
    assert api.paid == [120.0]


def test_a_receipt_on_another_claim_is_named() -> None:
    found = [{"receipt": 1, "matches": [{"claim_id": "CLM-1902", "match": "exact"}]}]
    assert duplicates_text(found) == "Receipt 1: also on CLM-1902 (exact match)."
    assert duplicates_text([]) == "The claim has no receipts to check."


def test_specialists_count_against_the_model_call_limit() -> None:
    api = FakeApi()
    claude = FakeClaude(
        [
            tool_use("check_documents", {}, 1),
            tool_use("review_medical", {}, 2),
            decide("approve", 120.0, 3),
        ]
    )
    graph = build_graph(api, claude, FakeContext(), InMemorySaver(), max_model_calls=3)
    final = graph.invoke(START, config())
    # Two turns and one specialist reach the limit: the second specialist and the third turn
    # never run, and the claim goes to a person.
    assert claude.consulted == ["documents"]
    assert claude.turns_taken == 2
    assert final["model_calls"] == 3
    assert (api.decision or {}).get("decision") == "refer"
    assert api.paid == []
