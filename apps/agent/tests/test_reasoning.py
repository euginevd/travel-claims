"""Ask UnderCover's answers against the wording's rules, by Automated Reasoning (decision 48)."""

from typing import Any

from test_ask import REQUEST, Grounding, ManualAndWording, answering

from undercover_agent.ask import UNGROUNDED, Asker
from undercover_agent.reasoning import BedrockReasoningCheck, Outcome, outcome_of


def reply(*kinds: str) -> dict[str, Any]:
    findings: list[dict[str, Any]] = [{kind: {}} for kind in kinds]
    return {"assessments": [{"automatedReasoningPolicy": {"findings": findings}}]}


def test_findings_say_valid_invalid_or_unknown() -> None:
    assert outcome_of(reply("valid", "valid")) == "valid"
    assert outcome_of(reply("valid", "invalid")) == "invalid"
    assert outcome_of(reply("impossible")) == "invalid"
    assert outcome_of(reply("valid", "satisfiable")) == "unknown"
    assert outcome_of(reply("translationAmbiguous")) == "unknown"
    assert outcome_of({"assessments": []}) == "unknown"


def test_the_check_sends_the_question_and_answer_and_fails_open() -> None:
    class Client:
        sent: list[dict[str, Any]] = []
        fail = False

        def apply_guardrail(self, **request: Any) -> dict[str, Any]:
            if self.fail:
                raise RuntimeError("ThrottlingException")
            self.sent.append(request)
            return reply("valid")

    client = Client()
    check = BedrockReasoningCheck("gr-1", "2", "ap-southeast-2", client)
    assert check.check("Am I covered?", "Yes, after 6 hours.") == "valid"
    qualifiers = [part["text"]["qualifiers"] for part in client.sent[0]["content"]]
    assert qualifiers == [["query"], ["guard_content"]]
    assert client.sent[0]["guardrailVersion"] == "2"
    client.fail = True
    assert check.check("Am I covered?", "Yes.") == "unknown"


class Reasoning:
    def __init__(self, outcome: Outcome) -> None:
        self.outcome: Outcome = outcome

    def check(self, question: str, answer: str) -> Outcome:  # noqa: ARG002 - a fake
        return self.outcome


def ask(outcome: Outcome) -> Any:
    asker = Asker(
        answering(),
        ManualAndWording(),
        "m",
        grounding=Grounding(blocked=False),
        reasoning=Reasoning(outcome),
    )
    return asker.ask(REQUEST)


def test_an_answer_the_rules_contradict_goes_to_a_person() -> None:
    answer = ask("invalid")
    assert answer.answer == UNGROUNDED
    assert (answer.action, answer.verified) == ("talk_to_person", False)


def test_an_answer_the_rules_prove_is_marked_and_others_are_shown_as_before() -> None:
    proved = ask("valid")
    assert (proved.answer, proved.verified) == ("Delays over 6 hours are covered.", True)
    unsure = ask("unknown")
    assert (unsure.answer, unsure.verified) == ("Delays over 6 hours are covered.", False)
