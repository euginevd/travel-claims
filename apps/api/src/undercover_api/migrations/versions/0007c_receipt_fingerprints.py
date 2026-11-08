"""Keep each receipt's fingerprints, so the duplicate check can find it on another claim

Revision ID: 0007c
Revises: 0004
Create Date: 2026-11-08 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007c"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("receipts", sa.Column("sha256", sa.String(length=64), nullable=True))
    op.add_column("receipts", sa.Column("phash", sa.String(length=16), nullable=True))
    op.create_index("ix_receipts_sha256", "receipts", ["sha256"])


def downgrade() -> None:
    op.drop_index("ix_receipts_sha256", table_name="receipts")
    op.drop_column("receipts", "phash")
    op.drop_column("receipts", "sha256")
