"""Personal data in text, found in code (never by a model): card numbers that pass the Luhn
check, email addresses, Australian phone numbers and tax file numbers. The output guard removes
them from what the agent writes; the engineers' trace masks them in what it shows."""

import re
from collections.abc import Callable

Check = tuple[str, re.Pattern[str], Callable[[str], bool]]


def luhn(digits: str) -> bool:
    """A payment card's check digit: true for real card numbers, false for most other runs."""
    numbers = [int(d) for d in digits if d.isdigit()]
    total = 0
    for index, number in enumerate(reversed(numbers)):
        doubled = number * 2 if index % 2 else number
        total += doubled - 9 if doubled > 9 else doubled  # noqa: PLR2004 - the Luhn rule
    return total % 10 == 0


def always(_: str) -> bool:
    return True


CHECKS: tuple[Check, ...] = (
    ("card number", re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), luhn),
    ("email address", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), always),
    ("phone number", re.compile(r"(?<![\d$.])(?:\+?61[ -]?|0)[2-478](?:[ -]?\d){8}\b"), always),
    ("tax file number", re.compile(r"(?<![\d$.])\d{3}[ -]\d{3}[ -]\d{3}\b"), always),
)


def scrub(text: str) -> tuple[str, list[str]]:
    """The text with personal data replaced by its kind, and the kinds found, in order."""
    found: list[str] = []
    for kind, pattern, confirm in CHECKS:

        def replace(
            match: re.Match[str], kind: str = kind, confirm: Callable[[str], bool] = confirm
        ) -> str:
            if not confirm(match.group(0)):
                return match.group(0)
            if kind not in found:
                found.append(kind)
            return f"[{kind} removed]"

        text = pattern.sub(replace, text)
    return text, found
