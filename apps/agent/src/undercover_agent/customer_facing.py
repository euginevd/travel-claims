"""Keep a draft customer-facing: no notes about the customer or the draft, and no question
about something the form already asks."""

import re

from undercover_agent.models import Draft

# Words that mark text written about the customer or the draft rather than for them.
NOTE = re.compile(
    r"\b(the customer|customer has|claimant|the user|draft|pending|not yet (described|provided|"
    r"selected|given)|no (information|details) (was |were )?provided|unknown|n/a)\b",
    re.IGNORECASE,
)
# Questions about fields the form already shows.
ON_SCREEN = re.compile(
    r"\b(type of (claim|problem)|kind of (claim|problem)|what type|when did|what date|which date|"
    r"where did|where were|what (city|country|place)|how much|amount|cost|item)\b",
    re.IGNORECASE,
)


def is_note(text: str) -> bool:
    """Whether text reads as an internal note rather than the customer's own words."""
    return bool(NOTE.search(text))


def customer_facing(draft: Draft) -> Draft:
    """The draft with internal notes blanked and on-screen questions dropped."""
    questions = [q for q in draft.missing_questions if not is_note(q) and not ON_SCREEN.search(q)]
    return draft.model_copy(
        update={
            "summary": "" if is_note(draft.summary) else draft.summary,
            "story": "" if is_note(draft.story) else draft.story,
            "incident_location": ""
            if is_note(draft.incident_location)
            else draft.incident_location,
            "missing_questions": questions[:2],
        }
    )
