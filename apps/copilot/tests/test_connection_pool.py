"""The pool outlives connections the network or the pooler dropped (CLM-1001, 2026-11-10)."""

from typing import Any, cast

from psycopg_pool import ConnectionPool

from undercover_copilot.server import connection_pool


def test_the_pool_keeps_connections_alive_and_tests_each_before_lending_it() -> None:
    pool = connection_pool("postgresql://u:p@db.invalid:6543/postgres", max_size=4)
    assert pool.closed  # built without connecting
    assert pool.max_size == 4
    assert pool.max_idle == 120
    assert pool._check == ConnectionPool.check_connection  # pyright: ignore[reportPrivateUsage]
    kwargs = cast(dict[str, Any], pool.kwargs)
    assert kwargs["prepare_threshold"] is None  # the transaction pooler can't keep them
    assert (kwargs["keepalives"], kwargs["keepalives_idle"]) == (1, 30)
