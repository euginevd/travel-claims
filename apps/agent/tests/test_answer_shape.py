"""Every Wattle answer comes back in one bounded shape the apps lay out as data, never markup."""

from undercover_agent.answer_shape import MAX_POINTS, shape


def test_a_reply_becomes_a_headline_cited_points_and_one_next_question() -> None:
    shaped = shape(
        {
            "headline": "Yes, it looks covered.",
            "points": [
                {"text": "Your flight left **4h 40m** late", "source": 1},
                {"text": "It pays up to **$1,500**", "source": 2},
            ],
            "sources": ["Policy wording section 3", "My policies"],
            "next": "What if the airline won't give a letter?",
        },
        "fallback",
    )
    assert shaped.headline == "Yes, it looks covered."
    assert [p.source for p in shaped.points] == [1, 2]
    assert shaped.next == "What if the airline won't give a letter?"
    # The checks and the conversation read plain text: the headline and points, no markers.
    assert shaped.answer == (
        "Yes, it looks covered. Your flight left 4h 40m late It pays up to $1,500"
    )


def test_a_reply_is_bounded_whatever_the_model_sends() -> None:
    shaped = shape(
        {
            "headline": "",
            "points": [{"text": f"Point {i}", "source": 9} for i in range(6)] + ["not a dict"],
            "sources": ["Run 3"],
            "next": "x" * 500,
        },
        "Sorry, I couldn't answer that just now.",
    )
    assert shaped.headline == "Sorry, I couldn't answer that just now."
    assert len(shaped.points) == MAX_POINTS
    # A citation past the sources is dropped rather than pointing at nothing.
    assert {p.source for p in shaped.points} == {0}
    assert len(shaped.next) == 100


def test_an_older_reply_with_only_an_answer_still_works() -> None:
    shaped = shape({"answer": "Run 9 scored 84%.", "sources": []}, "fallback")
    assert shaped.headline == "Run 9 scored 84%."
    assert shaped.points == []
    assert shaped.next == ""
