"""Stage 2's model switch: Bedrock when MODEL_PROVIDER=bedrock, the Anthropic API otherwise."""

import anthropic
import pytest
from anthropic.lib.bedrock import AnthropicBedrock
from pydantic import ValidationError

from undercover_agent.models import claude_client
from undercover_agent.settings import Settings

BASE = {"undercover_api_key": "k" * 40, "checkpoint_database_url": "postgresql://x"}


def test_the_anthropic_api_is_the_default_and_needs_its_key() -> None:
    settings = Settings(anthropic_api_key="sk-test", anthropic_workspace_id="w", **BASE)  # pyright: ignore[reportArgumentType]
    assert isinstance(claude_client(settings), anthropic.Anthropic)
    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(**BASE)  # pyright: ignore[reportArgumentType]


def test_bedrock_needs_no_anthropic_key() -> None:
    settings = Settings(model_provider="bedrock", aws_region="ap-southeast-2", **BASE)  # pyright: ignore[reportArgumentType]
    assert isinstance(claude_client(settings), AnthropicBedrock)
