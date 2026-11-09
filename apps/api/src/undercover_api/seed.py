"""Load UnderCover's records into an empty database: uv run -m undercover_api.seed

From data/: the policies, customers, handlers, the claims queue and the approval limit, plus
the security claim CLM-1901 with its policy and customer. From the context layer: the plans and
the claims manual's version. The handlers' decisions on the two labelled sets
(data/evals/) go into the labelled_claims table, which no agent route returns except the
evaluation set's misses for the improver; the security claim's decision is never loaded.
"""

import json
import logging
from pathlib import Path
from typing import Any, cast

from sqlalchemy import Connection, Engine, func, insert, select, update

from undercover_api.db import (
    claims,
    customers,
    engineers,
    handlers,
    labelled_claims,
    make_engine,
    now,
    policies,
    reference,
    settings,
)
from undercover_api.models import Plans, Status
from undercover_context import files as context

log = logging.getLogger(__name__)

CLAIM_FIELDS = (
    "claim_id",
    "policy_id",
    "customer_id",
    "claim_type",
    "submitted_on",
    "incident_date",
    "incident_location",
    "summary",
    "story",
    "items",
    "amount_claimed",
    "documents",
)


def read(folder: Path, name: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], json.loads((folder / name).read_text(encoding="utf-8")))


def is_seeded(db: Connection) -> bool:
    return bool(db.execute(select(func.count()).select_from(claims)).scalar_one())


def seed(db: Connection, data: Path) -> None:
    """Load the records into an empty database."""
    company = cast(dict[str, Any], json.loads((data / "company.json").read_text(encoding="utf-8")))
    every_customer = read(data, "customers.json") + read(data / "security", "customers.json")
    every_policy = read(data, "policies.json") + read(data / "security", "policies.json")
    queue = read(data, "claims.json") + read(data / "security", "claims.json")

    db.execute(
        insert(customers),
        [
            {
                "customer_id": c["customer_id"],
                "name": c["name"],
                "email": str(c["email"]).lower(),
                "record": c,
            }
            for c in every_customer
        ],
    )
    db.execute(
        insert(policies),
        [
            {"policy_id": p["policy_id"], "customer_id": p["customer_id"], "record": p}
            for p in every_policy
        ],
    )
    db.execute(
        insert(handlers),
        [
            {k: h[k] for k in ("handler_id", "name", "role", "email", "can_approve_over_limit")}
            for h in read(data, "handlers.json")
        ],
    )
    db.execute(
        insert(claims),
        [
            {k: c[k] for k in CLAIM_FIELDS}
            | {"status": Status.WAITING, "attempts": 0, "source": "seeded"}
            for c in queue
        ],
    )
    db.execute(
        insert(settings).values(
            key="approval_limit",
            value=float(company["payout_approval_limit"]),
            changed_by="Seeding",
            changed_at=now(),
        )
    )
    plans = Plans.model_validate(
        {k: context.FILES[context.PLANS][k] for k in ("plans", "deductible_applies_to", "add_ons")}
    )
    db.execute(
        insert(reference),
        [
            {"key": "plans", "value": plans.model_dump()},
            {"key": "claims_manual_version", "value": context.DOCUMENTS["claims_manual"].version},
            {"key": "policy_wording_version", "value": context.DOCUMENTS["policy_wording"].version},
        ],
    )


LABEL_SETS = (
    ("evaluation", "claims.json", "evals/decisions.json"),
    ("held_out", "evals/held_out_claims.json", "evals/held_out_decisions.json"),
)


def seed_labels(db: Connection, data: Path) -> None:
    """Load the two labelled sets for evaluations, once."""
    if db.execute(select(func.count()).select_from(labelled_claims)).scalar_one():
        return
    rows: list[dict[str, Any]] = []
    for label_set, claims_file, decisions_file in LABEL_SETS:
        if not (data / decisions_file).exists():
            log.warning("no %s labels in %s; evaluations of that set are off", label_set, data)
            continue
        found = {c["claim_id"]: c for c in read(data, claims_file)}
        for label in read(data, decisions_file):
            claim = found[label["claim_id"]]
            rows.append(
                {
                    "claim_id": label["claim_id"],
                    "label_set": label_set,
                    "tiny": bool(label.get("tiny")),
                    "claim": {k: claim[k] for k in CLAIM_FIELDS},
                    "label": {k: label[k] for k in ("decision", "payout", "reason", "calculation")},
                }
            )
    if rows:
        db.execute(insert(labelled_claims), rows)


def seed_engineers(db: Connection, data: Path) -> None:
    """Load the AI engineers, adding any new one and updating any changed one by id, even in a
    database seeded before they existed."""
    for engineer in read(data, "engineers.json"):
        found = db.execute(
            update(engineers)
            .where(engineers.c.engineer_id == engineer["engineer_id"])
            .values(**engineer)
        )
        if found.rowcount == 0:
            db.execute(insert(engineers).values(**engineer))


def seed_if_empty(engine: Engine, data: Path) -> bool:
    """Seed the database unless it already holds claims. Says whether it seeded."""
    with engine.begin() as db:
        seed_labels(db, data)
        seed_engineers(db, data)
        if is_seeded(db):
            return False
        seed(db, data)
        return True


if __name__ == "__main__":
    from undercover_api.logs import configure_logging
    from undercover_api.settings import get_settings

    configure_logging()
    settings_now = get_settings()
    seeded = seed_if_empty(make_engine(settings_now.database_url), settings_now.seed_data_dir)
    log.info("seeded" if seeded else "already seeded, left as it is")
