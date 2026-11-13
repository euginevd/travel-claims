"""The audit log made tamper-evident: each entry is sealed once with a SHA-256 digest of what it
says, chained to the seal before it, in an append-only table.

Editing or deleting a sealed record afterwards (a switch's reason, an override, who added a
claim to the evaluation set) changes its digest or leaves its seal with nothing to match, and
re-sealing can't hide it: every seal after it carries the old chain. The control plane checks
the chain whenever the log is read and raises an alert if it's broken.

Entries are sealed when the log or the alerts are read, so a record changed before its first
seal isn't caught; the seals are only as safe as the database role that could rewrite them,
which is why on AWS this table would also be copied to write-once storage (decision 57)."""

import hashlib
import json
import logging
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel
from sqlalchemy import Connection, func, select

from undercover_api.db import audit_seals, insert_if_new, now

if TYPE_CHECKING:
    from undercover_api.assurance import AuditEntry

# Fields a version's entry may change later (its status, its reviewer), so its seal covers only
# what can't: which version, when it was made, and its label.
MUTABLE_KINDS = {"version"}


log = logging.getLogger(__name__)


class Anchor(Protocol):
    """Write-once storage for the seals: once written, a seal can't be changed or deleted."""

    def put(self, seq: int, record: dict[str, Any]) -> None: ...
    def chain_at(self, seq: int) -> str | None: ...


class S3Anchor:
    """Seals in an S3 bucket with Object Lock: its default retention makes each one write-once
    (governance mode in this prototype, so a teardown can still empty it)."""

    def __init__(self, bucket: str, client: Any) -> None:
        self._bucket = bucket
        self._s3 = client

    def put(self, seq: int, record: dict[str, Any]) -> None:
        self._s3.put_object(
            Bucket=self._bucket,
            Key=f"seals/{seq:08d}.json",
            Body=json.dumps(record).encode(),
            ContentType="application/json",
        )

    def chain_at(self, seq: int) -> str | None:
        try:
            found = self._s3.get_object(Bucket=self._bucket, Key=f"seals/{seq:08d}.json")
        except Exception:  # noqa: BLE001 - missing or unreadable: no copy to compare
            return None
        return str(json.loads(found["Body"].read())["chain"])


class ChainStatus(BaseModel):
    sealed: int
    intact: bool
    anchored: bool = False
    changed: list[str]
    missing: list[str]
    broken_at: int | None


def digest_of(entry: AuditEntry) -> str:
    """A SHA-256 of what the entry says, in a fixed order."""
    fields = {"ref": entry.ref, "at": entry.at, "kind": entry.kind, "label": entry.label}
    if entry.kind not in MUTABLE_KINDS:
        fields |= {
            "change": entry.change,
            "before": entry.before,
            "reason": entry.reason,
            "by": entry.by,
        }
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def link(previous: str, digest: str) -> str:
    return hashlib.sha256(f"{previous}{digest}".encode()).hexdigest()


def seal(db: Connection, entries: list[AuditEntry], anchor: Anchor | None = None) -> None:
    """Seal every entry not yet sealed, oldest first, each chained to the last seal."""
    sealed = set(db.execute(select(audit_seals.c.ref)).scalars())
    last = db.execute(
        select(audit_seals.c.seq, audit_seals.c.chain).order_by(audit_seals.c.seq.desc()).limit(1)
    ).first()
    seq, chain = (int(last[0]), str(last[1])) if last else (0, "")
    for entry in sorted(entries, key=lambda e: e.at):
        if entry.ref in sealed:
            continue
        digest = digest_of(entry)
        seq += 1
        chain = link(chain, digest)
        record = {
            "ref": entry.ref,
            "seq": seq,
            "digest": digest,
            "chain": chain,
            "sealed_at": now(),
        }
        if insert_if_new(db, audit_seals, **record) is not None and anchor is not None:
            try:
                anchor.put(seq, record)
            except Exception:  # noqa: BLE001 - the seal stands; the next check says it's not copied
                log.warning("audit seal %s couldn't be copied to write-once storage", seq)
        sealed.add(entry.ref)


def verify(db: Connection, entries: list[AuditEntry], anchor: Anchor | None = None) -> ChainStatus:
    """Recompute the chain and each sealed entry's digest against the records as they are now."""
    current = {entry.ref: digest_of(entry) for entry in entries}
    changed: list[str] = []
    missing: list[str] = []
    broken_at: int | None = None
    chain = ""
    for ref, seq, digest, stored in db.execute(
        select(
            audit_seals.c.ref, audit_seals.c.seq, audit_seals.c.digest, audit_seals.c.chain
        ).order_by(audit_seals.c.seq)
    ):
        chain = link(chain, str(digest))
        if broken_at is None and chain != stored:
            broken_at = int(seq)
        if ref not in current:
            missing.append(str(ref))
        elif current[ref] != digest:
            changed.append(str(ref))
    count = int(db.execute(select(func.count()).select_from(audit_seals)).scalar_one())
    # The write-once copy of the newest seal must match: rewriting the seals table shows here.
    anchored = False
    if anchor is not None and count:
        copy = anchor.chain_at(count)
        anchored = copy is not None
        if copy is not None and copy != chain and broken_at is None:
            broken_at = count
    return ChainStatus(
        sealed=count,
        intact=not changed and not missing and broken_at is None,
        anchored=anchored,
        changed=changed,
        missing=missing,
        broken_at=broken_at,
    )
