"""The payouts kill switch, on (payouts allowed) to start, the history of setting changes, and
the red-team suite's reports

Revision ID: 0006b
Revises: 0004
Create Date: 2026-11-08 22:00:00
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0006b"
down_revision: str | None = "0007c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "setting_changes",
        sa.Column("change_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("changed_by", sa.String(length=200), nullable=False),
        sa.Column("changed_by_id", sa.String(length=20), nullable=False),
        sa.Column("changed_at", sa.String(length=32), nullable=False),
    )
    op.create_table(
        "redteam_reports",
        sa.Column("report_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_at", sa.String(length=32), nullable=False),
        sa.Column("run_by", sa.String(length=200), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
    )
    settings = sa.table(
        "settings",
        sa.column("key", sa.String),
        sa.column("value", sa.JSON),
        sa.column("changed_by", sa.String),
        sa.column("changed_at", sa.String),
    )
    op.bulk_insert(
        settings,
        [
            {
                "key": "payouts_paused",
                "value": {"paused": False, "reason": "Payouts on from the start"},
                "changed_by": "Migration",
                "changed_at": datetime.now(UTC).isoformat(timespec="seconds"),
            }
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM settings WHERE key = 'payouts_paused'")
    op.drop_table("redteam_reports")
    op.drop_table("setting_changes")
