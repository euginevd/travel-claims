"""The dispatcher: works an evaluation run's copies, or a senior handler's dispatch of the queue's
waiting claims, up to N claim agents at once, then tells the api it's done. No model chooses or
tracks anything here.

Restart-safe: a copy still waiting is started on a new thread; one already in progress carries
on from its saved progress on its own thread; one already decided is left alone. So handing a
run over again after a restart never decides a copy twice.
"""

import logging
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Literal, cast

from undercover_agent.api_client import ApiClient
from undercover_agent.runner import Runner

log = logging.getLogger(__name__)

Kind = Literal["run", "dispatch"]
# How often the watcher asks the api for ready claims, and the most it works at once.
WATCH_SECONDS = 3.0
MOST_AT_ONCE = 25


class Dispatcher:
    """Runs one evaluation or dispatch at a time on a background thread."""

    def __init__(self, runner: Runner, api: ApiClient, pause: float = WATCH_SECONDS) -> None:
        self._runner = runner
        self._api = api
        self._pause = pause
        self._watcher: threading.Thread | None = None
        self._lock = threading.Lock()

    def watch(self) -> threading.Thread:
        """Work the live queue's ready claims while the agent switch is on: one watcher at a
        time, so asking again while it runs changes nothing."""
        with self._lock:
            if self._watcher is None or not self._watcher.is_alive():
                # Starts "run-", which keeps an AgentCore Runtime session alive while it works.
                self._watcher = threading.Thread(target=self._watch, name="run-watch", daemon=True)
                self._watcher.start()
            return self._watcher

    def _watch(self) -> None:
        """Ask the api which claims are ready, start each up to the number at once, and stop
        once the switch is off, leaving the claims already started to finish."""
        working: dict[str, Future[None]] = {}
        with ThreadPoolExecutor(max_workers=MOST_AT_ONCE) as pool:
            while True:
                try:
                    ready = self._api.ready_claims()
                except Exception:
                    # Any failure, a dropped connection included: the watcher outlives it, as
                    # nothing else restarts one while the switch is on.
                    log.exception("the watcher couldn't read the queue")
                    time.sleep(self._pause)
                    continue
                if ready.get("on") is not True:
                    # Forgotten before the pool drains, so switching back on starts a new one.
                    with self._lock:
                        self._watcher = None
                    break
                for claim_id, future in list(working.items()):
                    if future.done():
                        del working[claim_id]
                room = int(ready.get("concurrency") or 1) - len(working)
                raw: object = ready.get("claim_ids")
                ids = [str(i) for i in cast(list[object], raw)] if isinstance(raw, list) else []
                for claim_id in [i for i in ids if i not in working][: max(room, 0)]:
                    working[claim_id] = pool.submit(self.work_one, claim_id, waiting_only=True)
                time.sleep(self._pause)
        log.info("the watcher stopped: the agent is switched off")

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
        try:
            with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 25))) as pool:
                list(pool.map(self.work_one, claim_ids))
        finally:
            # Always reported, or the api keeps it as running and refuses every later one.
            try:
                if kind == "run":
                    self._api.finish_run(run_id)
                else:
                    self._api.finish_dispatch(run_id)
            except Exception:
                log.exception("couldn't finish %s %s", kind, run_id)

    def work_one(self, claim_id: str, waiting_only: bool = False) -> None:
        """Start, carry on or leave one claim, whichever it needs. A claim someone else started
        first is left to them (start_claim refuses it), and one bad claim never stops the rest.
        The watcher starts waiting claims only: one already in progress is someone else's."""
        try:
            claim = self._api.claim(claim_id)
            status = claim.get("status")
            if status == "waiting":
                thread_id = uuid.uuid4().hex
                self._api.start(claim_id, thread_id)
            elif status == "in_progress" and claim.get("thread_id") and not waiting_only:
                thread_id = str(claim["thread_id"])
            else:
                return
            self._runner.carry_on(claim_id, thread_id)
        except Exception:
            log.exception("claim %s couldn't be worked", claim_id)
