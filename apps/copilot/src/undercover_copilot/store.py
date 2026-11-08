"""Which conversations belong to which handler. Each conversation's messages are kept by the
graph's checkpointer on a thread named after the conversation."""

import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

Json = dict[str, Any]
TITLE_LENGTH = 80


@dataclass(frozen=True)
class Conversation:
    conversation_id: str
    handler_id: str
    title: str
    created_at: str


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Store(Protocol):
    def create(self, handler_id: str) -> Conversation: ...

    def mine(self, handler_id: str) -> list[Conversation]: ...

    def find(self, conversation_id: str, handler_id: str) -> Conversation | None: ...

    def retitle(self, conversation_id: str, title: str) -> None: ...


class MemoryStore:
    """Conversations in memory, for tests."""

    def __init__(self) -> None:
        self._rows: dict[str, Conversation] = {}
        self._lock = threading.Lock()

    def create(self, handler_id: str) -> Conversation:
        row = Conversation(f"conv-{uuid.uuid4().hex[:16]}", handler_id, "New conversation", now())
        with self._lock:
            self._rows[row.conversation_id] = row
        return row

    def mine(self, handler_id: str) -> list[Conversation]:
        rows = [r for r in self._rows.values() if r.handler_id == handler_id]
        return sorted(rows, key=lambda r: r.created_at, reverse=True)

    def find(self, conversation_id: str, handler_id: str) -> Conversation | None:
        row = self._rows.get(conversation_id)
        return row if row is not None and row.handler_id == handler_id else None

    def retitle(self, conversation_id: str, title: str) -> None:
        with self._lock:
            row = self._rows[conversation_id]
            self._rows[conversation_id] = Conversation(
                row.conversation_id, row.handler_id, title[:TITLE_LENGTH], row.created_at
            )


class PostgresStore:
    """Conversations in PostgreSQL, in the copilot schema."""

    def __init__(self, pool: Any) -> None:
        self._pool = pool
        with pool.connection() as db:
            db.execute("CREATE SCHEMA IF NOT EXISTS copilot")
            db.execute(
                "CREATE TABLE IF NOT EXISTS copilot.conversations ("
                "conversation_id text PRIMARY KEY, handler_id text NOT NULL, "
                "title text NOT NULL, created_at text NOT NULL)"
            )

    def create(self, handler_id: str) -> Conversation:
        row = Conversation(f"conv-{uuid.uuid4().hex[:16]}", handler_id, "New conversation", now())
        with self._pool.connection() as db:
            db.execute(
                "INSERT INTO copilot.conversations VALUES (%s, %s, %s, %s)",
                (row.conversation_id, row.handler_id, row.title, row.created_at),
            )
        return row

    def mine(self, handler_id: str) -> list[Conversation]:
        with self._pool.connection() as db:
            rows = db.execute(
                "SELECT conversation_id, handler_id, title, created_at "
                "FROM copilot.conversations WHERE handler_id = %s ORDER BY created_at DESC",
                (handler_id,),
            ).fetchall()
        return [Conversation(**row) for row in rows]

    def find(self, conversation_id: str, handler_id: str) -> Conversation | None:
        with self._pool.connection() as db:
            row = db.execute(
                "SELECT conversation_id, handler_id, title, created_at "
                "FROM copilot.conversations WHERE conversation_id = %s AND handler_id = %s",
                (conversation_id, handler_id),
            ).fetchone()
        return Conversation(**row) if row else None

    def retitle(self, conversation_id: str, title: str) -> None:
        with self._pool.connection() as db:
            db.execute(
                "UPDATE copilot.conversations SET title = %s WHERE conversation_id = %s",
                (title[:TITLE_LENGTH], conversation_id),
            )
