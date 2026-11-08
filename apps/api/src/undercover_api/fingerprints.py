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


def distance(first: str, second: str) -> int:
    """How many bits two perceptual hashes differ in."""
    return (int(first, 16) ^ int(second, 16)).bit_count()
