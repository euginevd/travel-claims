"""Build the portal's airport list for the "Where?" suggestions.

Source: OurAirports (https://ourairports.com/data/), released into the public domain.
Keeps large and medium airports with an IATA code and scheduled service, and writes them
compactly to apps/portal/src/data/airports.json as {"countries": [names], "airports":
[[iata, name, city, country index]]}.

Usage: uv run python scripts/make-airports.py
"""

import csv
import io
import json
import re
import urllib.request
from pathlib import Path

BASE = "https://davidmegginson.github.io/ourairports-data/"
OUT = Path(__file__).resolve().parent.parent / "apps/portal/src/data/airports.json"
KEEP = {"large_airport", "medium_airport"}
IATA_LENGTH = 3
# A suburb in brackets after the city, as in "Sydney (Mascot)".
SUBURB = re.compile(r"\s*\(.*\)$")


def rows(name: str) -> list[dict[str, str]]:
    """Download one OurAirports CSV as rows."""
    url = BASE + name
    if not url.startswith("https://"):
        raise ValueError(f"Not an https URL: {url}")
    # The URL is the fixed OurAirports address plus a file name from this script, never user input.
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    with urllib.request.urlopen(url, timeout=60) as response:  # noqa: S310
        text = response.read().decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def main() -> None:
    countries = {row["code"]: row["name"] for row in rows("countries.csv")}
    airports = [
        {
            "iata": row["iata_code"].strip(),
            "name": row["name"].strip(),
            "city": SUBURB.sub("", row["municipality"].strip()),
            "country": countries.get(row["iso_country"], row["iso_country"]),
        }
        for row in rows("airports.csv")
        if row["type"] in KEEP
        and row["scheduled_service"] == "yes"
        and len(row["iata_code"].strip()) == IATA_LENGTH
        and row["municipality"].strip()
    ]
    airports.sort(key=lambda a: (a["city"], a["iata"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    names = sorted({a["country"] for a in airports})
    index = {name: i for i, name in enumerate(names)}
    compact = {
        "countries": names,
        "airports": [[a["iata"], a["name"], a["city"], index[a["country"]]] for a in airports],
    }
    text = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text, encoding="utf-8")
    print(f"{len(airports)} airports, {OUT.stat().st_size // 1024} KB -> {OUT}")


if __name__ == "__main__":
    main()
