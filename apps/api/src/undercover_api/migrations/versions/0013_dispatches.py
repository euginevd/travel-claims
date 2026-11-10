"""Dispatches: claim agents working the queue's waiting claims for a senior handler

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-10 19:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dispatches",
        sa.Column("dispatch_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("claim_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_by", sa.String(length=200), nullable=False),
        sa.Column("started_at", sa.String(length=32), nullable=False),
        sa.Column("finished_at", sa.String(length=32), nullable=True),
        sa.Column("stopped_reason", sa.String(length=500), nullable=True),
        sa.PrimaryKeyConstraint("dispatch_id"),
    )


def downgrade() -> None:
    op.drop_table("dispatches")
