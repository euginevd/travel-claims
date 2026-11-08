"""Ask customers for documents, send them updates, pay to a PayID and save claims in progress

Revision ID: 0008
Revises: 0005a
Create Date: 2026-11-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0005a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("payid", sa.String(length=320), nullable=True))
    op.add_column("receipts", sa.Column("request_id", sa.Integer(), nullable=True))
    op.add_column("payments", sa.Column("paid_to", sa.String(length=200), nullable=True))
    op.create_table(
        "customer_requests",
        sa.Column("request_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id"), nullable=False
        ),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("asked_by", sa.String(length=200), nullable=False),
        sa.Column("asked_at", sa.String(length=32), nullable=False),
        sa.Column("fulfilled_at", sa.String(length=32), nullable=True),
    )
    op.create_index("ix_customer_requests_claim_id", "customer_requests", ["claim_id"])
    op.create_table(
        "notices",
        sa.Column("notice_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "customer_id",
            sa.String(length=20),
            sa.ForeignKey("customers.customer_id"),
            nullable=False,
        ),
        sa.Column(
            "claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id"), nullable=True
        ),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=True),
        sa.Column("sent_at", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_notices_customer_id", "notices", ["customer_id"])
    op.create_table(
        "claim_drafts",
        sa.Column(
            "customer_id",
            sa.String(length=20),
            sa.ForeignKey("customers.customer_id"),
            primary_key=True,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("claim_drafts")
    op.drop_index("ix_notices_customer_id", table_name="notices")
    op.drop_table("notices")
    op.drop_index("ix_customer_requests_claim_id", table_name="customer_requests")
    op.drop_table("customer_requests")
    op.drop_column("payments", "paid_to")
    op.drop_column("receipts", "request_id")
    op.drop_column("customers", "payid")
