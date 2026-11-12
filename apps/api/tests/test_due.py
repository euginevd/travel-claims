"""A seeded claim's service clock starts when the queue was loaded, not on its historical
submission date, so a demo's queue isn't overdue months after the data was written."""

from api_helpers import DATA
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from undercover_api.claims import SERVICE_DAYS, business_days_after, due_on
from undercover_api.db import make_engine, now, reference
from undercover_api.seed import QUEUE_LOADED_ON, seed_if_empty


def test_a_seeded_claim_counts_from_the_later_of_submission_and_loading() -> None:
    assert due_on("2026-07-13", "seeded", "2026-11-13") == business_days_after("2026-11-13", 10)
    # Loaded before it was submitted, or no load date yet: its own submission date.
    assert due_on("2026-11-20", "seeded", "2026-11-13") == business_days_after("2026-11-20", 10)
    assert due_on("2026-07-13", "seeded", None) == business_days_after("2026-07-13", 10)


def test_a_portal_claim_always_counts_from_its_submission() -> None:
    assert due_on("2026-07-13", "portal", "2026-11-13") == business_days_after("2026-07-13", 10)


def test_the_queue_shows_seeded_claims_due_from_the_day_it_was_loaded(
    client: TestClient, dana: dict[str, str]
) -> None:
    queue = client.get("/api/staff/claims", headers=dana).json()
    seeded = next(c for c in queue if c["claim_id"] == "CLM-1001")
    assert seeded["due_on"] == business_days_after(now()[:10], SERVICE_DAYS)


def test_a_database_seeded_before_this_gets_a_load_date_on_the_next_start(
    database_url: str,
) -> None:
    engine = make_engine(database_url)
    with engine.begin() as db:
        db.execute(delete(reference).where(reference.c.key == QUEUE_LOADED_ON))
    assert seed_if_empty(engine, DATA) is False
    with engine.begin() as db:
        loaded = db.execute(
            select(reference.c.value).where(reference.c.key == QUEUE_LOADED_ON)
        ).scalar_one()
    engine.dispose()
    assert loaded == now()[:10]
