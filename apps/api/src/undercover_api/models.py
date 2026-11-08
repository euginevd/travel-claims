"""What the api takes in and gives back. Every request is checked against these at the door."""

from enum import StrEnum
from typing import Annotated, Literal

from fastapi import Path
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, computed_field

NOTE_LENGTH = 1000
# Who made a decision: the server names the maker, never the caller.
SCREENING_MAKER = "Hidden-instruction check"
# The largest value the model-call cost column, Numeric(12, 6), holds.
MAX_COST = 999_999.999999
MAX_INT = 2**31 - 1


def to_the_cent(amount: float) -> float:
    """Round an amount of money to the cent."""
    return round(amount, 2)


Dollars = Annotated[float, AfterValidator(to_the_cent)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ThreadId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# Every claim id in a path, checked before anything reads the database.
ClaimId = Annotated[str, Path(pattern=r"^CLM-\d{1,10}$")]


class Strict(BaseModel):
    """A request model that refuses fields it doesn't know."""

    model_config = ConfigDict(extra="forbid")


class Status(StrEnum):
    """Where a claim stands."""

    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    WAITING_FOR_SIGN_OFF = "waiting_for_sign_off"
    SENT_BACK = "sent_back"
    DECIDED = "decided"
    LEFT_FOR_HANDLER = "left_for_handler"


class DecisionKind(StrEnum):
    APPROVE = "approve"
    DECLINE = "decline"
    REFER = "refer"


StepKind = Literal[
    "screening", "tool_call", "tool_result", "message", "lookup", "refusal", "error", "sent_back"
]
Benefit = Literal[
    "trip_cancellation",
    "trip_interruption",
    "trip_delay",
    "baggage_delay",
    "baggage",
    "passport",
    "emergency_medical",
]
LineKind = Literal["item", "electronics", "cash", "expense", "hotel", "meals_without_receipts"]


# --- Records ---


class Item(BaseModel):
    description: str
    category: str
    amount: float


class Document(BaseModel):
    name: str
    type: str
    content: str


class CalculationStep(BaseModel):
    step: str
    amount: float


class Calculation(BaseModel):
    lines: list[CalculationStep]
    payout: float


class Decision(BaseModel):
    """A decision as claims manual section 14 records it."""

    decision: DecisionKind
    payout: float
    calculation: Calculation | None
    section: str
    reason: str
    decided_by: str
    decided_at: str
    manual_version: str
    approval_limit: float
    hold_reason: str | None
    signed_off_by: str | None
    signed_off_at: str | None

    @computed_field
    @property
    def by_screening(self) -> bool:
        """Whether the hidden-instruction check made this decision, not the claim agent."""
        return self.decided_by == SCREENING_MAKER


class Payment(BaseModel):
    amount: float
    paid_at: str
    signed_off_by: str | None


class SentBackDecision(BaseModel):
    """A decision a senior handler sent back to the agent, with their note."""

    decision: Decision
    note: str
    sent_back_by: str
    sent_back_at: str


class Receipt(BaseModel):
    """A receipt's metadata; its bytes come from its own route."""

    receipt_id: str
    media_type: str
    size: int
    uploaded_at: str


class ClaimSummary(BaseModel):
    claim_id: str
    customer_name: str
    plan: str
    claim_type: str
    summary: str
    amount_claimed: float
    submitted_on: str
    status: Status
    decision: DecisionKind | None
    payout: float | None


class Claim(BaseModel):
    claim_id: str
    policy_id: str
    customer_id: str
    customer_name: str
    claim_type: str
    submitted_on: str
    incident_date: str
    incident_location: str
    summary: str
    story: str
    items: list[Item]
    amount_claimed: float
    documents: list[Document]
    status: Status
    thread_id: str | None
    attempts: int
    policy: Policy
    approval_limit: float
    decision: Decision | None
    payment: Payment | None
    sent_back_decisions: list[SentBackDecision]
    receipts: list[Receipt]


class Trip(BaseModel):
    destination: str
    departs_on: str
    returns_on: str
    trip_cost: float


class Policy(BaseModel):
    policy_id: str
    customer_id: str
    plan: str
    add_ons: list[str]
    purchased_on: str
    sold_through: str
    trip: Trip
    travelers: list[str]
    status: str


class PreviousClaim(BaseModel):
    claim_id: str
    filed_on: str
    incident_date: str
    claim_type: str
    summary: str
    outcome: str
    amount_paid: float


class Handler(BaseModel):
    handler_id: str
    name: str
    role: str
    email: str
    can_approve_over_limit: bool


class Source(Strict):
    """A context file a lookup's answer came from."""

    file: ShortText
    system: ShortText
    owner: ShortText
    reviewed: ShortText


class NewStep(BaseModel):
    """A step to add to a claim, from the agent or the api itself."""

    thread_id: str | None
    kind: StepKind
    content: str
    sources: list[Source]


class Step(BaseModel):
    step_id: int
    thread_id: str | None
    kind: StepKind
    content: str
    sources: list[Source]
    created_at: str


# --- Plans and payouts ---


class Plan(BaseModel):
    plan: str
    name: str
    trip_cancellation_max: float
    trip_delay_waiting_hours: int
    trip_delay_max: float
    baggage_delay_waiting_hours: int
    baggage_delay_max: float
    baggage_max: float
    per_item_limit: float
    passport_max: float
    emergency_medical_max: float
    deductible: float


class AddOn(BaseModel):
    add_on: str
    name: str
    effect: str
    electronics_per_item_limit: float | None = None


class Plans(BaseModel):
    plans: list[Plan]
    deductible_applies_to: list[Benefit]
    add_ons: list[AddOn]


class Line(Strict):
    description: ShortText
    amount: float = Field(ge=0, le=1_000_000, description="The total claimed, before limits")
    quantity: int = Field(ge=1, le=1000, description="How many separate items")
    kind: LineKind
    nights: int = Field(ge=0, le=365, description="For a hotel, and 0 otherwise")
    hours: float = Field(ge=0, le=24 * 365, description="For meals without receipts, else 0")


class PayoutRequest(Strict):
    benefit: Benefit
    lines: list[Line] = Field(max_length=100, description="The covered lines only")
    paid_by_others: float = Field(ge=0, le=1_000_000, description="Paid or refunded by others")


class Payout(BaseModel):
    calculation: list[CalculationStep]
    payout: float
    needs_sign_off: bool


# --- Requests ---


class StartRequest(Strict):
    thread_id: ThreadId


class DecisionRequest(Strict):
    """A decision to record, which claims manual section 14 checks."""

    decision: DecisionKind
    payout: Dollars = Field(ge=0, description="In US dollars, 0 for a decline or referral")
    section: str = Field(max_length=500, description="The sections relied on")
    reason: str = Field(max_length=4000, description="Two or three sentences for a colleague")
    maker: Literal["claim_agent", "hidden_instruction_check"] = Field(
        description="Which part of the agent decided; the api names it on the record"
    )


class PaymentRequest(Strict):
    amount: Dollars = Field(gt=0, description="The approved payout in US dollars")


class HoldRequest(Strict):
    reason: Text


class SendBackRequest(Strict):
    note: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NOTE_LENGTH)
    ] = Field(description="What the agent should look at again")


class StepRequest(Strict):
    thread_id: ThreadId | None
    kind: Literal["screening", "tool_call", "tool_result", "message", "lookup", "refusal", "error"]
    content: Annotated[str, StringConstraints(min_length=1, max_length=20_000)]
    sources: list[Source] = Field(max_length=20)


class ModelCallRequest(Strict):
    thread_id: ThreadId | None
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    input_tokens: int = Field(ge=0, le=MAX_INT)
    output_tokens: int = Field(ge=0, le=MAX_INT)
    cost: float = Field(ge=0, le=MAX_COST, allow_inf_nan=False, description="In US dollars")


class Customer(BaseModel):
    customer_id: str
    name: str
    email: str


class SignInRequest(Strict):
    role: Literal["handler", "customer"] = "handler"
    email: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")
    ]
    password: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SignIn(BaseModel):
    id_token: str
    expires_in: int


# --- Receipts and the customers' portal ---

ClaimType = Literal[
    "trip_cancellation",
    "trip_interruption",
    "trip_delay",
    "baggage_delay",
    "baggage",
    "passport",
    "emergency_medical",
]
ItemCategory = Literal[
    "accommodation",
    "clothing",
    "document_fees",
    "electronics",
    "luggage",
    "meals",
    "medical",
    "other",
    "personal_item",
    "rebooking",
    "toiletries",
    "transport",
    "trip_cost",
]
# Every receipt id in a path: 32 hex characters, checked before anything reads the database.
ReceiptId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


class AgentReceipt(BaseModel):
    """A receipt as the agent reads it, its bytes in base64."""

    receipt_id: str
    media_type: str
    data: str


class NewItem(Strict):
    description: ShortText
    category: ItemCategory
    amount: float = Field(gt=0, le=100_000, allow_inf_nan=False)


class NewClaimRequest(Strict):
    policy_id: Annotated[str, StringConstraints(pattern=r"^POL-\d{1,10}$")]
    claim_type: ClaimType
    incident_date: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    incident_location: ShortText
    summary: ShortText
    story: Text
    items: list[NewItem] = Field(min_length=1, max_length=20)


class CustomerClaimSummary(BaseModel):
    """A claim as its customer sees it in their list: where it stands, in plain words."""

    claim_id: str
    policy_id: str
    claim_type: str
    summary: str
    amount_claimed: float
    submitted_on: str
    status: str
    status_text: str


class CustomerClaim(CustomerClaimSummary):
    """One claim as its customer sees it: no steps, calculation, sources or handler notes."""

    incident_date: str
    incident_location: str
    story: str
    items: list[Item]
    outcome: DecisionKind | None
    reason: str | None
    paid: float | None
    paid_at: str | None
    receipts: list[Receipt]
    can_add_receipts: bool
