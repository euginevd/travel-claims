"""The api's client for the agent's service, against a small stand-in server."""

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from undercover_api.agent_service import (
    AgentRefusedError,
    AgentUnavailableError,
    HttpAgentService,
    Outcome,
)

KEY = "k" * 64
# What the stand-in answers next: a status and a JSON body.
answers: list[tuple[int, object]] = []
received: list[tuple[str, dict[str, str], str | None]] = []


class StandIn(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - the name http.server calls
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        received.append((self.path, body, self.headers.get("X-API-Key")))
        status, answer = answers.pop(0)
        payload = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        """Quiet."""


@pytest.fixture
def service() -> Iterator[HttpAgentService]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), StandIn)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    answers.clear()
    received.clear()
    yield HttpAgentService(f"http://127.0.0.1:{server.server_address[1]}/", KEY)
    server.shutdown()
    server.server_close()


def test_work_sends_the_claim_and_thread_with_the_key(service: HttpAgentService) -> None:
    answers.append((202, {"accepted": True}))
    service.work("CLM-1001", "thread-1")
    assert received == [("/work", {"claim_id": "CLM-1001", "thread_id": "thread-1"}, KEY)]


def test_resume_sends_the_outcome(service: HttpAgentService) -> None:
    answers.append((202, {"accepted": True}))
    service.resume("CLM-1003", "thread-1", Outcome.SENT_BACK)
    path, body, _ = received[0]
    assert (path, body["outcome"]) == ("/resume", "sent_back")


def test_a_refusal_carries_the_agents_reason(service: HttpAgentService) -> None:
    answers.append((409, {"refused": "already working CLM-1001"}))
    with pytest.raises(AgentRefusedError, match="already working CLM-1001"):
        service.work("CLM-1001", "thread-1")


def test_an_answer_that_isnt_acceptance_is_a_refusal(service: HttpAgentService) -> None:
    answers.append((200, {"healthy": True}))
    with pytest.raises(AgentRefusedError):
        service.work("CLM-1001", "thread-1")


def test_an_error_with_no_reason_is_still_a_refusal(service: HttpAgentService) -> None:
    answers.append((500, "oops"))
    with pytest.raises(AgentRefusedError, match="refused the work"):
        service.work("CLM-1001", "thread-1")


def test_a_service_that_isnt_there_is_unavailable() -> None:
    with pytest.raises(AgentUnavailableError, match="isn't answering"):
        HttpAgentService("http://127.0.0.1:9", KEY).work("CLM-1001", "thread-1")
