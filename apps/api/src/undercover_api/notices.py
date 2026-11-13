"""The messages we send customers about their claims, by email and text. Locally the notices
table is the outbox; in the cloud a sender delivers each row. Every message is written here,
from the claim's customer-facing status, never from a handler's or the agent's own words."""

import logging

from sqlalchemy import Connection, RowMapping, insert, select

from undercover_api.db import customers, notices, now, payments

log = logging.getLogger(__name__)

EMAIL = "email"
SMS = "sms"


def first_name(db: Connection, customer_id: str) -> str:
    name = db.execute(
        select(customers.c.name).where(customers.c.customer_id == customer_id)
    ).scalar_one_or_none()
    return (name or "there").split()[0]


def texts_wanted(db: Connection, customer_id: str) -> bool:
    """Whether the customer wants updates by text; emails about a claim always go."""
    record: dict[str, object] | None = db.execute(
        select(customers.c.record).where(customers.c.customer_id == customer_id)
    ).scalar_one_or_none()
    return bool((record or {}).get("text_updates", True))


def send(  # noqa: PLR0913, PLR0917 - one message's parts
    db: Connection,
    customer_id: str,
    claim_id: str | None,
    channel: str,
    subject: str,
    body: str,
    status: str | None = None,
) -> None:
    if channel == SMS and not texts_wanted(db, customer_id):
        return
    db.execute(
        insert(notices).values(
            customer_id=customer_id,
            claim_id=claim_id,
            channel=channel,
            subject=subject,
            body=body,
            status=status,
            sent_at=now(),
        )
    )
    log.info("claim %s: %s notice sent (%s)", claim_id, channel, subject)


def last_announced(db: Connection, claim_id: str) -> str | None:
    return db.execute(
        select(notices.c.status)
        .where(notices.c.claim_id == claim_id, notices.c.status.is_not(None))
        .order_by(notices.c.notice_id.desc())
        .limit(1)
    ).scalar_one_or_none()


def paid_message(db: Connection, claim_id: str) -> str:
    row = db.execute(
        select(payments.c.amount, payments.c.paid_to).where(payments.c.claim_id == claim_id)
    ).first()
    if row is None:
        return "Your payment is on its way."
    where = f" to your {row.paid_to}" if row.paid_to else ""
    return f"We've sent ${row.amount:,.2f}{where}."


def announce(db: Connection, row: RowMapping) -> None:
    """Tell the claim's customer when its customer-facing status changes to one worth a
    message: received, with a handler, declined or paid. Each status is told once."""
    from undercover_api.portal import plain_status  # noqa: PLC0415 - portal imports claims

    if row["source"] == "evaluation":
        return
    status = plain_status(db, row)
    if status not in {"received", "with_a_handler", "declined", "paid"}:
        return
    claim_id = row["claim_id"]
    if last_announced(db, claim_id) == status:
        return
    name = first_name(db, row["customer_id"])
    customer_id = row["customer_id"]
    match status:
        case "received":
            send(
                db,
                customer_id,
                claim_id,
                EMAIL,
                f"We've got your claim {claim_id}",
                f"Thanks, {name}. Your claim number is {claim_id}. We'll start on it shortly, "
                "and you can follow it any time under Claims.",
                status,
            )
            send(
                db,
                customer_id,
                claim_id,
                SMS,
                f"Claim {claim_id} received",
                f"UnderCover: we've got your claim {claim_id}. We'll text you when it moves on.",
            )
        case "with_a_handler":
            send(
                db,
                customer_id,
                claim_id,
                EMAIL,
                f"A claims handler is looking at {claim_id}",
                f"Hi {name}, a claims handler will look at your claim {claim_id} personally. "
                "If we need anything from you, it will be listed on your claim.",
                status,
            )
        case "declined":
            send(
                db,
                customer_id,
                claim_id,
                EMAIL,
                f"A decision on your claim {claim_id}",
                f"Hi {name}, we've made a decision on your claim {claim_id}. The reason is on "
                "your claim, and you can ask a person to review it there.",
                status,
            )
        case _:
            message = paid_message(db, claim_id)
            send(
                db,
                customer_id,
                claim_id,
                EMAIL,
                f"Your claim {claim_id} is paid",
                f"Good news, {name}. Your claim {claim_id} is approved. {message}",
                status,
            )
            send(db, customer_id, claim_id, SMS, f"Claim {claim_id} paid", f"UnderCover: {message}")


def announce_requests(db: Connection, row: RowMapping, texts: list[str]) -> None:
    """Tell the customer what we need from them on a claim."""
    if row["source"] == "evaluation" or not texts:
        return
    claim_id = row["claim_id"]
    lines = "\n".join(f"- {text}" for text in texts)
    send(
        db,
        row["customer_id"],
        claim_id,
        EMAIL,
        f"We need something from you for {claim_id}",
        f"Hi {first_name(db, row['customer_id'])}, to finish your claim {claim_id} we need:\n"
        f"{lines}\nYou can send each one from your claim in My claims.",
    )
    send(
        db,
        row["customer_id"],
        claim_id,
        SMS,
        f"Claim {claim_id} needs something",
        f"UnderCover: we need {len(texts)} {'thing' if len(texts) == 1 else 'things'} from you "
        f"to finish claim {claim_id}. "
        f"Open My claims to send {'it' if len(texts) == 1 else 'them'}.",
    )
