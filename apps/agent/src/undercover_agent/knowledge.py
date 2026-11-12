"""The one place the agent reaches the Bedrock Knowledge Base: a meaning-based search
of the policy wording, one document per section, answered in the context layer's own shape so
each answer still cites its section."""

import logging
from typing import Any, Protocol, cast

log = logging.getLogger(__name__)
Json = dict[str, Any]
RESULTS = 4


class WordingSearch(Protocol):
    def search(self, query: str) -> Json | None: ...


class KnowledgeBase:
    """Retrieve from the Knowledge Base; None when it can't be reached, so the caller falls
    back to the context layer's word search."""

    def __init__(self, knowledge_base_id: str, region: str | None, client: Any = None) -> None:
        self._id = knowledge_base_id
        if client is None:
            import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

            client = cast(Any, boto3).client("bedrock-agent-runtime", region_name=region)
        self._client = client

    def search(self, query: str) -> Json | None:
        try:
            reply = self._client.retrieve(
                knowledgeBaseId=self._id,
                retrievalQuery={"text": query[:1000]},
                retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": RESULTS}},
            )
        except Exception as error:  # noqa: BLE001 - the word search still answers
            log.warning("knowledge base unavailable: %s", type(error).__name__)
            return None
        sections = [section_of(r) for r in reply.get("retrievalResults", [])]
        # A result without its section's number can't be cited, so it isn't used.
        return {"sections": [s for s in sections if s["number"] > 0]}


def section_of(result: Json) -> Json:
    """One retrieved section, as the context layer names it."""
    about = cast(Json, result.get("metadata") or {})
    text = str(cast(Json, result.get("content") or {}).get("text", ""))
    body = text.split("\n\n", 1)[1] if text.startswith("# ") and "\n\n" in text else text
    return {
        "document": "policy_wording",
        "number": int(float(about.get("number", 0))),
        "title": str(about.get("title", "")),
        "excerpts": [body[:1200]],
    }
