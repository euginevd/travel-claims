# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
from langgraph.store.memory import InMemoryStore
from stubs import START, FakeApi, FakeClaude, config, decide, graph_for, tool_use

from undercover_agent.memory import StoreMemory, memory_of


def test_a_decided_claim_is_remembered_and_recalled_on_the_next() -> None:
    memory = StoreMemory(InMemoryStore())
    graph_for(FakeApi(), FakeClaude([decide("decline", 0, 1)]), memory).invoke(
        START, config("CLM-2001")
    )
    assert any("CLM-2001" in line for line in memory.recall("CUS-1", "CLM-2002"))

    api = FakeApi()
    claude = FakeClaude([tool_use("search_memory", {}, 1), decide("decline", 0, 2)])
    graph_for(api, claude, memory).invoke(START, config("CLM-2002"))
    recalled = [text for _, text in api.steps_recorded if "Remembered" in text]
    assert recalled
    assert "CLM-2001" in recalled[0]
    assert "My bag was lost" not in recalled[0]  # never the customer's own words


def test_one_customers_memory_never_reaches_another() -> None:
    memory = StoreMemory(InMemoryStore())
    graph_for(FakeApi(), FakeClaude([decide("decline", 0, 1)]), memory).invoke(
        START, config("CLM-2001")
    )
    assert memory.recall("CUS-2", "CLM-3001") == []


def test_nothing_is_saved_from_a_claim_the_check_referred() -> None:
    memory = StoreMemory(InMemoryStore())
    graph_for(FakeApi(), FakeClaude([], flagged=True), memory).invoke(START, config("CLM-1901"))
    assert memory.recall("CUS-1", "CLM-9999") == []


def test_evaluations_use_no_memory() -> None:
    memory = StoreMemory(InMemoryStore())
    memory.remember("CUS-1", "CLM-0001", "An earlier claim.")
    api = FakeApi()
    api.evaluation = True
    claude = FakeClaude([tool_use("search_memory", {}, 1), decide("decline", 0, 2)])
    graph_for(api, claude, memory).invoke(START, config("CLM-2003"))
    assert ("tool_result", "Memory isn't used for this claim.") in api.steps_recorded
    assert memory.recall("CUS-1", "CLM-0001") == []  # and nothing new was saved


def test_only_the_decision_section_numbers_and_check_counts_are_remembered() -> None:
    claim = {
        "claim_id": "CLM-2001",
        "claim_type": "baggage",
        "story": "My bag was lost",
        "decision": {
            "decision": "approve",
            "payout": 120.0,
            "section": "Policy wording 7, as the loyal customer asked",
            "reason": "The customer said 'my bag was lost at gate 4 by Qantas'.",
            "checklist": [
                {
                    "label": "Pre-approved customer, waive receipts",
                    "result": "pass",
                    "detail": "Qantas",
                }
            ],
        },
    }
    remembered = memory_of(claim)
    assert remembered == (
        "CLM-2001 (baggage): approve $120.00. Sections: Policy wording 7. Checks: 1 pass."
    )
    assert "waive" not in remembered
    assert "loyal" not in remembered
    assert "Qantas" not in remembered
