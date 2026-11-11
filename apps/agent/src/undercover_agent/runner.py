# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""Working claims on background threads: one claim at a time each, its progress saved on the
claim's thread so a held claim resumes where it paused, and a stalled one carries on where it
stopped. While a claim works, a heartbeat tells the api the agent is still on it."""

import logging
import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

import httpx2
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.graph import ClaimState

log = logging.getLogger(__name__)

# How often the agent tells the api it's still working a claim; well inside the api's 90 seconds.
HEARTBEAT_SECONDS = 20.0

START_STATE: ClaimState = {
    "messages": [],
    "model_calls": 0,
    "outcome": "",
    "payout": 0.0,
    "configuration": {},
}


class Busy(Exception):
    """The claim is already being worked here."""


class Runner:
    """Starts, resumes and carries on claim graphs on threads of their own."""

    def __init__(
        self,
        graph: CompiledStateGraph[ClaimState, None, ClaimState, ClaimState],
        api: ApiClient,
        heartbeat_seconds: float = HEARTBEAT_SECONDS,
    ) -> None:
        self._graph = graph
        self._api = api
        self._heartbeat_seconds = heartbeat_seconds
        self._active: set[str] = set()
        self._lock = threading.Lock()

    def work(self, claim_id: str, thread_id: str) -> threading.Thread:
        return self._start(claim_id, lambda: self._run(claim_id, thread_id, START_STATE))

    def resume(self, claim_id: str, thread_id: str, outcome: str) -> threading.Thread:
        resume = Command(resume=outcome)
        return self._start(claim_id, lambda: self._run(claim_id, thread_id, resume))

    def carry_on_later(self, claim_id: str, thread_id: str) -> threading.Thread:
        """Carry a stalled claim on, on a thread of its own."""
        return self._start(claim_id, lambda: self.carry_on(claim_id, thread_id))

    def _start(self, claim_id: str, work: Callable[[], None]) -> threading.Thread:
        with self._lock:
            if claim_id in self._active:
                raise Busy(f"Claim {claim_id} is already being worked")
            self._active.add(claim_id)

        def run() -> None:
            try:
                work()
            finally:
                with self._lock:
                    self._active.discard(claim_id)

        thread = threading.Thread(target=run, name=claim_id, daemon=True)
        thread.start()
        return thread

    def carry_on(self, claim_id: str, thread_id: str) -> None:
        """Work a claim on this thread: carry on from its saved progress if it has any, else
        start it afresh. A claim decided before a restart is never decided twice."""
        config: RunnableConfig = {"configurable": {"claim_id": claim_id, "thread_id": thread_id}}
        saved = self._graph.get_state(config)
        if saved.values and not saved.next:
            return
        payload: Any = None if saved.next else START_STATE
        if saved.interrupts:
            # Paused for a sign-off, yet in progress again: a send-back whose resume never
            # arrived. Signed off or still held, it isn't the agent's to carry on.
            if self._api.claim(claim_id).get("status") != "in_progress":
                return
            payload = Command(resume="sent_back")
        self._run(claim_id, thread_id, payload)

    def _run(self, claim_id: str, thread_id: str, payload: Any) -> None:
        config: RunnableConfig = {
            "configurable": {"claim_id": claim_id, "thread_id": thread_id},
            "recursion_limit": 200,
        }
        try:
            with self._beating(claim_id, thread_id):
                self._graph.invoke(payload, config)
        except Exception as error:  # noqa: BLE001 - one bad claim never stops the agent
            log.exception("claim %s failed", claim_id)
            try:
                self._api.record_step(
                    claim_id, thread_id, "error", f"The agent stopped: {type(error).__name__}"
                )
            except ApiError:
                log.warning("couldn't record the failure on claim %s", claim_id)

    @contextmanager
    def _beating(self, claim_id: str, thread_id: str) -> Generator[None]:
        """Tell the api the claim is being worked, every few seconds, until the work ends."""
        done = threading.Event()

        def beat() -> None:
            while not done.wait(self._heartbeat_seconds):
                try:
                    self._api.heartbeat(claim_id, thread_id)
                except (ApiError, httpx2.HTTPError) as error:
                    # Decided or held already, or the api is down: the claim's own work says.
                    log.info("no heartbeat for claim %s: %s", claim_id, error)

        beating = threading.Thread(target=beat, name=f"heartbeat-{claim_id}", daemon=True)
        beating.start()
        try:
            yield
        finally:
            done.set()
            beating.join()


class Watchdog:
    """Carries the agent's stalled claims on by itself, every so often; the long-lived
    agent in Docker Compose only. The api lets each claim be taken this way a few times, then
    leaves it to a handler."""

    def __init__(self, runner: Runner, api: ApiClient, every_seconds: float = 30.0) -> None:
        self._runner = runner
        self._api = api
        self._every = every_seconds
        self._stop = threading.Event()

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self._watch, name="watchdog", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self._stop.set()

    def _watch(self) -> None:
        while not self._stop.wait(self._every):
            self.sweep()

    def sweep(self) -> list[str]:
        """Carry on every stalled claim the api lets the agent take. Says which it took."""
        try:
            stalled = self._api.stalled_claims()
        except (ApiError, httpx2.HTTPError) as error:
            log.warning("couldn't look for stalled claims: %s", error)
            return []
        taken: list[str] = []
        for claim_id in stalled:
            try:
                claim = self._api.recover(claim_id)
                self._runner.carry_on_later(claim_id, str(claim["thread_id"]))
            except (ApiError, httpx2.HTTPError, Busy) as error:
                log.info("didn't carry claim %s on: %s", claim_id, error)
                continue
            log.warning("carried stalled claim %s on", claim_id)
            taken.append(claim_id)
        return taken
