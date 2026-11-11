"""Where the agent saves a claim's progress: DynamoDB on AWS, PostgreSQL locally (decision 30)."""

from types import SimpleNamespace

import pytest

from undercover_agent.server import CHECKPOINT_TTL_SECONDS, checkpoints


def test_a_checkpoint_table_means_dynamodb_and_no_postgres_store() -> None:
    settings = SimpleNamespace(checkpoint_table="travel-claims-dev-checkpoints")
    saver, store = checkpoints(settings, "ap-southeast-2")
    assert type(saver).__name__ == "DynamoDBSaver"
    assert store is None
    assert CHECKPOINT_TTL_SECONDS == 7 * 24 * 3600


def test_neither_store_named_is_refused() -> None:
    settings = SimpleNamespace(checkpoint_table=None, checkpoint_database_url=None)
    with pytest.raises(RuntimeError, match="CHECKPOINT_TABLE"):
        checkpoints(settings, "ap-southeast-2")
