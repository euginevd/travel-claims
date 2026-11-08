"""The duplicate-receipt check: the same receipt on another claim is found by its bytes, or for
an image by how it looks, and only the other claim's id is given."""

import io

from api_helpers import AGENT, MAYA, sign_in
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from test_portal import make, upload

from undercover_api.fingerprints import distance, perceptual


def receipt_image(size: tuple[int, int], fmt: str, seed: int = 0) -> bytes:
    """A receipt-like picture: dark lines on paper, laid out by the seed."""
    image = Image.new("L", size, 240)
    draw = ImageDraw.Draw(image)
    width, height = size
    for line in range(12):
        top = int(height * (line + 1) / 14)
        length = int(width * (0.3 + ((line * 7 + seed * 5) % 10) / 15))
        draw.rectangle((width // 10, top, min(length, width - 4), top + height // 40), fill=20)
    out = io.BytesIO()
    image.save(out, format=fmt)
    return out.getvalue()


def duplicates(client: TestClient, claim_id: str) -> list[dict[str, object]]:
    response = client.get(f"/api/agent/claims/{claim_id}/duplicates", headers=AGENT)
    assert response.status_code == 200, response.text
    return list(response.json())


def test_the_same_receipt_on_another_claim_is_found(client: TestClient) -> None:
    maya = sign_in(client, MAYA, role="customer")
    original = receipt_image((600, 900), "PNG")
    first = make(client, maya).json()["claim_id"]
    upload(client, maya, first, original)
    second = make(client, maya).json()["claim_id"]
    upload(client, maya, second, original)

    [found] = duplicates(client, second)
    assert found == {"receipt": 1, "matches": [{"claim_id": first, "match": "exact"}]}


def test_a_resized_copy_of_an_image_still_matches() -> None:
    original = perceptual(receipt_image((600, 900), "PNG"), "image/png")
    smaller = perceptual(receipt_image((300, 450), "JPEG"), "image/jpeg")
    other = perceptual(receipt_image((600, 900), "PNG", seed=3), "image/png")
    assert original
    assert smaller
    assert other
    assert distance(original, smaller) <= 6
    assert distance(original, other) > 6


def test_a_claim_with_its_own_receipts_finds_nothing(client: TestClient) -> None:
    maya = sign_in(client, MAYA, role="customer")
    claim_id = make(client, maya).json()["claim_id"]
    upload(client, maya, claim_id, receipt_image((400, 600), "PNG", seed=9))
    assert duplicates(client, claim_id) == [{"receipt": 1, "matches": []}]


def test_a_pdf_has_no_perceptual_hash() -> None:
    assert perceptual(b"%PDF-1.7\n", "application/pdf") is None
