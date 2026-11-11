"""Ask UnderCover: it searches only the policy wording, reads only the customer's own records,
answers through reply, and a question that tries to instruct it is stopped first."""

from stubs import FakeClaude, tool_use

from undercover_agent.ask import SCREENED, Asker, AskRequest
from undercover_agent.explain import Explainer, ExplainRequest
from undercover_agent.models import Call, Json, Screening

REQUEST = AskRequest(
    first_name="Maya",
    question="Am I covered if my flight is delayed?",
    policies=[{"policy_id": "POL-2001", "plan": "premium"}],
    claims=[{"claim_id": "CLM-1001", "status": "paid"}],
)


class ManualAndWording:
    """A context whose search finds both a wording and a manual section."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Json]] = []

    def call(self, name: str, arguments: Json) -> tuple[Json, bool]:
        self.calls.append((name, arguments))
        if name == "search_documents":
            return {
                "sections": [
                    {"document": "policy_wording", "number": 6, "title": "Trip delay"},
                    {"document": "claims_manual", "number": 9, "title": "Fraud signals"},
                ]
            }, False
        return {"document": "policy_wording", "number": 6, "text": "Delays over 6 hours."}, False


def test_it_searches_the_wording_only_and_answers_through_reply() -> None:
    claude = FakeClaude(
        [
            tool_use("search_policy_wording", {"query": "delay"}, 1),
            tool_use("read_policy_section", {"number": 6}, 2),
            tool_use(
                "reply",
                {
                    "answer": "Your Premium plan covers delays over 6 hours.",
                    "sources": ["Policy wording section 6"],
                    "suggest": "start_claim",
                },
                3,
            ),
        ]
    )
    context = ManualAndWording()
    answer = Asker(claude, context, "claude-haiku-5-5").ask(REQUEST)
    assert answer.answer.startswith("Your Premium plan")
    assert answer.sources == ["Policy wording section 6"]
    assert answer.suggest == "start_claim"
    assert context.calls[1] == ("read_section", {"document": "policy_wording", "number": 6})
    assert claude.systems[0][1] == "claude-haiku-5-5"


def test_the_claims_manual_never_reaches_the_customer() -> None:
    claude = FakeClaude(
        [
            tool_use("search_policy_wording", {"query": "fraud"}, 1),
            tool_use("reply", {"answer": "Done.", "sources": [], "suggest": ""}, 2),
        ]
    )
    asker = Asker(claude, ManualAndWording(), "claude-haiku-5-5")
    text = asker.run("search_policy_wording", {"query": "fraud"}, REQUEST)
    assert "Trip delay" in text
    assert "claims_manual" not in text
    assert "CLM-1001" in asker.run("my_claims", {}, REQUEST)


def test_a_question_that_instructs_the_assistant_is_stopped_before_it_answers() -> None:
    claude = FakeClaude([], flagged=True)
    answer = Asker(claude, ManualAndWording(), "claude-haiku-5-5").ask(REQUEST)
    assert answer.screened is True
    assert answer.answer == SCREENED
    assert claude.turns_taken == 0


# --- Wattle AI for the AI engineers ---


def test_the_engineers_assistant_reads_the_snapshot_and_traces_only_named_claims() -> None:
    request = ExplainRequest(
        first_name="Sam",
        question="Why did CLM-1001 take so long?",
        runs=[{"run_id": 3}],
        rounds=[],
        redteam={"results": []},
        threats={"rows": []},
        traces={"CLM-1001": {"steps": [{"title": "Read the claim"}]}},
    )
    claude = FakeClaude(
        [
            tool_use("claim_trace", {"claim_id": "clm-1001"}, 1),
            tool_use("reply", {"answer": "Two model calls.", "sources": ["Trace CLM-1001"]}, 2),
        ]
    )
    explainer = Explainer(claude, "claude-haiku-5-5")
    answer = explainer.explain(request)
    assert answer.answer == "Two model calls."
    assert answer.sources == ["Trace CLM-1001"]
    assert "error" in explainer.run("claim_trace", {"claim_id": "CLM-9999"}, request)
    assert "run_id" in explainer.run("evaluation_runs", {}, request)
    assert "error" in explainer.run("live_monitoring", {}, request)


class UnreadableCheck(FakeClaude):
    """A check model whose reply couldn't be read."""

    def screen(self, content: list[Json]) -> tuple[Screening | None, Call]:
        self.screened.append(content)
        return None, Call("claude-haiku-5-5", 10, 0, 0.0)


def test_a_question_the_check_couldnt_read_is_refused_not_answered() -> None:
    claude = UnreadableCheck([tool_use("reply", {"answer": "x", "sources": []}, 1)])
    answer = Asker(claude, ManualAndWording(), "claude-haiku-5-5").ask(REQUEST)
    assert (answer.screened, answer.answer) == (True, SCREENED)
    request = ExplainRequest(
        first_name="Sam", question="Why?", runs=[], rounds=[], redteam={}, threats={}, traces={}
    )
    explained = Explainer(claude, "claude-haiku-5-5").explain(request)
    assert explained.screened is True
    assert claude.turns_taken == 0
