"""Customers' feedback, and who added a live claim to the evaluation set

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-11 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("feedback_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "customer_id",
            sa.String(length=20),
            sa.ForeignKey("customers.customer_id"),
            nullable=False,
        ),
        sa.Column("subject", sa.String(length=10), nullable=False),
        sa.Column("claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id")),
        sa.Column("helpful", sa.Boolean(), nullable=False),
        sa.Column("comment", sa.String(length=300), nullable=True),
        sa.Column("question", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("feedback_id"),
    )
    op.create_index("ix_feedback_customer_id", "feedback", ["customer_id"])
    op.add_column("labelled_claims", sa.Column("added_by", sa.String(length=200), nullable=True))
    op.add_column("labelled_claims", sa.Column("added_at", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("labelled_claims", "added_at")
    op.drop_column("labelled_claims", "added_by")
    op.drop_index("ix_feedback_customer_id", table_name="feedback")
    op.drop_table("feedback")
