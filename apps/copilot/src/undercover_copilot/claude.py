"""The one place the Copilot reaches Claude."""

from typing import Any, Protocol

import anthropic
from anthropic.lib.bedrock import AnthropicBedrock
from anthropic.types import Message

from undercover_copilot.settings import Settings

Json = dict[str, Any]


class Claude(Protocol):
    """What the Copilot needs from Claude; tests stand in a stub."""

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> Message: ...


def claude_client(settings: Settings) -> anthropic.Anthropic | AnthropicBedrock:
    """Claude through the Anthropic API in the user's workspace, or through Bedrock (tier 2)."""
    if settings.model_provider == "bedrock":
        return AnthropicBedrock(
            aws_region=settings.aws_region,
            timeout=settings.model_timeout_seconds,
            max_retries=settings.model_retries,
        )
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
    return anthropic.Anthropic(
        api_key=key,
        default_headers={"anthropic-workspace-id": settings.anthropic_workspace_id or ""},
        timeout=settings.model_timeout_seconds,
        max_retries=settings.model_retries,
    )


class AnthropicClaude:
    """Claude through the Anthropic API or Bedrock, as the settings say."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = claude_client(settings)

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> Message:
        """One turn: the stable instructions and tools are cached."""
        return self._client.messages.create(
            model=self._settings.copilot_model,
            max_tokens=self._settings.copilot_max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=tools,  # pyright: ignore[reportArgumentType] - plain dicts the API accepts
            messages=messages,  # pyright: ignore[reportArgumentType]
            thinking={"type": "adaptive"},
            output_config={"effort": "low"},
            cache_control={"type": "ephemeral"},
        )
