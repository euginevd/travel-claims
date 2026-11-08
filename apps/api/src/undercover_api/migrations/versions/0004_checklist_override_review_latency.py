"""Keep the agent's checklist and any override on a decision, customers' review requests, and
each model call's latency

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-08 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("decisions", sa.Column("checklist", sa.JSON(), nullable=True))
    op.add_column("decisions", sa.Column("override", sa.JSON(), nullable=True))
    op.add_column("claims", sa.Column("review_requested_at", sa.String(length=32), nullable=True))
    op.add_column("claims", sa.Column("review_note", sa.Text(), nullable=True))
    op.add_column("model_calls", sa.Column("latency_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("model_calls", "latency_ms")
    op.drop_column("claims", "review_note")
    op.drop_column("claims", "review_requested_at")
    op.drop_column("decisions", "override")
    op.drop_column("decisions", "checklist")
