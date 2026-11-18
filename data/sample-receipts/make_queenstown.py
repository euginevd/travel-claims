"""Two sample documents for Oliver's Queenstown trip: a store receipt and the airline's delayed
baggage report. Fictional businesses only.

Run from the repo root:
uv run --with pillow==12.0.0 python data/sample-receipts/make_queenstown.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
INK = (24, 24, 24)
GREY = (110, 110, 110)


def page(lines, size=(720, 980), title_size=30):
    image = Image.new("RGB", size, (252, 251, 248))
    draw = ImageDraw.Draw(image)
    y = 40
    for kind, text in lines:
        font = ImageFont.load_default(
            size={"title": title_size, "body": 21, "small": 16, "total": 25}[kind]
        )
        colour = GREY if kind == "small" else INK
        left, _, right = text.rpartition("  ")
        amount = right.strip()
        if left.strip() and amount.replace(".", "").replace(",", "").isdigit():
            draw.text((48, y), left.strip(), fill=colour, font=font)
            draw.text((560, y), amount, fill=colour, font=font, anchor="ra")
        else:
            draw.text((48, y), text, fill=colour, font=font)
        y += {"title": 46, "body": 32, "small": 26, "total": 40}[kind]
    return image


receipt = page(
    [
        ("title", "REMARKABLES OUTDOOR CO."),
        ("small", "34 Shotover Street, Queenstown 9300, New Zealand"),
        ("small", "GST 123-456-789"),
        ("body", ""),
        ("body", "Tax invoice  RO-20611"),
        ("body", "6 Nov 2026   16:42"),
        ("body", ""),
        ("body", "Thermal base layer set         89.00"),
        ("body", "Fleece jacket                 149.00"),
        ("body", "Hiking socks, 3 pack           29.00"),
        ("body", "Toiletries kit                 34.50"),
        ("body", "-----------------------------------------------"),
        ("total", "TOTAL NZD                     301.50"),
        ("small", "Includes GST 39.33"),
        ("body", ""),
        ("body", "VISA ****  4417      APPROVED"),
        ("small", "Customer: Oliver Grant"),
        ("small", "Thank you. Enjoy the mountains."),
    ]
)
receipt.save(OUT / "05-queenstown-clothes-bag-delayed.png")

report = page(
    [
        ("title", "SOUTHERN ALPS AIR"),
        ("small", "Property Irregularity Report (delayed baggage)"),
        ("body", ""),
        ("body", "File reference   ZQN-SA-77812"),
        ("body", "Passenger        GRANT / OLIVER MR"),
        ("body", "Flight           SA 418  AKL-ZQN"),
        ("body", "Arrived          5 Nov 2026  13:05"),
        ("body", "Bag tag          SA 604117"),
        ("body", "Description      Black hard-shell suitcase"),
        ("body", ""),
        ("body", "Status: bag did not arrive with the flight."),
        ("body", "Delivered to hotel 7 Nov 2026 10:20"),
        ("body", "(about 45 hours after arrival)."),
        ("body", ""),
        ("body", "Interim payment by the airline:  NIL"),
        ("body", ""),
        ("small", "Issued at Queenstown Airport, 5 Nov 2026, by agent K. Moana"),
    ]
)
report.save(OUT / "06-queenstown-airline-delay-report.png")
print("written")
