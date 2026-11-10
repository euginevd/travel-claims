"""The dispatcher: works an evaluation run's copies, or a senior handler's dispatch of the queue's
waiting claims, up to N claim agents at once, then tells the api it's done. No model chooses or
tracks anything here.

Restart-safe: a copy still waiting is started on a new thread; one already in progress carries
on from its saved progress on its own thread; one already decided is left alone. So handing a
run over again after a restart never decides a copy twice.
"""

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.runner import Runner

log = logging.getLogger(__name__)

Kind = Literal["run", "dispatch"]


class Dispatcher:
    """Runs one evaluation or dispatch at a time on a background thread."""

    def __init__(self, runner: Runner, api: ApiClient) -> None:
        self._runner = runner
        self._api = api

    def dispatch(
        self, run_id: int, claim_ids: list[str], concurrency: int, kind: Kind = "run"
    ) -> threading.Thread:
        # Both start "run-", which keeps an AgentCore Runtime session alive while they work.
        thread = threading.Thread(
            target=self._run,
            args=(run_id, claim_ids, concurrency, kind),
            name=f"run-{run_id}" if kind == "run" else f"run-dispatch-{run_id}",
            daemon=True,
        )
        thread.start()
        return thread

    def _run(self, run_id: int, claim_ids: list[str], concurrency: int, kind: Kind) -> None:
        with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 25))) as pool:
            list(pool.map(self.work_one, claim_ids))
        try:
            if kind == "run":
                self._api.finish_run(run_id)
            else:
                self._api.finish_dispatch(run_id)
        except ApiError:
            log.exception("couldn't finish %s %s", kind, run_id)

    def work_one(self, claim_id: str) -> None:
        """Start, carry on or leave one claim, whichever it needs. A claim someone else started
        first is left to them (start_claim refuses it), and one bad claim never stops the rest."""
        try:
            claim = self._api.claim(claim_id)
            status = claim.get("status")
            if status == "waiting":
                thread_id = uuid.uuid4().hex
                self._api.start(claim_id, thread_id)
            elif status == "in_progress" and claim.get("thread_id"):
                thread_id = str(claim["thread_id"])
            else:
                return
            self._runner.carry_on(claim_id, thread_id)
        except ApiError:
            log.exception("copy %s couldn't be worked", claim_id)
