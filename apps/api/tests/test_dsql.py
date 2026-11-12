"""Aurora DSQL (decision 30): endpoints, DDL as DSQL takes it, lost races, the schema build and
the app's least-privilege role."""

import asyncio
from collections.abc import Generator, MutableMapping
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import boto3  # pyright: ignore[reportMissingTypeStubs]
import pytest
from api_helpers import make_settings
from fastapi import Request
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from undercover_api import db as db_module
from undercover_api import dsql
from undercover_api.db import make_engine, metadata
from undercover_api.main import lost_race
from undercover_api.migrate import upgrade

ENDPOINT = "abc123.dsql.ap-southeast-2.on.aws"


def test_dsql_endpoints_are_recognised() -> None:
    assert dsql.is_dsql(f"postgresql+psycopg://admin@{ENDPOINT}:5432/postgres")
    assert not dsql.is_dsql("postgresql+psycopg://user:pw@db:5432/undercover")
    assert dsql.region_of(ENDPOINT) == "ap-southeast-2"


def test_a_privatelink_endpoint_is_recognised_with_its_region() -> None:
    private = "abc123.dsql-fnh4.ap-southeast-2.on.aws"
    assert dsql.is_dsql(f"postgresql+psycopg://admin@{private}:5432/postgres")
    assert dsql.region_of(private) == "ap-southeast-2"
    assert dsql.region_of("abc123.dsql.us-east-1.on.aws") == "us-east-1"
    assert not dsql.is_dsql("postgresql+psycopg://admin@abc123.dsqlx.ap-southeast-2.on.aws/p")
    assert not dsql.is_dsql("postgresql+psycopg://admin@abc123.dsql.ap-southeast-2.on.aws.evil/p")
    with pytest.raises(ValueError, match="DSQL"):
        dsql.region_of("db.example.com")


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


ROLE = "undercover_app"
ROLE_ARN = "arn:aws:iam::123456789012:role/undercover-api-dev"


class FakeAdmin(FakeDsql):
    """An admin connection whose catalogue already has, or hasn't, the role and its mapping."""

    def __init__(self, *, role: bool, mapped: bool) -> None:
        super().__init__()
        self.role = role
        self.mapped = mapped

    def execute(self, statement: Any, params: dict[str, str]) -> Any:
        query = str(statement)
        self.statements.append(query)
        found = self.role if "pg_roles" in query else self.mapped
        return SimpleNamespace(first=lambda: (1,) if found else None)


def test_a_new_app_role_is_made_mapped_and_granted_only_the_tables() -> None:
    db = FakeAdmin(role=False, mapped=False)
    dsql.grant_app_role(db, ROLE, ROLE_ARN)  # pyright: ignore[reportArgumentType]
    run = [s for s in db.statements if not s.startswith("SELECT")]
    assert run[0] == f"CREATE ROLE {ROLE} WITH LOGIN"
    assert run[1] == f"AWS IAM GRANT {ROLE} TO '{ROLE_ARN}'"
    assert run[2] == f"GRANT USAGE ON SCHEMA public TO {ROLE}"
    grants = run[3:]
    assert len(grants) == len(metadata.tables)
    first = metadata.sorted_tables[0].name
    assert grants[0] == f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {first} TO {ROLE}"
    assert all("alembic_version" not in s for s in run)
    assert all(not s.startswith(("ALTER", "CREATE TABLE", "GRANT ALL")) for s in run)


def test_granting_again_makes_no_second_role_or_mapping() -> None:
    db = FakeAdmin(role=True, mapped=True)
    dsql.grant_app_role(db, ROLE, ROLE_ARN)  # pyright: ignore[reportArgumentType]
    run = [s for s in db.statements if not s.startswith("SELECT")]
    assert not any(s.startswith(("CREATE ROLE", "AWS IAM GRANT")) for s in run)
    assert run == dsql.app_role_grants(ROLE, [t.name for t in metadata.sorted_tables])


@pytest.mark.parametrize(
    ("role", "arn"),
    [
        ("admin", ROLE_ARN),
        ("pg_app", ROLE_ARN),
        ("app; DROP TABLE claims", ROLE_ARN),
        ('"app"', ROLE_ARN),
        ("App", ROLE_ARN),
        ("x" * 64, ROLE_ARN),
        (ROLE, None),
        (ROLE, "arn:aws:iam::12345:role/api"),
        (ROLE, "arn:aws:iam::123456789012:user/api"),
        (ROLE, "arn:aws:iam::123456789012:role/api'; DROP TABLE claims; --"),
        (ROLE, ROLE_ARN + "\n"),
    ],
)
def test_a_bad_role_name_or_arn_is_refused(role: str, arn: str | None) -> None:
    with pytest.raises(ValueError, match="DATABASE_APP_ROLE"):
        dsql.check_app_role(role, arn)
    db = FakeAdmin(role=False, mapped=False)
    if arn is not None:
        with pytest.raises(ValueError, match="DATABASE_APP_ROLE"):
            dsql.grant_app_role(db, role, arn)  # pyright: ignore[reportArgumentType]
        assert db.statements == []


def test_good_arns_in_any_partition_and_with_a_path_pass() -> None:
    dsql.check_app_role(ROLE, ROLE_ARN)
    dsql.check_app_role(ROLE, "arn:aws-us-gov:iam::123456789012:role/service-role/api")
    dsql.check_app_role("app_2", "arn:aws-cn:iam::123456789012:role/a+b=c,d.e@f_g-h")


def test_the_settings_check_the_app_role() -> None:
    url = "sqlite://"
    assert make_settings(url).database_app_role is None
    set_up = make_settings(url, database_app_role=ROLE, database_app_role_iam=ROLE_ARN)
    assert set_up.database_app_role == ROLE
    with pytest.raises(ValidationError, match="DATABASE_APP_ROLE"):
        make_settings(url, database_app_role="bad name", database_app_role_iam=ROLE_ARN)
    with pytest.raises(ValidationError, match="DATABASE_APP_ROLE_IAM"):
        make_settings(url, database_app_role=ROLE)
    with pytest.raises(ValidationError, match="DATABASE_APP_ROLE_IAM"):
        make_settings(url, database_app_role_iam=ROLE_ARN)


class FakeTokens:
    """The DSQL client's token calls, recorded."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def generate_db_connect_admin_auth_token(self, host: str, region: str) -> str:
        self.calls.append("admin")
        return "admin-token"

    def generate_db_connect_auth_token(self, host: str, region: str) -> str:
        self.calls.append("role")
        return "role-token"


def signed_in(
    monkeypatch: pytest.MonkeyPatch, role: str | None
) -> tuple[MutableMapping[str, Any], list[str]]:
    """The connection parameters a DSQL engine signs in with, and the token calls it made."""
    tokens = FakeTokens()

    def client(_service: str, region_name: str) -> FakeTokens:
        return tokens

    monkeypatch.setattr(boto3, "client", client)
    engine = make_engine(f"postgresql+psycopg://admin@{ENDPOINT}:5432/postgres", role)
    _args, params = engine.dialect.create_connect_args(engine.url)
    engine.dialect.dispatch.do_connect(engine.dialect, None, [], params)
    return params, tokens.calls


def test_the_serving_engine_signs_in_as_the_app_role_with_its_own_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    params, calls = signed_in(monkeypatch, ROLE)
    assert params["user"] == ROLE
    assert params["password"] == "role-token"
    assert calls == ["role"]


def test_without_an_app_role_the_engine_signs_in_as_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    params, calls = signed_in(monkeypatch, None)
    assert params["user"] == "admin"
    assert params["password"] == "admin-token"
    assert calls == ["admin"]


def test_a_dsql_engine_skips_the_hstore_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    # The lookup runs inside a SAVEPOINT on first connect, which DSQL doesn't support.
    def client(_service: str, region_name: str) -> FakeTokens:
        return FakeTokens()

    monkeypatch.setattr(boto3, "client", client)
    engine = make_engine(f"postgresql+psycopg://admin@{ENDPOINT}:5432/postgres")
    assert getattr(engine.dialect, "use_native_hstore", None) is False


def test_off_dsql_the_app_role_changes_nothing() -> None:
    engine = make_engine("sqlite://", ROLE)
    assert engine.url.username is None


class FakeEngine:
    """An admin engine whose connection is a FakeDsql."""

    def execution_options(self, **_options: str) -> FakeEngine:
        return self

    @contextmanager
    def connect(self) -> Generator[FakeDsql]:
        yield FakeDsql()


@pytest.mark.parametrize("role", [None, ROLE])
def test_migrating_dsql_grants_the_app_role_only_when_set(
    monkeypatch: pytest.MonkeyPatch, role: str | None
) -> None:
    granted: list[tuple[str, str]] = []

    def built(_db: object, _head: str) -> bool:
        return True

    def grant(_db: object, app_role: str, arn: str) -> None:
        granted.append((app_role, arn))

    def engine(_url: str) -> FakeEngine:
        return FakeEngine()

    monkeypatch.setattr(db_module, "make_engine", engine)
    monkeypatch.setattr(dsql, "create_schema", built)
    monkeypatch.setattr(dsql, "grant_app_role", grant)
    upgrade(f"postgresql+psycopg://admin@{ENDPOINT}:5432/postgres", role, ROLE_ARN)
    assert granted == ([(ROLE, ROLE_ARN)] if role else [])
