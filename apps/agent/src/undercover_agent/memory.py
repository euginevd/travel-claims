"""The agent's memory of each customer: their earlier claims and decisions, kept in LangGraph's
store under that customer alone. It holds what was claimed and decided, never the story or the
documents, nothing from a claim the hidden-instruction check referred, and nothing from an
evaluation. The claim history in the records still counts for repeat claims."""

from typing import Any, Protocol

from langgraph.store.base import BaseStore

Json = dict[str, Any]
NAMESPACE = "customers"
RECALL_LIMIT = 10


class Memory(Protocol):
    """What the agent remembers about each customer."""

    def recall(self, customer_id: str, current_claim: str) -> list[str]: ...

    def remember(self, customer_id: str, claim_id: str, text: str) -> None: ...


class StoreMemory:
    """Memory on a LangGraph store, one namespace per customer."""

    def __init__(self, store: BaseStore) -> None:
        self._store = store

    def recall(self, customer_id: str, current_claim: str) -> list[str]:
        items = self._store.search((NAMESPACE, customer_id), limit=RECALL_LIMIT + 1)
        return [
            str(item.value["text"])
            for item in items
            if item.key != current_claim and isinstance(item.value.get("text"), str)
        ][:RECALL_LIMIT]

    def remember(self, customer_id: str, claim_id: str, text: str) -> None:
        self._store.put((NAMESPACE, customer_id), claim_id, {"text": text}, index=False)


def uses_memory(claim: Json) -> bool:
    """Whether memory applies to a claim: never to an evaluation's copies."""
    return not claim.get("evaluation")


def memory_of(claim: Json) -> str:
    """What to remember of a decided claim: the facts and the decision, not the customer's
    words."""
    decision: Json = claim.get("decision") or {}
    outcome = str(decision.get("decision", "undecided"))
    payout = float(decision.get("payout") or 0)
    amount = f" ${payout:,.2f}" if outcome == "approve" else ""
    return (
        f"{claim.get('claim_id')} ({claim.get('claim_type')}, incident "
        f"{claim.get('incident_date')}, claimed ${float(claim.get('amount_claimed') or 0):,.2f}): "
        f"{outcome}{amount}. Reason: {str(decision.get('reason', ''))[:300]}"
    )
