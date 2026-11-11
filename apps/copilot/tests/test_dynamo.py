"""The Copilot's DynamoDB store and memory (decision 30), against a small in-memory table."""

from types import SimpleNamespace
from typing import Any

from undercover_copilot.dynamo import DynamoMemory, DynamoStore
from undercover_copilot.memory import NOTES_KEPT


class Busy(Exception):
    """The table's ConditionalCheckFailedException."""


class FakeTable:
    """Just enough of a boto3 Table for these tests."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}
        self.meta = SimpleNamespace(
            client=SimpleNamespace(exceptions=SimpleNamespace(ConditionalCheckFailedException=Busy))
        )

    def put_item(self, Item: dict[str, Any], **_: Any) -> None:  # noqa: N803 - boto3's names
        self.items[(Item["PK"], Item["SK"])] = dict(Item)

    def get_item(self, Key: dict[str, str]) -> dict[str, Any]:  # noqa: N803
        item = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": item} if item else {}

    def update_item(self, Key: dict[str, str], UpdateExpression: str, **kw: Any) -> None:  # noqa: N803
        item = self.items[(Key["PK"], Key["SK"])]
        values = kw.get("ExpressionAttributeValues", {})
        if UpdateExpression.startswith("REMOVE"):
            item.pop("busy_until", None)
        elif "busy_until" in UpdateExpression:
            if item.get("busy_until", 0) >= values[":now"]:
                raise Busy
            item["busy_until"] = values[":until"]
        else:
            item["title"] = values[":title"]

    def query(self, ExpressionAttributeValues: dict[str, str], **kw: Any) -> dict[str, Any]:  # noqa: N803
        value = next(iter(ExpressionAttributeValues.values()))
        field = "handler_id" if kw.get("IndexName") else "PK"
        found = [i for i in self.items.values() if i.get(field) == value]
        return {"Items": sorted(found, key=lambda i: i.get("created_at", i["SK"]), reverse=True)}

    def batch_writer(self) -> Any:
        table = self

        class Batch:
            def __enter__(self) -> Any:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def delete_item(self, Key: dict[str, str]) -> None:  # noqa: N803
                table.items.pop((Key["PK"], Key["SK"]), None)

        return Batch()


def test_a_conversation_is_only_its_handlers_and_one_turn_at_a_time() -> None:
    store = DynamoStore(FakeTable())
    row = store.create("marcus")
    assert store.find(row.conversation_id, "marcus") == row
    assert store.find(row.conversation_id, "dana") is None
    assert [c.conversation_id for c in store.mine("marcus")] == [row.conversation_id]
    assert store.take(row.conversation_id)
    assert not store.take(row.conversation_id)
    store.free(row.conversation_id)
    assert store.take(row.conversation_id)
    store.retitle(row.conversation_id, "x" * 200)
    assert len(store.mine("marcus")[0].title) == 80


def test_only_the_newest_notes_are_kept_and_forget_all_clears_them() -> None:
    memory = DynamoMemory(FakeTable())
    for n in range(NOTES_KEPT + 2):
        memory.remember("marcus", f"note {n}")
    notes = memory.notes("marcus")
    assert len(notes) == NOTES_KEPT
    assert notes[0] == f"note {NOTES_KEPT + 1}"
    assert memory.notes("dana") == []
    assert memory.forget_all("marcus") == NOTES_KEPT
    assert memory.notes("marcus") == []
