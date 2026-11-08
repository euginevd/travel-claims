"""Record the handler's id beside their name on sign-offs and send-backs

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-08 17:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("decisions", "signed_off_by_id"),
    ("payments", "signed_off_by_id"),
    ("sent_back", "sent_back_by_id"),
)


def upgrade() -> None:
    for table, column in COLUMNS:
        op.add_column(table, sa.Column(column, sa.String(length=20), nullable=True))


def downgrade() -> None:
    for table, column in COLUMNS:
        with op.batch_alter_table(table) as batch:  # SQLite can't drop a column in place
            batch.drop_column(column)
