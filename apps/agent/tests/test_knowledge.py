"""Ask UnderCover searches the policy wording by meaning in the Knowledge Base on AWS, citing
sections as the context layer does, and falls back to the word search when it can't."""

from typing import Any

from stubs import FakeClaude

from undercover_agent.ask import Asker, AskRequest
from undercover_agent.knowledge import KnowledgeBase
from undercover_agent.models import Json

REQUEST = AskRequest(first_name="Maya", question="Delays?", policies=[], claims=[])


class FakeBedrock:
    def __init__(self, fails: bool = False) -> None:
        self.fails = fails
        self.asked: list[dict[str, Any]] = []

    def retrieve(self, **call: Any) -> dict[str, Any]:
        self.asked.append(call)
        if self.fails:
            raise RuntimeError("AccessDeniedException")
        return {
            "retrievalResults": [
                {
                    "content": {"text": "# 3. Trip Delay\n\nWe pay after a 6 hour delay."},
                    "metadata": {
                        "number": 3.0,
                        "title": "Trip Delay",
                        "document": "policy_wording",
                    },
                    "score": 0.71,
                }
            ]
        }


class WordSearch:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        self.calls.append(name)
        return {"sections": [{"document": "policy_wording", "number": 3, "title": "x"}]}, False


def test_a_search_cites_the_section_by_its_number_and_title() -> None:
    bedrock = FakeBedrock()
    found = KnowledgeBase("kb-1", "ap-southeast-2", bedrock).search("flight late")
    assert found == {
        "sections": [
            {
                "document": "policy_wording",
                "number": 3,
                "title": "Trip Delay",
                "excerpts": ["We pay after a 6 hour delay."],
            }
        ]
    }
    assert bedrock.asked[0]["knowledgeBaseId"] == "kb-1"


def test_ask_uses_the_knowledge_base_and_falls_back_to_the_word_search() -> None:
    words = WordSearch()
    kb = KnowledgeBase("kb-1", "ap-southeast-2", FakeBedrock())
    asker = Asker(FakeClaude([]), words, "claude-haiku-5-5", kb)
    assert '"Trip Delay"' in asker.run("search_policy_wording", {"query": "late"}, REQUEST)
    assert words.calls == []
    down = KnowledgeBase("kb-1", "ap-southeast-2", FakeBedrock(fails=True))
    fallback = Asker(FakeClaude([]), words, "claude-haiku-5-5", down)
    fallback.run("search_policy_wording", {"query": "late"}, REQUEST)
    assert words.calls == ["search_documents"]
