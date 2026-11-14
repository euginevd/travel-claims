"""The models the claim agent may run on, in one list: their prices, efforts and what each is for.

Compare offers each of them; the improver keeps to the cheaper three. Prices are the Anthropic
API's per million tokens (Bedrock's are its own), used for estimates; what a call cost is worked
out by the agent from its usage."""

from dataclasses import dataclass
from typing import Literal

EFFORTS = ("low", "medium", "high", "xhigh", "max")
Model = Literal["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]
Effort = Literal["low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
    input_price: float
    output_price: float
    default_effort: str
    speed: str
    good_for: str
    may_decline: bool = False


MODELS_INFO: tuple[ModelInfo, ...] = (
    ModelInfo("claude-haiku-5-5", "Haiku 5.5", 0.10, 0.50, "medium", "Fastest", "Quick work"),
    ModelInfo("claude-sonnet-5-5", "Sonnet 5.5", 2.00, 10.00, "high", "Fast", "Everyday work"),
    ModelInfo("claude-opus-5-5", "Opus 5.5", 4.00, 20.00, "medium", "Medium", "Hard reasoning"),
    ModelInfo(
        "claude-fable-5-2", "Fable 5.2", 8.00, 40.00, "high", "Slowest", "Most capable", True
    ),
)
BY_ID = {info.id: info for info in MODELS_INFO}

# The improver chooses from these: Fable's price is a person's choice, made in Compare.
IMPROVER_MODELS = ("claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5")
IMPROVER_EFFORTS = ("low", "medium", "high")


def label_of(model: str) -> str:
    info = BY_ID.get(model)
    return info.label if info else model


def offered(setting: str) -> set[str]:
    """The models this deployment can call: every one locally; on AWS, those with an Australian
    inference profile, named in the setting."""
    named = {name.strip() for name in setting.split(",") if name.strip()}
    return named & set(BY_ID) if named else set(BY_ID)
