"""A stand-in for a flight-status service: the flights on each policy's trip, as booked and as
flown. In the cloud a real feed takes its place; nothing else changes."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Flight:
    flight_id: str
    policy_id: str
    flight: str
    route: str
    scheduled: str
    actual: str

    @property
    def delay_minutes(self) -> int:
        late = datetime.fromisoformat(self.actual) - datetime.fromisoformat(self.scheduled)
        return max(0, int(late.total_seconds() // 60))

    @property
    def date(self) -> str:
        return self.scheduled[:10]


FLIGHTS = (
    Flight(
        "FL-2005-1",
        "POL-2005",
        "KQ 2",
        "New York (JFK) to Nairobi (NBO)",
        "2026-06-28T13:05:00-04:00",
        "2026-06-28T13:40:00-04:00",
    ),
    Flight(
        "FL-2005-2",
        "POL-2005",
        "KQ 3",
        "Nairobi (NBO) to New York (JFK)",
        "2026-07-09T23:55:00+03:00",
        "2026-07-10T01:50:00+03:00",
    ),
    Flight(
        "FL-2006-1",
        "POL-2006",
        "UL 504",
        "London (LHR) to Colombo (CMB)",
        "2026-08-08T21:10:00+01:00",
        "2026-08-08T21:25:00+01:00",
    ),
    Flight(
        "FL-2006-2",
        "POL-2006",
        "UL 503",
        "Colombo (CMB) to London (LHR)",
        "2026-08-20T09:40:00+05:30",
        "2026-08-20T14:20:00+05:30",
    ),
)


def flights_for(policy_id: str) -> list[Flight]:
    return [f for f in FLIGHTS if f.policy_id == policy_id]


def find_flight(flight_id: str) -> Flight | None:
    return next((f for f in FLIGHTS if f.flight_id == flight_id), None)


def delay_text(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    return f"{hours}h {mins:02d}m" if hours else f"{mins}m"
