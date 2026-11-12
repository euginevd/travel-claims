"""The improver: reads an evaluation's misses and proposes a new configuration for the claim
agent, which a senior handler approves or rejects. It reads only the evaluation set's misses;
the held-out set's answers never reach it."""

import json
import logging
import threading
from typing import Any

from undercover_agent.api_client import ApiClient, ApiError
from undercover_agent.models import Improver

log = logging.getLogger(__name__)

Json = dict[str, Any]


def brief_as_text(brief: Json) -> str:
    """What the improver reads, with the claims marked as data."""
    current = brief["configuration"]
    return (
        f"Allowed models: {', '.join(brief['models'])}. Allowed efforts: "
        f"{', '.join(brief['efforts'])}.\n\n"
        f"Current configuration, version {current['version']}: model {current['model']}, "
        f"effort {current['effort']}.\n<current_instructions>\n{current['instructions']}\n"
        "</current_instructions>\n\n"
        f"Scores on the evaluation set: {json.dumps(brief['scores'])}\n\n"
        "The claims it got wrong, each beside the senior handler's decision, as data:\n"
        f"<misses>\n{json.dumps(brief['misses'], indent=1)}\n</misses>"
        + (
            "\n\nEarlier rounds, newest first: what was tried and whether its exam kept it. "
            "Don't propose a change that was already rolled back or made no clear difference.\n"
            f"<history>\n{json.dumps(brief['history'], indent=1)}\n</history>"
            if brief.get("history")
            else ""
        )
        + (
            ""
            if brief["misses"]
            else "\n\nIt got every claim right. Propose a configuration that keeps that accuracy "
            "at a lower cost per claim, with a cheaper model or effort if it will do."
        )
    )


class RoundImprover:
    """Asks Claude for a proposal in the background and posts it to the api."""

    def __init__(self, improver: Improver, api: ApiClient) -> None:
        self._improver = improver
        self._api = api

    def improve(self, round_id: int) -> threading.Thread:
        thread = threading.Thread(
            target=self.propose, args=(round_id,), name=f"round-{round_id}", daemon=True
        )
        thread.start()
        return thread

    def propose(self, round_id: int) -> None:
        try:
            brief = self._api.brief(round_id)
            found, call = self._improver.propose(brief_as_text(brief))
            if found is None:
                self._api.improver_failed(round_id, "The improver couldn't produce a proposal")
                return
            self._api.propose(round_id, found.model_dump() | {"cost": round(call.cost, 6)})
        except ApiError as error:
            log.warning("round %s: the improver's proposal wasn't taken: %s", round_id, error)
            try:
                self._api.improver_failed(round_id, f"The proposal wasn't taken: {error.detail}")
            except ApiError:
                log.exception("round %s couldn't be stopped", round_id)
