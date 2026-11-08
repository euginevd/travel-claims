from collections.abc import Iterator
from pathlib import Path

import pytest
from api_helpers import DANA, DATA, MARCUS, make_settings, sign_in
from fastapi.testclient import TestClient

from undercover_api.db import make_engine
from undercover_api.main import create_app
from undercover_api.migrate import upgrade
from undercover_api.seed import seed_if_empty


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    url = f"sqlite:///{(tmp_path / 'undercover.db').as_posix()}"
    upgrade(url)
    engine = make_engine(url)
    seed_if_empty(engine, DATA)
    engine.dispose()
    return url


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(database_url))) as test_client:
        yield test_client


@pytest.fixture
def dana(client: TestClient) -> dict[str, str]:
    return sign_in(client, DANA)


@pytest.fixture
def marcus(client: TestClient) -> dict[str, str]:
    return sign_in(client, MARCUS)
