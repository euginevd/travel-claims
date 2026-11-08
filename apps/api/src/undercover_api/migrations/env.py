"""Alembic's environment: migrations run online against the configured database."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from undercover_api.db import metadata

config = context.config

connectable = engine_from_config(
    config.get_section(config.config_ini_section, {}),
    prefix="sqlalchemy.",
    poolclass=pool.NullPool,
)
with connectable.connect() as connection:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()
