"""Alembic's environment: migrations run online against the configured database."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from undercover_api.db import NO_PREPARED_STATEMENTS, metadata

config = context.config

section = config.get_section(config.config_ini_section, {})
psycopg = section.get("sqlalchemy.url", "").startswith("postgresql+psycopg")
connectable = engine_from_config(
    section,
    prefix="sqlalchemy.",
    poolclass=pool.NullPool,
    connect_args=NO_PREPARED_STATEMENTS if psycopg else {},
)
with connectable.connect() as connection:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()
