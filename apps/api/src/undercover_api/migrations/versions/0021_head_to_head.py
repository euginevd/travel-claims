"""A comparison's head-to-head verdicts on its picks' explanations

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-14 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("comparisons", sa.Column("judging_since", sa.String(32), nullable=True))
    op.add_column("comparisons", sa.Column("verdicts", sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("comparisons", "verdicts")
    op.drop_column("comparisons", "judging_since")
