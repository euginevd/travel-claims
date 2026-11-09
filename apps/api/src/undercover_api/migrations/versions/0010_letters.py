"""Letters handlers send customers about a decision

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-09 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "letters",
        sa.Column(
            "claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id"), primary_key=True
        ),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("drafted_by_ai", sa.Boolean(), nullable=False),
        sa.Column("sent_by", sa.String(length=200), nullable=False),
        sa.Column("sent_at", sa.String(length=32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("letters")
