"""Bring the database's schema up to date: uv run -m undercover_api.migrate

Alembic is configured here in code, so the installed package needs no alembic.ini.
"""

import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import DBAPIError

MIGRATIONS = Path(__file__).parent / "migrations"
# Tries at building the schema on DSQL, when another cold start is building it too.
ATTEMPTS = 3


def alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def upgrade(url: str) -> None:
    """Apply every migration not yet applied; on DSQL, build the schema once instead."""
    from undercover_api.dsql import create_schema, is_conflict, is_dsql  # noqa: PLC0415

    config = alembic_config(url)
    if not is_dsql(url):
        command.upgrade(config, "head")
        return
    from undercover_api.db import make_engine  # noqa: PLC0415

    head = ScriptDirectory.from_config(config).get_current_head() or ""
    engine = make_engine(url).execution_options(isolation_level="AUTOCOMMIT")
    # Two cold starts can build at once: the loser's conflict is retried, and IF NOT EXISTS
    # skips what the winner made.
    for attempt in range(ATTEMPTS):
        try:
            with engine.connect() as db:
                create_schema(db, head)
            return
        except DBAPIError as error:
            if not is_conflict(error) or attempt == ATTEMPTS - 1:
                raise
            time.sleep(2 + attempt)


if __name__ == "__main__":
    from undercover_api.settings import get_settings

    upgrade(get_settings().database_url)
