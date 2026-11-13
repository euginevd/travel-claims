"""When a customer last added to a claim, for the agent switch; and senior handlers' spot checks

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-13 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("claims", sa.Column("ready_at", sa.String(32), nullable=True))
    op.create_table(
        "spot_checks",
        sa.Column("claim_id", sa.String(20), primary_key=True),
        sa.Column("verdict", sa.String(10), nullable=False),
        sa.Column("checked_by", sa.String(200), nullable=False),
        sa.Column("checked_by_id", sa.String(20), nullable=False),
        sa.Column("checked_at", sa.String(32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("spot_checks")
    op.drop_column("claims", "ready_at")
