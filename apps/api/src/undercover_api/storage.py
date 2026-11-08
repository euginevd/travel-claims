"""Where receipts are kept: one place, so stage 2 swaps the folder for a private S3 bucket.
Files are stored under random names, never the customer's own, and read back by those names."""

import secrets
from pathlib import Path

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
