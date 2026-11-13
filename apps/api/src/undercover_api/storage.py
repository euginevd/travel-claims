"""Where receipts are kept: a folder locally, or a private S3 bucket when RECEIPTS_BUCKET is set
on AWS. Files are stored under random names, never the customer's own, and read back by
those names."""

import logging
import secrets
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger(__name__)

MAX_RECEIPT_BYTES = 5 * 1024 * 1024
MAX_RECEIPTS = 5
# A file's type comes from its first bytes, never from its name or the browser's word.
SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
)


def sniff(content: bytes) -> str | None:
    """The media type a file's first bytes show, if it's one the app accepts."""
    for signature, media_type in SIGNATURES:
        if content.startswith(signature):
            return media_type
    return None


class Receipts(Protocol):
    """Somewhere receipts are kept: a folder or a bucket."""

    def save(self, content: bytes) -> str: ...

    def read(self, name: str) -> bytes: ...

    def delete(self, name: str) -> None: ...


class ReceiptStore:
    """Receipts in a folder, each under a random 32-character hex name."""

    def __init__(self, folder: Path) -> None:
        self._folder = folder

    def save(self, content: bytes) -> str:
        """Keep a receipt and return its new name."""
        self._folder.mkdir(parents=True, exist_ok=True)
        name = secrets.token_hex(16)
        (self._folder / name).write_bytes(content)
        return name

    def read(self, name: str) -> bytes:
        return (self._folder / name).read_bytes()

    def delete(self, name: str) -> None:
        (self._folder / name).unlink(missing_ok=True)


class S3ReceiptStore:
    """Receipts in a private S3 bucket, under the same random names as the folder."""

    def __init__(self, bucket: str, client: Any) -> None:
        self._bucket = bucket
        self._client = client

    def save(self, content: bytes) -> str:
        name = secrets.token_hex(16)
        self._client.put_object(Bucket=self._bucket, Key=name, Body=content)
        return name

    def read(self, name: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=name)["Body"].read()

    def delete(self, name: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=name)


SAVED_RECEIPTS = "saved_receipts"


def keep_for_cleanup(db: Any, store: Receipts, content: bytes) -> str:
    """Save a receipt and note it for this request, so a rollback can remove it again."""
    name = store.save(content)
    db.info.setdefault(SAVED_RECEIPTS, []).append((store, name))
    return name


def remove_unsaved(db: Any) -> None:
    """Remove the files a rolled-back request saved, which no row points to. A file that can't
    be removed is logged rather than hiding the first error."""
    saved: list[tuple[Receipts, str]] = db.info.pop(SAVED_RECEIPTS, [])
    for store, name in saved:
        try:
            store.delete(name)
        except Exception:  # noqa: BLE001
            log.warning("receipt %s outlived a rolled-back request", name)
