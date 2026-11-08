"""Evaluations and improvement: labelled claims, runs, the claim agent's configuration versions
and improvement rounds, and each claim's run and configuration version

Revision ID: 0005a
Revises: 0004
Create Date: 2026-11-08 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005a"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONEY = sa.Numeric(12, 2)


def upgrade() -> None:
    op.add_column("claims", sa.Column("run_id", sa.Integer(), nullable=True))
    op.add_column("claims", sa.Column("original_claim_id", sa.String(length=20), nullable=True))
    op.add_column("claims", sa.Column("config_version", sa.Integer(), nullable=True))
    op.create_index("ix_claims_run_id", "claims", ["run_id"])
    op.create_table(
        "labelled_claims",
        sa.Column("claim_id", sa.String(length=20), primary_key=True),
        sa.Column("label_set", sa.String(length=20), nullable=False),
        sa.Column("tiny", sa.Boolean(), nullable=False),
        sa.Column("claim", sa.JSON(), nullable=False),
        sa.Column("label", sa.JSON(), nullable=False),
    )
    op.create_table(
        "configurations",
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=50), nullable=False),
        sa.Column("effort", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("diff", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("parent_version", sa.Integer(), nullable=True),
        sa.Column("proposed_by", sa.String(length=200), nullable=False),
        sa.Column("reviewed_by", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
    )
    op.create_table(
        "runs",
        sa.Column("run_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("label_set", sa.String(length=20), nullable=False),
        sa.Column("size", sa.String(length=10), nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_by", sa.String(length=200), nullable=False),
        sa.Column("started_at", sa.String(length=32), nullable=False),
        sa.Column("finished_at", sa.String(length=32), nullable=True),
        sa.Column("scores", sa.JSON(), nullable=True),
    )
    op.create_table(
        "rounds",
        sa.Column("round_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("baseline_version", sa.Integer(), nullable=False),
        sa.Column("candidate_version", sa.Integer(), nullable=True),
        sa.Column("baseline_eval_run", sa.Integer(), nullable=True),
        sa.Column("baseline_held_run", sa.Integer(), nullable=True),
        sa.Column("candidate_held_run", sa.Integer(), nullable=True),
        sa.Column("proposal", sa.JSON(), nullable=True),
        sa.Column("review", sa.JSON(), nullable=True),
        sa.Column("verdict", sa.JSON(), nullable=True),
        sa.Column("improver_cost", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("spend_limit", MONEY, nullable=False),
        sa.Column("started_by", sa.String(length=200), nullable=False),
        sa.Column("started_at", sa.String(length=32), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rounds")
    op.drop_table("runs")
    op.drop_table("configurations")
    op.drop_table("labelled_claims")
    op.drop_index("ix_claims_run_id", table_name="claims")
    op.drop_column("claims", "config_version")
    op.drop_column("claims", "original_claim_id")
    op.drop_column("claims", "run_id")
