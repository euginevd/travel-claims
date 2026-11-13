"""Comparisons of models on the same claims

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-14 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "comparisons",
        sa.Column("compare_id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("size", sa.String(10), nullable=False),
        sa.Column("repeats", sa.Integer, nullable=False),
        sa.Column("plan", sa.JSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("started_by", sa.String(200), nullable=False),
        sa.Column("started_at", sa.String(32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("comparisons")
