"""The Copilot's conversations and handler notes in one DynamoDB table on AWS (decision 30).

Items: a conversation is CONV#<id> / CONV, found by handler through the by_handler index; a note
is NOTES#<handler> / <time>#<id>. The local Postgres store and memory stay for local runs.
"""

import time
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from undercover_copilot.memory import NOTES_KEPT
from undercover_copilot.store import BUSY_SECONDS, TITLE_LENGTH, Conversation, now


def table(name: str, region: str | None) -> Any:
    """A boto3 DynamoDB table, with the function's role."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    return cast(Any, boto3).resource("dynamodb", region_name=region).Table(name)


def as_conversation(item: dict[str, Any]) -> Conversation:
    return Conversation(
        str(item["conversation_id"]),
        str(item["handler_id"]),
        str(item["title"]),
        str(item["created_at"]),
    )


class DynamoStore:
    """Conversations, each held for one turn at a time across every Copilot instance."""

    def __init__(self, dynamo_table: Any) -> None:
        self._table = dynamo_table

    def create(self, handler_id: str) -> Conversation:
        row = Conversation(f"conv-{uuid.uuid4().hex[:16]}", handler_id, "New conversation", now())
        self._table.put_item(
            Item={"PK": f"CONV#{row.conversation_id}", "SK": "CONV", **row.__dict__},
            ConditionExpression="attribute_not_exists(PK)",
        )
        return row

    def mine(self, handler_id: str) -> list[Conversation]:
        found = self._table.query(
            IndexName="by_handler",
            KeyConditionExpression="handler_id = :handler",
            ExpressionAttributeValues={":handler": handler_id},
            ScanIndexForward=False,
        )
        return [as_conversation(item) for item in found.get("Items", [])]

    def find(self, conversation_id: str, handler_id: str) -> Conversation | None:
        item = self._table.get_item(Key={"PK": f"CONV#{conversation_id}", "SK": "CONV"}).get("Item")
        return as_conversation(item) if item and item["handler_id"] == handler_id else None

    def retitle(self, conversation_id: str, title: str) -> None:
        self._table.update_item(
            Key={"PK": f"CONV#{conversation_id}", "SK": "CONV"},
            UpdateExpression="SET title = :title",
            ExpressionAttributeValues={":title": title[:TITLE_LENGTH]},
        )

    def take(self, conversation_id: str) -> bool:
        stamp = int(time.time())
        try:
            self._table.update_item(
                Key={"PK": f"CONV#{conversation_id}", "SK": "CONV"},
                UpdateExpression="SET busy_until = :until",
                ConditionExpression=(
                    "attribute_exists(PK) AND "
                    "(attribute_not_exists(busy_until) OR busy_until < :now)"
                ),
                ExpressionAttributeValues={":until": stamp + BUSY_SECONDS, ":now": stamp},
            )
        except self._table.meta.client.exceptions.ConditionalCheckFailedException:
            return False
        return True

    def free(self, conversation_id: str) -> None:
        self._table.update_item(
            Key={"PK": f"CONV#{conversation_id}", "SK": "CONV"},
            UpdateExpression="REMOVE busy_until",
        )


class DynamoMemory:
    """A handler's own notes, newest first; only the newest are kept."""

    def __init__(self, dynamo_table: Any) -> None:
        self._table = dynamo_table

    def _all(self, handler_id: str) -> list[dict[str, Any]]:
        found = self._table.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"NOTES#{handler_id}"},
            ScanIndexForward=False,
        )
        return list(found.get("Items", []))

    def notes(self, handler_id: str) -> list[str]:
        return [str(item["note"]) for item in self._all(handler_id)[:NOTES_KEPT]]

    def remember(self, handler_id: str, note: str) -> None:
        created = datetime.now(UTC).isoformat(timespec="microseconds")
        self._table.put_item(
            Item={
                "PK": f"NOTES#{handler_id}",
                "SK": f"{created}#{uuid.uuid4().hex[:8]}",
                "note": note,
            }
        )
        with self._table.batch_writer() as batch:
            for item in self._all(handler_id)[NOTES_KEPT:]:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})

    def forget_all(self, handler_id: str) -> int:
        items = self._all(handler_id)
        with self._table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
        return len(items)
