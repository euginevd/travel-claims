"""The one place the agent reads receipts into fields, so on AWS the claim checks and the claim
agent never read a customer's image and the input guardrail sees what a receipt says (decisions
48 and 49). Bedrock Data Automation with AWS's Receipt blueprint by default, which from Sydney may
process a receipt anywhere in its Asia Pacific profile; Amazon Textract's AnalyzeExpense, which
stays in the agent's Region, where receipts must stay in Australia. Locally there is no reader,
and receipts reach Claude as images."""

import json
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
    # Percent, or None when the reader gives none.
    confidence: float | None = None

    def shown(self) -> str:
        sure = "" if self.confidence is None else f" ({self.confidence:.0f}%)"
        return f"{self.name}: {self.value}{sure}"


@dataclass(frozen=True)
class ReadReceipt:
    """What a reader read from one receipt: its summary fields and its lines."""

    fields: tuple[Field, ...]
    lines: tuple[Field, ...]
    reader: str = "Amazon Textract"

    def as_text(self, number: int) -> str:
        """The receipt as the models read it, each value with the reader's confidence."""
        rows = [f"Receipt {number}, read from the image by {self.reader} (confidence in brackets):"]
        rows += [f.shown() for f in self.fields]
        if self.lines:
            rows.append("Lines:")
            rows += [f"- {f.shown()}" for f in self.lines]
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


class DataAutomationReader:
    """Bedrock Data Automation's synchronous call on each receipt, with a project using AWS's
    Receipt blueprint; None when it can't read one or the blueprint doesn't match, so the caller
    sends that receipt's image instead."""

    def __init__(
        self, project_arn: str, profile: str, region: str | None, client: Any = None
    ) -> None:
        # The profile's ARN is in this account and Region, as the project's is.
        _, _, _, project_region, account, _ = project_arn.split(":", 5)
        self._project = project_arn
        self._profile = (
            f"arn:aws:bedrock:{project_region}:{account}:data-automation-profile/{profile}"
        )
        if client is None:
            import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]
            from botocore.config import Config  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

            limits = Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2})
            client = cast(Any, boto3).client(
                "bedrock-data-automation-runtime", region_name=region, config=limits
            )
        self._client = client
        self._read: OrderedDict[str, ReadReceipt | None] = OrderedDict()

    def read(self, receipt_id: str, data: bytes, media_type: str) -> ReadReceipt | None:
        if receipt_id in self._read:
            self._read.move_to_end(receipt_id)
            return self._read[receipt_id]
        try:
            reply = self._client.invoke_data_automation(
                inputConfiguration={"bytes": data},
                dataAutomationConfiguration={
                    "dataAutomationProjectArn": self._project,
                    "stage": "LIVE",
                },
                dataAutomationProfileArn=self._profile,
            )
        except Exception as error:  # noqa: BLE001 - the image still reaches the claim's checks
            # Not kept: a throttle or a blip is tried again next time.
            log.warning(
                "receipt %s not read (%s): %s", receipt_id, media_type, type(error).__name__
            )
            return None
        read = read_segments(reply)
        self._read[receipt_id] = read
        if len(self._read) > CACHED:
            self._read.popitem(last=False)
        return read


def read_segments(reply: Json) -> ReadReceipt | None:
    """The first segment the Receipt blueprint matched, as fields and lines."""
    for segment in as_list(reply.get("outputSegments")):
        found = as_dict(segment)
        if found.get("customOutputStatus") != "MATCH" or not found.get("customOutput"):
            continue
        try:
            output: object = json.loads(str(found["customOutput"]))
        except ValueError:
            continue
        read = read_custom_output(as_dict(output))
        if read is not None:
            return read
    return None


def read_custom_output(output: Json) -> ReadReceipt | None:
    """A blueprint's result as fields and lines, whatever the blueprint names them: each value
    with the confidence its explainability gives (0 to 1, shown as percent)."""
    result = as_dict(output.get("inference_result"))
    explained = as_dict((as_list(output.get("explainability_info")) or [{}])[0])
    fields: list[Field] = []
    lines: list[Field] = []
    for key, value in result.items():
        about: object = explained.get(key)
        items, mapping = as_list(value), as_dict(value)
        if items:
            for index, item in enumerate(items):
                line = line_from(index, item, about)
                if line is not None and len(lines) < MAX_LINES:
                    lines.append(line)
        elif mapping:
            nested = as_dict(about)
            fields += [
                Field(f"{label(key)} {label(k)}", str(v), percent(nested.get(k)))
                for k, v in mapping.items()
                if present(v)
            ]
        elif not isinstance(value, list | dict) and present(value):
            fields.append(Field(label(key), str(value), percent(about)))
    if not fields and not lines:
        return None
    return ReadReceipt(tuple(fields), tuple(lines), "Amazon Bedrock Data Automation")


def line_from(index: int, item: object, about: object) -> Field | None:
    """One list item, such as a line of the receipt, with the lowest confidence of its parts."""
    parts_of = as_dict(item)
    if not any(present(v) for v in parts_of.values()):
        return None
    parts = ", ".join(f"{label(k)} {v}" for k, v in parts_of.items() if present(v))
    explains = as_list(about)
    explained = as_dict(explains[index]) if index < len(explains) else {}
    sure = [p for v in explained.values() if (p := percent(v)) is not None]
    return Field(f"Item {index + 1}", parts, min(sure) if sure else None)


def as_dict(value: object) -> Json:
    return cast(Json, value) if isinstance(value, dict) else {}


def as_list(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def label(key: str) -> str:
    """merchant_name or MerchantName as Merchant name."""
    spaced = "".join(f" {c}" if c.isupper() else c for c in key).replace("_", " ").strip()
    return " ".join(spaced.split()).capitalize()


def present(value: object) -> bool:
    return value is not None and str(value).strip() != ""


def percent(about: object) -> float | None:
    confidence = as_dict(about).get("confidence")
    return float(confidence) * 100 if isinstance(confidence, int | float) else None


def reader_for(
    kind: str, project_arn: str | None, profile: str, region: str | None
) -> ReceiptReader | None:
    """The reader the settings name, or none (locally, or Data Automation with no project)."""
    if kind == "textract":
        return TextractReader(region)
    if kind == "data-automation" and project_arn:
        return DataAutomationReader(project_arn, profile, region)
    return None
