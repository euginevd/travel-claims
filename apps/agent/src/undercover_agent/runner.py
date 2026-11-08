# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportMissingTypeStubs=false
# LangGraph is only partly typed; strict checks on its members are switched off in this file.
"""Working claims on background threads: one claim at a time each, its progress saved on the
claim's thread so a held claim resumes where it paused."""

import logging
import threading
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.graph import ClaimState

log = logging.getLogger(__name__)


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
    """Starts and resumes claim graphs on threads of their own."""

    def __init__(
        self, graph: CompiledStateGraph[ClaimState, None, ClaimState, ClaimState], api: ApiClient
    ) -> None:
        self._graph = graph
        self._api = api
        self._active: set[str] = set()
        self._lock = threading.Lock()

    def work(self, claim_id: str, thread_id: str) -> threading.Thread:
        return self._start(claim_id, thread_id, START_STATE)

    def resume(self, claim_id: str, thread_id: str, outcome: str) -> threading.Thread:
        return self._start(claim_id, thread_id, Command(resume=outcome))

    def _start(self, claim_id: str, thread_id: str, payload: Any) -> threading.Thread:
        with self._lock:
            if claim_id in self._active:
                raise Busy(f"Claim {claim_id} is already being worked")
            self._active.add(claim_id)
        thread = threading.Thread(
            target=self._run, args=(claim_id, thread_id, payload), name=claim_id, daemon=True
        )
        thread.start()
        return thread

    def carry_on(self, claim_id: str, thread_id: str) -> None:
        """Work a claim on this thread: carry on from its saved progress if it has any, else
        start it afresh. A claim decided before a restart is never decided twice."""
        config: RunnableConfig = {"configurable": {"claim_id": claim_id, "thread_id": thread_id}}
        saved = self._graph.get_state(config)
        payload: Any = None if saved.next else START_STATE
        if saved.values and not saved.next:
            return
        self._run(claim_id, thread_id, payload)

    def _run(self, claim_id: str, thread_id: str, payload: Any) -> None:
        config: RunnableConfig = {
            "configurable": {"claim_id": claim_id, "thread_id": thread_id},
            "recursion_limit": 200,
        }
        try:
            self._graph.invoke(payload, config)
        except Exception as error:  # noqa: BLE001 - one bad claim never stops the agent
            log.exception("claim %s failed", claim_id)
            try:
                self._api.record_step(
                    claim_id, thread_id, "error", f"The agent stopped: {type(error).__name__}"
                )
            except ApiError:
                log.warning("couldn't record the failure on claim %s", claim_id)
        finally:
            with self._lock:
                self._active.discard(claim_id)
