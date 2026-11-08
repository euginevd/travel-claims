"""Structured JSON logs with a request ID, and personal data redacted before anything is
written: email addresses, policy numbers, customer IDs and customers' names never reach a
log line. Uvicorn's own loggers go through the same formatter."""

import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Iterable
from contextvars import ContextVar

from fastapi import Request, Response

request_id: ContextVar[str] = ContextVar("request_id", default="-")

REDACTIONS = [
    (re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), "[email]"),
    (re.compile(r"\bPOL-\d+\b"), "[policy]"),
    (re.compile(r"\bCUS-\d+\b"), "[customer]"),
]
# Customers' names, loaded from the database when the app starts.
_names: list[re.Pattern[str]] = []
UVICORN_LOGGERS = ("uvicorn", "uvicorn.error")
# Name parts this short (initials, "Li") would redact ordinary words too.
SHORTEST_NAME_PART = 3


def redact_names(names: Iterable[str]) -> None:
    """Redact these customers' names, and each of their parts, from every log line."""
    parts = {
        part for name in names for part in [name, *name.split()] if len(part) >= SHORTEST_NAME_PART
    }
    _names[:] = [
        re.compile(rf"\b{re.escape(part)}\b", re.IGNORECASE)
        for part in sorted(parts, key=len, reverse=True)
    ]


def redact(text: str) -> str:
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    for pattern in _names:
        text = pattern.sub("[name]", text)
    return text


class JsonFormatter(logging.Formatter):
    """One JSON object per line, redacted."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": request_id.get(),
            "message": redact(record.getMessage()),
        }
        if record.exc_info:
            entry["error"] = redact(self.formatException(record.exc_info))
        return json.dumps(entry)


def configure_logging() -> None:
    """Send every log line, uvicorn's included, through the redacting JSON formatter."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for name in UVICORN_LOGGERS:
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True


async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Give each request an ID and log its method, path, status and time, never its body."""
    token = request_id.set(request.headers.get("X-Request-ID", uuid.uuid4().hex)[:64])
    started = time.perf_counter()
    try:
        response = await call_next(request)
        logging.getLogger("undercover_api.requests").info(
            "%s %s %s %.0fms",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        response.headers["X-Request-ID"] = request_id.get()
        return response
    finally:
        request_id.reset(token)
