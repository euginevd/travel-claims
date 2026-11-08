"""Remove the claims a customer made on the laptop, leaving the seeded ones, so a test account
can be reset without wiping the whole database. Local only; it refuses outside local.

Usage: python -m undercover_api.dev_cleanup --customer CUS-3005
"""

import argparse
import logging
from pathlib import Path

from sqlalchemy import Connection, delete, select

from undercover_api.db import (
    calculations,
    claims,
    customer_requests,
    decisions,
    make_engine,
    model_calls,
    notices,
    payments,
    receipts,
    sent_back,
    steps,
)
from undercover_api.logs import configure_logging
from undercover_api.portal import SOURCE_CUSTOMER
from undercover_api.settings import get_settings

log = logging.getLogger(__name__)

# Everything that hangs off a claim, removed before the claim itself.
CLAIM_TABLES = (
    steps,
    model_calls,
    calculations,
    payments,
    decisions,
    sent_back,
    receipts,
    customer_requests,
    notices,
)


def remove_customer_claims(db: Connection, customer_id: str, receipts_dir: Path) -> list[str]:
    """Delete the claims a customer made themselves, with everything recorded on them and their
    receipt files; seeded claims and evaluation copies stay. Returns the removed claim ids."""
    ids = list(
        db.scalars(
            select(claims.c.claim_id).where(
                claims.c.customer_id == customer_id,
                claims.c.source == SOURCE_CUSTOMER,
            )
        )
    )
    if not ids:
        return []
    files = list(db.scalars(select(receipts.c.receipt_id).where(receipts.c.claim_id.in_(ids))))
    for table in CLAIM_TABLES:
        db.execute(delete(table).where(table.c.claim_id.in_(ids)))
    db.execute(delete(claims).where(claims.c.claim_id.in_(ids)))
    for name in files:
        (receipts_dir / name).unlink(missing_ok=True)
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer", required=True, help="The customer id, e.g. CUS-3005")
    args = parser.parse_args()
    configure_logging()
    settings = get_settings()
    if settings.environment != "local":
        raise SystemExit("dev_cleanup runs only with ENVIRONMENT=local")
    with make_engine(settings.database_url).begin() as db:
        removed = remove_customer_claims(db, args.customer, settings.receipts_dir)
    log.info("removed %d claims", len(removed))
    print("Removed:", ", ".join(removed) or "nothing")


if __name__ == "__main__":
    main()
