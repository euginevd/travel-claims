"""Customer memory on AgentCore Memory: the same rules as the Postgres store (R20)."""

from typing import Any

from undercover_agent.memory import AgentCoreMemory, namespace_of


class FakeMemory:
    """AgentCore Memory's records API, in memory."""

    def __init__(self, fails: bool = False) -> None:
        self.records: list[dict[str, Any]] = []
        self.fails = fails
        self.listed: list[str] = []

    def batch_create_memory_records(self, memoryId: str, records: list[dict[str, Any]]) -> None:  # noqa: N803
        if self.fails:
            raise RuntimeError("AccessDeniedException")
        self.records.extend(records)

    def list_memory_records(self, memoryId: str, namespace: str, maxResults: int) -> dict[str, Any]:  # noqa: N803
        if self.fails:
            raise RuntimeError("AccessDeniedException")
        self.listed.append(namespace)
        # As a prefix filter would: the worst case for the agent's own check.
        return {
            "memoryRecordSummaries": [
                {**r, "timestamp": r["timestamp"].isoformat()}
                for r in self.records
                if any(n.startswith(namespace.rstrip("/")) for n in r["namespaces"])
            ]
        }


def test_each_customer_has_a_namespace_of_their_own() -> None:
    fake = FakeMemory()
    memory = AgentCoreMemory("mem-1", "ap-southeast-2", fake)
    memory.remember("CUS-1", "CLM-1", "CLM-1: approve $50.")
    memory.remember("CUS-2", "CLM-2", "CLM-2: decline.")
    assert memory.recall("CUS-1", "CLM-9") == ["CLM-1: approve $50."]
    assert memory.recall("CUS-2", "CLM-9") == ["CLM-2: decline."]
    assert fake.listed == [namespace_of("CUS-1"), namespace_of("CUS-2")]
    assert fake.records[0]["metadata"] == {"claim_id": {"stringValue": "CLM-1"}}


def test_the_latest_record_per_claim_counts_and_the_current_claim_is_left_out() -> None:
    memory = AgentCoreMemory("mem-1", "ap-southeast-2", FakeMemory())
    memory.remember("CUS-1", "CLM-1", "CLM-1: refer.")
    memory.remember("CUS-1", "CLM-1", "CLM-1: approve $50 after the documents came.")
    memory.remember("CUS-1", "CLM-2", "CLM-2: decline.")
    found = memory.recall("CUS-1", "CLM-2")
    assert found == ["CLM-1: approve $50 after the documents came."]


def test_memory_that_cant_be_reached_recalls_nothing_and_never_stops_a_decision() -> None:
    memory = AgentCoreMemory("mem-1", "ap-southeast-2", FakeMemory(fails=True))
    memory.remember("CUS-1", "CLM-1", "CLM-1: approve $50.")  # no exception
    assert memory.recall("CUS-1", "CLM-2") == []


def test_one_customers_memory_never_includes_a_customer_whose_id_starts_the_same() -> None:
    memory = AgentCoreMemory("mem-1", "ap-southeast-2", FakeMemory())
    memory.remember("CUS-1", "CLM-1", "CLM-1: approve $50.")
    memory.remember("CUS-10", "CLM-10", "CLM-10: decline.")
    assert memory.recall("CUS-1", "CLM-9") == ["CLM-1: approve $50."]
    assert memory.recall("CUS-10", "CLM-9") == ["CLM-10: decline."]
