"""Heartbeats on claims in progress, and how often a stalled claim was carried on

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-10 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("claims") as batch:
        batch.add_column(sa.Column("heartbeat_at", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("recoveries", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("claims") as batch:
        batch.drop_column("recoveries")
        batch.drop_column("heartbeat_at")
