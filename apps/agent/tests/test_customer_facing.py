from undercover_agent.customer_facing import customer_facing
from undercover_agent.models import Draft


def draft(**change: object) -> Draft:
    base: dict[str, object] = {
        "claim_type": "baggage",
        "summary": "My bag didn't arrive in Rome",
        "story": "My bag never arrived, so I bought clothes.",
        "incident_date": "2026-06-12",
        "incident_location": "Rome",
        "items": [],
        "missing_questions": [],
        "low_confidence_fields": [],
    }
    return Draft.model_validate(base | change)


def test_internal_notes_never_reach_the_customer() -> None:
    noted = customer_facing(
        draft(
            summary="Claim draft pending: customer has not yet described the incident",
            story="The customer has not provided details.",
        )
    )
    assert noted.summary == ""
    assert noted.story == ""


def test_questions_about_fields_on_screen_are_dropped() -> None:
    asked = customer_facing(
        draft(
            missing_questions=[
                "What type of problem are you claiming for?",
                "When did it happen?",
                "Did the airline pay you anything for the delay?",
            ]
        )
    )
    assert asked.missing_questions == ["Did the airline pay you anything for the delay?"]


def test_the_customers_own_words_stay() -> None:
    kept = customer_facing(draft())
    assert kept.summary == "My bag didn't arrive in Rome"
