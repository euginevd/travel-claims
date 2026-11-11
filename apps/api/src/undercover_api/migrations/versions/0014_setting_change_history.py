"""Setting changes keep the value before and the reason, for the settings page's audit trail

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-11 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("setting_changes", sa.Column("old_value", sa.JSON(), nullable=True))
    op.add_column("setting_changes", sa.Column("reason", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("setting_changes", "reason")
    op.drop_column("setting_changes", "old_value")
