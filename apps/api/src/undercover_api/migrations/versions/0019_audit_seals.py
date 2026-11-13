"""The audit log's seals, each entry's SHA-256 digest chained to the one before; and each
assistant answer, for the agents map

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-13 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_seals",
        sa.Column("ref", sa.String(80), primary_key=True),
        sa.Column("seq", sa.Integer, nullable=False, unique=True),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("chain", sa.String(64), nullable=False),
        sa.Column("sealed_at", sa.String(32), nullable=False),
    )
    op.create_table(
        "assistant_calls",
        sa.Column("call_id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("agent", sa.String(20), nullable=False),
        sa.Column("model_calls", sa.Integer, nullable=False),
        sa.Column("cost", sa.Numeric(12, 6, asdecimal=False), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("assistant_calls")
    op.drop_table("audit_seals")
