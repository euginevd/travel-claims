"""Let customers sign in by email, mark where a claim came from, and keep receipts

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-08 20:00:00
"""

from collections.abc import Sequence
from typing import Any, cast

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("customers") as batch:  # SQLite adds a unique column this way
        batch.add_column(sa.Column("email", sa.String(length=320), nullable=True))
        batch.create_unique_constraint("uq_customers_email", ["email"])
    customers = sa.table(
        "customers",
        sa.column("customer_id", sa.String),
        sa.column("record", sa.JSON),
        sa.column("email", sa.String),
    )
    connection = op.get_bind()
    for customer_id, record in connection.execute(
        sa.select(customers.c.customer_id, customers.c.record)
    ):
        email = cast(dict[str, Any], record or {}).get("email")
        if email:
            connection.execute(
                customers.update()
                .where(customers.c.customer_id == customer_id)
                .values(email=str(email).lower())
            )
    op.add_column(
        "claims",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="seeded"),
    )
    op.create_table(
        "receipts",
        sa.Column("receipt_id", sa.String(length=32), primary_key=True),
        sa.Column(
            "claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id"), nullable=False
        ),
        sa.Column("media_type", sa.String(length=50), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_receipts_claim_id", "receipts", ["claim_id"])


def downgrade() -> None:
    op.drop_index("ix_receipts_claim_id", table_name="receipts")
    op.drop_table("receipts")
    with op.batch_alter_table("claims") as batch:
        batch.drop_column("source")
    with op.batch_alter_table("customers") as batch:
        batch.drop_constraint("uq_customers_email", type_="unique")
        batch.drop_column("email")
