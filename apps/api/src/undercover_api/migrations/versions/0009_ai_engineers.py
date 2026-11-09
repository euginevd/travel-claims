"""AI engineers, who sign in to their own console

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-09 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "engineers",
        sa.Column("engineer_id", sa.String(length=20), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False, unique=True),
    )


def downgrade() -> None:
    op.drop_table("engineers")
