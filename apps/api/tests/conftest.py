import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from api_helpers import DANA, DATA, MARCUS, SAM, FakeAgent, make_settings, sign_in
from fastapi.testclient import TestClient
from sqlalchemy import text

from undercover_api.db import make_engine, metadata
from undercover_api.main import create_app
from undercover_api.migrate import upgrade
from undercover_api.seed import seed_if_empty

# Set to a PostgreSQL url to run the tests there (CI does); SQLite in a temp folder otherwise.
POSTGRES_URL = os.environ.get("TEST_DATABASE_URL")


def fresh(url: str) -> None:
    """Empty a PostgreSQL database the tests own, so every test starts from nothing."""
    engine = make_engine(url)
    with engine.begin() as db:
        metadata.drop_all(db)
        db.execute(text("DROP TABLE IF EXISTS alembic_version"))
    engine.dispose()


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    if POSTGRES_URL:
        url = POSTGRES_URL
        fresh(url)
    else:
        url = f"sqlite:///{(tmp_path / 'undercover.db').as_posix()}"
    upgrade(url)
    engine = make_engine(url)
    seed_if_empty(engine, DATA)
    engine.dispose()
    return url


@pytest.fixture
def agent() -> FakeAgent:
    return FakeAgent()


@pytest.fixture
def client(database_url: str, agent: FakeAgent, tmp_path: Path) -> Iterator[TestClient]:
    settings = make_settings(database_url, receipts_dir=tmp_path / "receipts")
    app = create_app(settings, agent_service=agent)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def dana(client: TestClient) -> dict[str, str]:
    return sign_in(client, DANA)


@pytest.fixture
def marcus(client: TestClient) -> dict[str, str]:
    return sign_in(client, MARCUS)


@pytest.fixture
def sam(client: TestClient) -> dict[str, str]:
    return sign_in(client, SAM, role="engineer")
