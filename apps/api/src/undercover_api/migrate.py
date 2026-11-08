"""Bring the database's schema up to date: uv run -m undercover_api.migrate

Alembic is configured here in code, so the installed package needs no alembic.ini.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS = Path(__file__).parent / "migrations"


def alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def upgrade(url: str) -> None:
    """Apply every migration not yet applied."""
    command.upgrade(alembic_config(url), "head")


if __name__ == "__main__":
    from undercover_api.settings import get_settings

    upgrade(get_settings().database_url)
