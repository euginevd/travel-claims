# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""The claim graph: the hidden-instruction check first, then the claim agent's turns and tools
until it records a decision, then code pays it or waits for a handler's sign-off.

Its progress is saved after every step on the claim's thread, so a stopped claim carries on
from where it got to, and a held payout waits with interrupt() until the api resumes it.
"""

import operator
from importlib.resources import files
from typing import Annotated, Any, Literal, TypedDict, cast

from anthropic.types import Message
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from undercover_agent.api_client import ApiClient
from undercover_agent.models import Call, Claude
from undercover_agent.tools import (
    TOOLS,
    Context,
    as_text,
    claim_as_read,
    run_tool,
    with_receipts,
)

Json = dict[str, Any]
INSTRUCTIONS = files("undercover_agent").joinpath("instructions.md").read_text(encoding="utf-8")
SCREEN_SECTION = "Claims manual: referral when a claim needs a person's judgement"

Outcome = Literal["", "referred", "approved", "held", "decided", "signed_off", "stopped"]


class ClaimState(TypedDict):
    """What the graph keeps for one claim, saved after every step."""

    messages: Annotated[list[Json], operator.add]
    model_calls: Annotated[int, operator.add]
    outcome: Outcome
    payout: float


def ids(config: RunnableConfig) -> tuple[str, str]:
    """The claim and thread the graph is working, from its config, never from the model."""
    configurable = config.get("configurable") or {}
    return str(configurable["claim_id"]), str(configurable["thread_id"])


def build_graph(  # noqa: C901, PLR0915 - the nodes are closures over their dependencies
    api: ApiClient,
    claude: Claude,
    context: Context,
    checkpointer: BaseCheckpointSaver[Any],
    max_model_calls: int,
) -> CompiledStateGraph[ClaimState, None, ClaimState, ClaimState]:
    """The claim graph, wired to the api, Claude, the context layer and a checkpointer."""

    def record_call(claim_id: str, thread_id: str, call: Call) -> None:
        api.record_model_call(claim_id, thread_id, call)

    def refer(
        claim_id: str, reason: str, maker: str, section: str, checklist: list[Json] | None = None
    ) -> Json:
        request = {
            "decision": "refer",
            "payout": 0,
            "section": section,
            "reason": reason,
            "maker": maker,
            "checklist": checklist or [],
        }
        return api.record_decision(claim_id, request)

    def screen(state: ClaimState, config: RunnableConfig) -> Json:
        claim_id, thread_id = ids(config)
        claim = claim_as_read(api.claim(claim_id))
        receipts = api.receipts(claim_id)
        found, call = claude.screen(with_receipts(as_text(claim), receipts))
        record_call(claim_id, thread_id, call)
        if found is None:
            found_reason = "The check couldn't read the claim, so a person should look at it."
            flagged = True
        else:
            found_reason, flagged = found.reason, found.instructions_found
        verdict = "Instructions found" if flagged else "No instructions found"
        api.record_step(claim_id, thread_id, "screening", f"{verdict}. {found_reason}")
        if flagged:
            reason = (
                f"The hidden-instruction check referred this claim to a handler: {found_reason}"
            )
            check = {
                "label": "Instructions hidden in the claim",
                "result": "fail",
                "detail": found_reason[:500],
                "source": "Claim",
            }
            refer(claim_id, reason, "hidden_instruction_check", SCREEN_SECTION, [check])
            return {"outcome": "referred"}
        start = f"Your claim is {claim_id}. Work it and record your decision."
        first = {"role": "user", "content": with_receipts(start, receipts)}
        return {"messages": [first], "outcome": ""}

    def agent(state: ClaimState, config: RunnableConfig) -> Json:
        claim_id, thread_id = ids(config)
        if state["model_calls"] >= max_model_calls:
            reason = "The agent reached its limit of model calls without deciding."
            api.record_step(claim_id, thread_id, "error", reason)
            refer(claim_id, reason, "claim_agent", "Claims manual: referral")
            return {"outcome": "referred"}
        reply, call = claude.turn(INSTRUCTIONS, TOOLS, state["messages"])
        record_call(claim_id, thread_id, call)
        for text in texts(reply):
            api.record_step(claim_id, thread_id, "message", text)
        assistant = {"role": "assistant", "content": blocks(reply)}
        if reply.stop_reason == "refusal":
            api.record_step(claim_id, thread_id, "refusal", "The model declined to continue.")
            refer(claim_id, "The model declined to work this claim.", "claim_agent", "Referral")
            return {"messages": [assistant], "model_calls": 1, "outcome": "referred"}
        if reply.stop_reason != "tool_use":
            nudge = {"role": "user", "content": "Record your decision with record_decision."}
            return {"messages": [assistant, nudge], "model_calls": 1}
        return {"messages": [assistant], "model_calls": 1}

    def act(state: ClaimState, config: RunnableConfig) -> Json:
        claim_id, thread_id = ids(config)
        calls = [b for b in state["messages"][-1]["content"] if b.get("type") == "tool_use"]
        results: list[Json] = []
        outcome: Outcome = ""
        payout = 0.0
        for block in calls:
            name, args = str(block["name"]), cast(Json, block.get("input") or {})
            api.record_step(claim_id, thread_id, "tool_call", f"{name} {as_text(args)}")
            result = run_tool(api, context, claim_id, name, args)
            kind = "error" if result.is_error else ("lookup" if result.sources else "tool_result")
            api.record_step(claim_id, thread_id, kind, result.text, result.sources)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block["id"],
                    "content": result.text,
                    "is_error": result.is_error,
                }
            )
            if result.claim_after_decision is not None:
                outcome, payout = settled(result.claim_after_decision)
        return {
            "messages": [{"role": "user", "content": results}],
            "outcome": outcome,
            "payout": payout,
        }

    def settle(state: ClaimState, config: RunnableConfig) -> Json:
        claim_id, thread_id = ids(config)
        if state["outcome"] == "approved":
            api.pay(claim_id, state["payout"])
            api.record_step(claim_id, thread_id, "message", "Paid the approved payout.")
            return {"outcome": "decided"}
        if state["outcome"] != "held":
            return {}
        answer = interrupt({"claim_id": claim_id, "payout": state["payout"]})
        if answer == "signed_off":
            api.record_step(claim_id, thread_id, "message", "A handler signed off the payout.")
            return {"outcome": "signed_off"}
        note = latest_note(api.claim(claim_id))
        review = (
            "A senior handler sent your decision back with this note. Check it against the "
            f"wording and the manual, then decide again:\n\n{note}"
        )
        return {"messages": [{"role": "user", "content": review}], "outcome": ""}

    graph = StateGraph(ClaimState)
    graph.add_node("screen", screen)
    graph.add_node("agent", agent)
    graph.add_node("act", act)
    graph.add_node("settle", settle)
    graph.add_edge(START, "screen")
    graph.add_conditional_edges("screen", lambda s: END if s["outcome"] else "agent")
    graph.add_conditional_edges("agent", after_agent)
    graph.add_conditional_edges("act", lambda s: "settle" if s["outcome"] else "agent")
    graph.add_conditional_edges("settle", lambda s: "agent" if not s["outcome"] else END)
    return graph.compile(checkpointer=checkpointer)


def after_agent(state: ClaimState) -> str:
    """Run the model's tool calls, or stop once the claim is referred."""
    if state["outcome"]:
        return END
    last = state["messages"][-1]
    has_calls = last["role"] == "assistant" and any(
        b.get("type") == "tool_use" for b in last["content"]
    )
    return "act" if has_calls else "agent"


def settled(claim: Json) -> tuple[Outcome, float]:
    """Where a recorded decision left the claim: to pay, held for sign-off, or decided."""
    decision = cast(Json, claim.get("decision") or {})
    payout = float(decision.get("payout") or 0)
    status = claim.get("status")
    if status == "waiting_for_sign_off":
        return "held", payout
    if decision.get("decision") == "approve" and status == "in_progress":
        return "approved", payout
    return "decided", payout


def blocks(reply: Message) -> list[Json]:
    """The reply's content as sent back to the API next turn, unchanged."""
    return [block.model_dump(mode="json", exclude_none=True) for block in reply.content]


def texts(reply: Message) -> list[str]:
    return [b.text for b in reply.content if b.type == "text" and b.text.strip()]


def latest_note(claim: Json) -> str:
    sent_back = cast(list[Json], claim.get("sent_back_decisions") or [])
    return str(sent_back[-1]["note"]) if sent_back else "(no note)"
