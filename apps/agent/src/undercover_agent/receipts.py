"""The one place the agent reads receipts into fields, with Amazon Textract's AnalyzeExpense,
so on AWS no model reads a customer's image and the input guardrail sees what a receipt says
(decision 48). Textract runs in the agent's Region, so a receipt never leaves it. Locally there
is no reader, and receipts reach Claude as images."""

import logging
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Protocol, cast

log = logging.getLogger(__name__)
Json = dict[str, Any]

# Textract's names for the summary fields worth showing, in the order they're shown.
FIELDS = {
    "VENDOR_NAME": "Merchant",
    "VENDOR_ADDRESS": "Address",
    "INVOICE_RECEIPT_DATE": "Date",
    "INVOICE_RECEIPT_ID": "Receipt number",
    "SUBTOTAL": "Subtotal",
    "TAX": "Tax",
    "TOTAL": "Total",
    "AMOUNT_PAID": "Amount paid",
}
# Kept short: a receipt is evidence for a claim, not a document to read in full.
MAX_LINES = 30
MAX_TEXT = 2000
# Receipts read on this runtime, so a claim's checks and specialists read each one once.
CACHED = 128


@dataclass(frozen=True)
class Field:
    name: str
    value: str
    confidence: float


@dataclass(frozen=True)
class ReadReceipt:
    """What Textract read from one receipt: its summary fields and its lines."""

    fields: tuple[Field, ...]
    lines: tuple[Field, ...]

    def as_text(self, number: int) -> str:
        """The receipt as the models read it, each value with Textract's confidence."""
        rows = [
            f"Receipt {number}, read from the image by Amazon Textract (confidence in brackets):"
        ]
        rows += [f"{f.name}: {f.value} ({f.confidence:.0f}%)" for f in self.fields]
        if self.lines:
            rows.append("Lines:")
            rows += [f"- {f.name}: {f.value} ({f.confidence:.0f}%)" for f in self.lines]
        return "\n".join(rows)[:MAX_TEXT]


class ReceiptReader(Protocol):
    def read(self, receipt_id: str, data: bytes, media_type: str) -> ReadReceipt | None: ...


class TextractReader:
    """AnalyzeExpense on each receipt; None when it can't read one (a multi-page PDF, a blurred
    photo, Textract unavailable), so the caller sends that receipt's image instead."""

    def __init__(self, region: str | None, client: Any = None) -> None:
        if client is None:
            import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]
            from botocore.config import Config  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

            # Short limits: an unreachable Textract falls back to the image in seconds.
            limits = Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2})
            client = cast(Any, boto3).client("textract", region_name=region, config=limits)
        self._client = client
        self._read: OrderedDict[str, ReadReceipt | None] = OrderedDict()

    def read(self, receipt_id: str, data: bytes, media_type: str) -> ReadReceipt | None:
        if receipt_id in self._read:
            self._read.move_to_end(receipt_id)
            return self._read[receipt_id]
        try:
            reply = self._client.analyze_expense(Document={"Bytes": data})
        except Exception as error:  # noqa: BLE001 - the image still reaches the claim's checks
            # Not kept: a throttle or a blip is tried again next time.
            log.warning(
                "receipt %s not read (%s): %s", receipt_id, media_type, type(error).__name__
            )
            return None
        read = read_expense(reply)
        self._read[receipt_id] = read
        if len(self._read) > CACHED:
            self._read.popitem(last=False)
        return read


def read_expense(reply: Json) -> ReadReceipt | None:
    """The fields and lines of AnalyzeExpense's reply; None when it found neither."""
    fields: list[Field] = []
    lines: list[Field] = []
    for document in reply.get("ExpenseDocuments", []):
        found = {
            kind: field for field in document.get("SummaryFields", []) if (kind := type_of(field))
        }
        fields += [
            Field(name, value, confidence_of(found[kind]))
            for kind, name in FIELDS.items()
            if kind in found and (value := value_of(found[kind]))
        ]
        for group in document.get("LineItemGroups", []):
            for item in group.get("LineItems", []):
                line = line_of(item)
                if line is not None and len(lines) < MAX_LINES:
                    lines.append(line)
    if not fields and not lines:
        return None
    return ReadReceipt(tuple(fields), tuple(lines))


def type_of(field: Json) -> str:
    return str(field.get("Type", {}).get("Text", ""))


def value_of(field: Json) -> str:
    return " ".join(str(field.get("ValueDetection", {}).get("Text", "")).split())


def confidence_of(field: Json) -> float:
    return float(field.get("ValueDetection", {}).get("Confidence", 0.0))


def line_of(item: Json) -> Field | None:
    """One line item as its description and price, with the lower of their confidences."""
    parts = {type_of(f): f for f in item.get("LineItemExpenseFields", [])}
    item_field, price = parts.get("ITEM"), parts.get("PRICE")
    if item_field is None or price is None or not value_of(item_field) or not value_of(price):
        return None
    confidence = min(confidence_of(item_field), confidence_of(price))
    return Field(value_of(item_field), value_of(price), confidence)
