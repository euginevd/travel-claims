"""The pool outlives connections the network or the pooler dropped (CLM-1001, 2026-11-10)."""

from typing import Any, cast

from psycopg_pool import ConnectionPool

from undercover_agent.server import connection_pool


def test_the_pool_keeps_connections_alive_and_tests_each_before_lending_it() -> None:
    pool = connection_pool("postgresql://u:p@db.invalid:6543/postgres", max_size=4)
    assert pool.closed  # built without connecting
    assert pool.max_size == 4
    assert pool.max_idle == 120
    assert pool._check == ConnectionPool.check_connection  # pyright: ignore[reportPrivateUsage]
    kwargs = cast(dict[str, Any], pool.kwargs)
    assert kwargs["prepare_threshold"] is None  # the transaction pooler can't keep them
    assert (kwargs["keepalives"], kwargs["keepalives_idle"]) == (1, 30)
    assert (kwargs["connect_timeout"], kwargs["tcp_user_timeout"]) == (10, 10_000)


def test_a_checkpoint_table_made_at_the_same_moment_elsewhere_is_retried() -> None:
    from psycopg import errors  # noqa: PLC0415

    from undercover_agent.server import set_up_tables  # noqa: PLC0415

    calls: list[str] = []

    def racing() -> None:
        calls.append("saver")
        if len(calls) == 1:
            raise errors.UniqueViolation("pg_type_typname_nsp_index")

    set_up_tables(racing, lambda: calls.append("store"), attempts=2)
    assert calls == ["saver", "saver", "store"]


def test_a_table_that_keeps_colliding_still_fails() -> None:
    import pytest  # noqa: PLC0415
    from psycopg import errors  # noqa: PLC0415

    from undercover_agent.server import set_up_tables  # noqa: PLC0415

    def always() -> None:
        raise errors.DuplicateTable("checkpoint_blobs")

    with pytest.raises(errors.DuplicateTable):
        set_up_tables(always, attempts=2)
