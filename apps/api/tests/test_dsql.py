"""Aurora DSQL (decision 30): endpoints, DDL as DSQL takes it, lost races and the schema build."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import Request
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from undercover_api import dsql
from undercover_api.db import metadata
from undercover_api.main import lost_race

ENDPOINT = "abc123.dsql.ap-southeast-2.on.aws"


def test_dsql_endpoints_are_recognised() -> None:
    assert dsql.is_dsql(f"postgresql+psycopg://admin@{ENDPOINT}:5432/postgres")
    assert not dsql.is_dsql("postgresql+psycopg://user:pw@db:5432/undercover")
    assert dsql.region_of(ENDPOINT) == "ap-southeast-2"


def test_every_table_and_index_compiles_for_dsql() -> None:
    dialect = postgresql.dialect()  # pyright: ignore[reportUnknownMemberType]
    for table in metadata.sorted_tables:
        assert "SERIAL" not in dsql.dsql_ddl(str(CreateTable(table).compile(dialect=dialect)))
        for index in table.indexes:
            ddl = dsql.dsql_ddl(
                str(CreateIndex(index, if_not_exists=True).compile(dialect=dialect))
            )
            assert "INDEX ASYNC IF NOT EXISTS" in ddl


def test_a_lost_race_is_a_409_and_other_errors_stay_errors() -> None:
    race = SimpleNamespace(orig=SimpleNamespace(sqlstate=dsql.CONFLICT))
    assert dsql.is_conflict(race)  # pyright: ignore[reportArgumentType]
    request = Request({"type": "http"})
    response = asyncio.run(lost_race(request, race))  # pyright: ignore[reportArgumentType]
    assert response.status_code == 409
    with pytest.raises(ValueError, match="other"):
        asyncio.run(lost_race(request, ValueError("other")))


class FakeDsql:
    """Records each statement; an index build returns a job that finishes."""

    dialect = postgresql.dialect()  # pyright: ignore[reportUnknownMemberType]

    def __init__(self) -> None:
        self.statements: list[str] = []

    def exec_driver_sql(self, statement: str) -> Any:
        self.statements.append(statement)
        job = "job1" if "INDEX ASYNC" in statement else None
        return SimpleNamespace(returns_rows=job is not None, scalar=lambda: job)

    def execute(self, statement: Any, params: dict[str, str]) -> Any:
        self.statements.append(str(statement))
        return SimpleNamespace(scalar=lambda: True)


def inspector(stamped: bool) -> Any:
    """inspect() for a database that is, or isn't, already stamped."""

    def has_table(_name: str) -> bool:
        return stamped

    def inspect(_db: object) -> SimpleNamespace:
        return SimpleNamespace(has_table=has_table)

    return inspect


def test_the_schema_is_built_once_then_stamped(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDsql()
    monkeypatch.setattr(dsql, "inspect", inspector(stamped=False))
    assert dsql.create_schema(db, "0016")  # pyright: ignore[reportArgumentType]
    assert sum("CREATE TABLE" in s for s in db.statements) == len(metadata.tables) + 1
    assert any("wait_for_job" in s for s in db.statements)
    assert "INSERT INTO alembic_version" in db.statements[-1]
    monkeypatch.setattr(dsql, "inspect", inspector(stamped=True))
    assert not dsql.create_schema(FakeDsql(), "0016")  # pyright: ignore[reportArgumentType]
