"""The one place the Copilot reaches Claude."""

from typing import Any, Protocol

import anthropic
from anthropic.types import Message

from undercover_copilot.settings import Settings

Json = dict[str, Any]


class Claude(Protocol):
    """What the Copilot needs from Claude; tests stand in a stub."""

    def turn(self, system: str, tools: list[Json], messages: list[Json]) -> Message: ...


class AnthropicClaude:
    """Claude through the Anthropic API, in the user's workspace."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key.get_secret_value(),
            default_headers={"anthropic-workspace-id": settings.anthropic_workspace_id},
            timeout=settings.model_timeout_seconds,
            max_retries=settings.model_retries,
        )

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
