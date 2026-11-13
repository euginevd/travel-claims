"""The agent's memory of each customer: their earlier claims and decisions, kept in LangGraph's
store under that customer alone. It holds what was claimed and decided, never the story or the
documents, nothing from a claim the hidden-instruction check referred, and nothing from an
evaluation. The claim history in the records still counts for repeat claims."""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol, cast

from langgraph.store.base import BaseStore

Json = dict[str, Any]
NAMESPACE = "customers"
RECALL_LIMIT = 10
log = logging.getLogger(__name__)


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


class AgentCoreMemory:
    """Memory on AgentCore Memory: one long-term record per decided claim, written as
    is under the customer's own namespace, so no model extracts anything from their words.
    Memory only informs the agent, so a failure to reach it is logged and recalls nothing."""

    def __init__(self, memory_id: str, region: str | None, client: Any = None) -> None:
        self._id = memory_id
        if client is None:
            import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

            client = cast(Any, boto3).client("bedrock-agentcore", region_name=region)
        self._client = client

    def recall(self, customer_id: str, current_claim: str) -> list[str]:
        try:
            found = self._client.list_memory_records(
                memoryId=self._id, namespace=namespace_of(customer_id), maxResults=100
            )
        except Exception as error:  # noqa: BLE001 - memory informs; it never decides
            log.warning("memory unavailable: %s", type(error).__name__)
            return []
        latest: dict[str, tuple[str, str]] = {}
        own = namespace_of(customer_id)
        for record in found.get("memoryRecordSummaries", []):
            # A namespace filter may match by prefix; keep only this customer's own records.
            if own not in record.get("namespaces", []):
                continue
            claim_id = str(record.get("metadata", {}).get("claim_id", {}).get("stringValue", ""))
            text = record.get("content", {}).get("text")
            when = str(record.get("timestamp") or record.get("createdAt") or "")
            if not claim_id or claim_id == current_claim or not isinstance(text, str):
                continue
            if claim_id not in latest or when > latest[claim_id][0]:
                latest[claim_id] = (when, text)
        newest = sorted(latest.values(), reverse=True)
        return [text for _, text in newest][:RECALL_LIMIT]

    def remember(self, customer_id: str, claim_id: str, text: str) -> None:
        record = {
            "requestIdentifier": f"{claim_id}-{uuid.uuid4().hex[:12]}",
            "namespaces": [namespace_of(customer_id)],
            "content": {"text": text},
            "timestamp": datetime.now(UTC),
            "metadata": {"claim_id": {"stringValue": claim_id}},
        }
        try:
            self._client.batch_create_memory_records(memoryId=self._id, records=[record])
        except Exception as error:  # noqa: BLE001 - a lost memory never stops a decision
            log.warning("couldn't remember claim %s: %s", claim_id, type(error).__name__)


def namespace_of(customer_id: str) -> str:
    """The customer's own namespace, ended with "/" so no customer's is the start of another's."""
    return f"{NAMESPACE}/{customer_id}/"


# A section as the documents number them: "Policy wording 10", "Claims manual section 14.2".
SECTION = re.compile(r"(?:policy wording|claims manual)(?: section)? \d+(?:\.\d+)*", re.IGNORECASE)


def uses_memory(claim: Json) -> bool:
    """Whether memory applies to a claim: never to an evaluation's copies."""
    return not claim.get("evaluation")


def memory_of(claim: Json) -> str:
    """What to remember of a decided claim: its decision, payout, the section numbers it rests
    on and how many checks passed and failed. Never free text the model wrote (the reason, a
    check's label), which can carry the customer's words into a later claim."""
    decision: Json = claim.get("decision") or {}
    outcome = str(decision.get("decision", "undecided"))
    payout = float(decision.get("payout") or 0)
    amount = f" ${payout:,.2f}" if outcome == "approve" else ""
    results = [str(c.get("result", "")) for c in cast(list[Json], decision.get("checklist") or [])]
    counts = [f"{results.count(r)} {r}" for r in ("pass", "warn", "fail") if r in results]
    sections = SECTION.findall(str(decision.get("section", "")))
    return (
        f"{claim.get('claim_id')} ({claim.get('claim_type')}): {outcome}{amount}. "
        f"Sections: {', '.join(sections[:6]) or 'none recorded'}. "
        f"Checks: {', '.join(counts) or 'none recorded'}."
    )
