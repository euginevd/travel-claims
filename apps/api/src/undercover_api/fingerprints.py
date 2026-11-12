"""Fingerprints of a receipt, so the same receipt can be found on another claim: an exact hash
of its bytes, and for an image a perceptual hash that survives resizing and recompression."""

import hashlib
import io

from PIL import Image

# Receipts are at most 5 MB; refuse to decode anything that would unpack to more pixels.
Image.MAX_IMAGE_PIXELS = 40_000_000
HASH_SIZE = 8
# Two images whose hashes differ in this many bits or fewer are taken as the same receipt.
NEAR = 6


def exact(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def perceptual(content: bytes, media_type: str) -> str | None:
    """A 64-bit difference hash of an image, in hex, or None for a PDF or an unreadable one."""
    if not media_type.startswith("image/"):
        return None
    try:
        with Image.open(io.BytesIO(content)) as image:
            small = image.convert("L").resize((HASH_SIZE + 1, HASH_SIZE))  # pyright: ignore[reportUnknownMemberType] - Pillow types one overload loosely
            pixels = small.tobytes()
    except OSError, Image.DecompressionBombError, ValueError:
        return None
    bits = 0
    for row in range(HASH_SIZE):
        for column in range(HASH_SIZE):
            left = pixels[row * (HASH_SIZE + 1) + column]
            right = pixels[row * (HASH_SIZE + 1) + column + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


# A receipt photo smaller than this on either side can't be read, and the model refuses it.
MIN_IMAGE_SIDE = 100
TOO_SMALL = "This image is too small to read. Please upload a clear photo of the receipt."
DAMAGED = "This image can't be opened. Please upload a clear photo of the receipt."


def unreadable(content: bytes, media_type: str) -> str | None:
    """Why an image receipt can't be read, in the customer's words, or None when it can (a PDF
    is left to the model)."""
    if not media_type.startswith("image/"):
        return None
    try:
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
            image.verify()
    except OSError, Image.DecompressionBombError, ValueError, SyntaxError:
        return DAMAGED
    return TOO_SMALL if min(width, height) < MIN_IMAGE_SIDE else None


def distance(first: str, second: str) -> int:
    """How many bits two perceptual hashes differ in."""
    return (int(first, 16) ^ int(second, 16)).bit_count()
