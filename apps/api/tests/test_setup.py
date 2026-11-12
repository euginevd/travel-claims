"""Settings, seeding, migrations and logs."""

import json
import logging
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from api_helpers import DATA, make_settings
from pydantic import ValidationError
from sqlalchemy import Connection, func, select

from undercover_api.db import (
    claims,
    customers,
    decisions,
    make_engine,
    metadata,
    reference,
    settings,
)
from undercover_api.logs import JsonFormatter, redact
from undercover_api.seed import seed_if_empty


@contextmanager
def connected(url: str) -> Generator[Connection]:
    engine = make_engine(url)
    try:
        with engine.connect() as db:
            yield db
    finally:
        engine.dispose()


def test_local_sign_in_is_refused_outside_a_laptop() -> None:
    with pytest.raises(ValidationError, match="only when ENVIRONMENT is local"):
        make_settings("sqlite://", environment="dev")


def test_local_sign_in_needs_its_password() -> None:
    with pytest.raises(ValidationError, match="needs HANDLER_PASSWORD"):
        make_settings("sqlite://", handler_password=None)


def test_a_short_agent_key_is_refused() -> None:
    with pytest.raises(ValidationError):
        make_settings("sqlite://", undercover_api_key="short")


def test_seeding_loads_the_queue_with_the_security_claim(database_url: str) -> None:
    with connected(database_url) as db:
        ids = set(db.execute(select(claims.c.claim_id)).scalars())
        assert len(ids) == 26
        assert "CLM-1901" in ids
        assert db.execute(select(func.count()).select_from(decisions)).scalar_one() == 0
        limit = db.execute(select(settings.c.value).where(settings.c.key == "approval_limit"))
        assert limit.scalar_one() == 1000.0
        keys = set(db.execute(select(reference.c.key)).scalars())
        assert keys == {
            "plans",
            "claims_manual_version",
            "policy_wording_version",
            "queue_loaded_on",
        }
        assert db.execute(select(func.count()).select_from(customers)).scalar_one() == 50


def test_the_handlers_decisions_are_never_loaded(database_url: str) -> None:
    held_out = {
        c["claim_id"] for c in json.loads((DATA / "evals" / "held_out_claims.json").read_text())
    }
    with connected(database_url) as db:
        loaded = set(db.execute(select(claims.c.claim_id)).scalars())
        dumped = json.dumps([dict(r) for r in db.execute(select(reference)).mappings()])
    assert not held_out & loaded
    assert "handler_decision" not in dumped


def test_seeding_twice_changes_nothing(database_url: str) -> None:
    engine = make_engine(database_url)
    assert seed_if_empty(engine, DATA) is False
    engine.dispose()


def test_the_migrations_match_the_tables(database_url: str) -> None:
    with connected(database_url) as db:
        differences = compare_metadata(MigrationContext.configure(db), metadata)
    assert differences == []


def test_logs_redact_personal_data() -> None:
    line = "maya.patel@example.com on POL-2001 for CUS-3001 about CLM-1001"
    assert redact(line) == "[email] on [policy] for [customer] about CLM-1001"
    record = logging.LogRecord("t", logging.INFO, "f", 1, line, None, None)
    entry = json.loads(JsonFormatter().format(record))
    assert entry["message"] == "[email] on [policy] for [customer] about CLM-1001"
    assert entry["request_id"] == "-"


def test_seed_reads_from_the_folder_given(tmp_path: Path) -> None:
    url = f"sqlite:///{(tmp_path / 'empty.db').as_posix()}"
    engine = make_engine(url)
    metadata.create_all(engine)
    with pytest.raises(FileNotFoundError):
        seed_if_empty(engine, tmp_path)
    engine.dispose()


def test_the_agents_issuer_needs_https_and_its_client() -> None:
    issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_agent"
    with pytest.raises(ValueError, match="AGENT_CALLER_CLIENT"):
        make_settings("sqlite://", agent_caller_issuer=issuer)
    with pytest.raises(ValueError, match="https"):
        make_settings("sqlite://", agent_caller_issuer="http://x", agent_caller_client="c")
    found = make_settings("sqlite://", agent_caller_issuer=issuer, agent_caller_client="c")
    assert found.agent_caller_client == "c"


def test_on_aws_with_the_agents_token_no_shared_key_is_needed() -> None:
    issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_agent"
    arn = "arn:aws:bedrock-agentcore:ap-southeast-2:111122223333:runtime/agent-abc"
    aws = {"agent_caller_issuer": issuer, "agent_caller_client": "c", "agent_runtime_arn": arn}
    found = make_settings("sqlite://", undercover_api_key=None, **aws)
    assert found.undercover_api_key is None
    for missing in ("agent_caller_issuer", "agent_runtime_arn"):
        kept = {k: v for k, v in aws.items() if k != missing}
        with pytest.raises(ValueError, match="UNDERCOVER_API_KEY"):
            make_settings("sqlite://", undercover_api_key=None, **kept)
