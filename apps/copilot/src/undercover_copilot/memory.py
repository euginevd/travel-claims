"""What the Copilot remembers for each handler: their own stated preferences, never claim or
customer data, kept under the handler's verified id alone. The local stand-in for AgentCore
Memory."""

import threading
from datetime import UTC, datetime
from typing import Any, Protocol

NOTE_LENGTH = 300
NOTES_KEPT = 20


class Memory(Protocol):
    """A handler's saved notes, newest first."""

    def notes(self, handler_id: str) -> list[str]: ...

    def remember(self, handler_id: str, note: str) -> None: ...

    def forget_all(self, handler_id: str) -> int: ...


class LocalMemory:
    """Notes in memory, for tests."""

    def __init__(self) -> None:
        self._notes: dict[str, list[str]] = {}
        self._lock = threading.Lock()

    def notes(self, handler_id: str) -> list[str]:
        return list(self._notes.get(handler_id, []))

    def remember(self, handler_id: str, note: str) -> None:
        with self._lock:
            kept = [note, *self._notes.get(handler_id, [])]
            self._notes[handler_id] = kept[:NOTES_KEPT]

    def forget_all(self, handler_id: str) -> int:
        with self._lock:
            return len(self._notes.pop(handler_id, []))


class PostgresMemory:
    """Notes in PostgreSQL, in the copilot schema."""

    def __init__(self, pool: Any) -> None:
        self._pool = pool
        with pool.connection() as db:
            db.execute("CREATE SCHEMA IF NOT EXISTS copilot")
            db.execute(
                "CREATE TABLE IF NOT EXISTS copilot.memories ("
                "memory_id bigserial PRIMARY KEY, handler_id text NOT NULL, "
                "note text NOT NULL, created_at text NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS memories_handler ON copilot.memories (handler_id)"
            )

    def notes(self, handler_id: str) -> list[str]:
        with self._pool.connection() as db:
            rows = db.execute(
                "SELECT note FROM copilot.memories WHERE handler_id = %s "
                "ORDER BY memory_id DESC LIMIT %s",
                (handler_id, NOTES_KEPT),
            ).fetchall()
        return [str(row["note"]) for row in rows]

    def remember(self, handler_id: str, note: str) -> None:
        created = datetime.now(UTC).isoformat(timespec="seconds")
        with self._pool.connection() as db:
            db.execute(
                "INSERT INTO copilot.memories (handler_id, note, created_at) VALUES (%s, %s, %s)",
                (handler_id, note, created),
            )
            # Only the newest notes are kept.
            db.execute(
                "DELETE FROM copilot.memories WHERE handler_id = %s AND memory_id NOT IN ("
                "SELECT memory_id FROM copilot.memories WHERE handler_id = %s "
                "ORDER BY memory_id DESC LIMIT %s)",
                (handler_id, handler_id, NOTES_KEPT),
            )

    def forget_all(self, handler_id: str) -> int:
        with self._pool.connection() as db:
            done = db.execute("DELETE FROM copilot.memories WHERE handler_id = %s", (handler_id,))
            return int(done.rowcount)
