"""Structured JSON logs with a request ID, and personal data redacted before anything is
written: email addresses, policy numbers and customer IDs never reach a log line."""

import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from fastapi import Request, Response

request_id: ContextVar[str] = ContextVar("request_id", default="-")

REDACTIONS = [
    (re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), "[email]"),
    (re.compile(r"\bPOL-\d+\b"), "[policy]"),
    (re.compile(r"\bCUS-\d+\b"), "[customer]"),
]


def redact(text: str) -> str:
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
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
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
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
