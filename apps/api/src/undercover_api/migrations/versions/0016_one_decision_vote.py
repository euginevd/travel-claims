"""One vote per customer on each decision's explanation

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-11 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DECISION_ONLY = sa.text("subject = 'decision'")


def upgrade() -> None:
    # Two votes that raced in before the index: keep each customer's first on each claim.
    op.execute(
        "DELETE FROM feedback WHERE subject = 'decision' AND feedback_id NOT IN ("
        "SELECT MIN(feedback_id) FROM feedback WHERE subject = 'decision' "
        "GROUP BY customer_id, claim_id)"
    )
    op.create_index(
        "uq_feedback_decision_vote",
        "feedback",
        ["customer_id", "claim_id"],
        unique=True,
        postgresql_where=DECISION_ONLY,
        sqlite_where=DECISION_ONLY,
    )


def downgrade() -> None:
    op.drop_index("uq_feedback_decision_vote", table_name="feedback")
