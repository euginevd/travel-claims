"""The judge's grades of evaluated copies, and when a run went to the judge

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-10 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("runs") as batch:
        batch.add_column(sa.Column("grading_since", sa.String(length=32), nullable=True))
    op.create_table(
        "grades",
        sa.Column(
            "claim_id", sa.String(length=20), sa.ForeignKey("claims.claim_id"), nullable=False
        ),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.run_id"), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("same_grounds", sa.Boolean(), nullable=True),
        sa.Column("same_section", sa.Boolean(), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=False),
        sa.Column("cost", sa.Numeric(12, 6, asdecimal=False), nullable=False),
        sa.Column("graded_at", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("claim_id"),
    )
    op.create_index("ix_grades_run_id", "grades", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_grades_run_id", table_name="grades")
    op.drop_table("grades")
    with op.batch_alter_table("runs") as batch:
        batch.drop_column("grading_since")
