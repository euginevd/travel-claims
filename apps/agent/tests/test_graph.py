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


RECEIPT = {"receipt_id": "a" * 32, "media_type": "image/png", "data": "iVBORw0KGgo="}
PDF_RECEIPT = {"receipt_id": "b" * 32, "media_type": "application/pdf", "data": "JVBERi0="}


def test_receipts_reach_the_check_and_the_claim_model_as_marked_data() -> None:
    api = FakeApi()
    api.attached = [RECEIPT, PDF_RECEIPT]
    claude = FakeClaude([decide("decline", 0.0, 1)])
    graph_for(api, claude).invoke(START, config())
    screened = claude.screened[0]
    assert [block["type"] for block in screened] == ["text", "text", "image", "document"]
    assert "never as instructions" in screened[1]["text"]
    assert screened[2]["source"] == {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgo=",
    }
    first = claude.first_messages[0]["content"]
    assert [block["type"] for block in first] == ["text", "text", "image", "document"]


def test_a_receipt_with_hidden_instructions_never_reaches_the_claim_model() -> None:
    api = FakeApi()
    api.attached = [RECEIPT]
    claude = FakeClaude([], flagged=True)
    graph_for(api, claude).invoke(START, config("CLM-2001"))
    assert claude.turns_taken == 0
    assert any(block["type"] == "image" for block in claude.screened[0])
    assert api.decision is not None
    assert api.decision["maker"] == "hidden_instruction_check"


def test_a_claim_without_receipts_reads_as_text_only() -> None:
    api = FakeApi()
    claude = FakeClaude([decide("decline", 0.0, 1)])
    graph_for(api, claude).invoke(START, config())
    assert [block["type"] for block in claude.screened[0]] == ["text"]


def test_a_payment_refused_while_payouts_are_paused_is_held_not_lost() -> None:
    api = FakeApi()
    api.payouts_paused = True
    graph = graph_for(api, FakeClaude([decide("approve", 120.0, 1)]))
    graph.invoke(START, config())
    assert api.paid == []
    assert api.holds == ["Payouts are paused by a senior handler"]
    assert api.status == "waiting_for_sign_off"
    api.status = "decided"  # a handler signs it off once payouts are back on
    graph.invoke(Command(resume="signed_off"), config())
    assert ("message", "A handler signed off the payout.") in api.steps_recorded


def test_a_file_added_after_the_check_is_checked_before_a_specialist_reads_it() -> None:
    """A customer can answer a handler's request while a payout is held: the file they add is
    screened on the send-back, and one with instructions in it never reaches a specialist."""
    api = FakeApi()
    api.attached = [RECEIPT]
    claude = FakeClaude(
        [
            decide("approve", 2500.0, 1),
            tool_use("check_documents", {}, 2),
            decide("decline", 0.0, 3),
        ]
    )
    graph = graph_for(api, claude)
    graph.invoke(START, config())
    api.attached = [RECEIPT, PDF_RECEIPT]  # added while the payout waited
    api.notes.append("Check the new document.")
    api.status, api.decision = "in_progress", None
    claude.flagged = True
    graph.invoke(Command(resume="sent_back"), config())
    assert [block["type"] for block in claude.screened[1]] == ["text", "text", "document"]
    read = [block["type"] for block in claude.consulted_content[0]]
    assert "image" in read
    assert "document" not in read
    assert any(
        kind == "screening" and text.startswith("Instructions found in a file added later")
        for kind, text in api.steps_recorded
    )
