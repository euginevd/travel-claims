"""Tier 2's model switch: Bedrock when MODEL_PROVIDER=bedrock, the Anthropic API otherwise."""

import os

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


def test_app_secret_fills_in_only_what_the_environment_lacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from undercover_agent.settings import load_app_secret  # noqa: PLC0415

    monkeypatch.setenv("APP_SECRET", "travel-claims/dev/app")
    monkeypatch.setenv("KEPT", "from-environment")
    monkeypatch.delenv("FILLED", raising=False)
    asked: list[str] = []

    def fetch(name: str) -> str:
        asked.append(name)
        return '{"KEPT": "from-secret", "FILLED": "from-secret"}'

    load_app_secret(fetch)
    assert asked == ["travel-claims/dev/app"]
    assert (os.environ["KEPT"], os.environ["FILLED"]) == ("from-environment", "from-secret")


def test_without_app_secret_nothing_is_fetched(monkeypatch: pytest.MonkeyPatch) -> None:
    from undercover_agent.settings import load_app_secret  # noqa: PLC0415

    monkeypatch.delenv("APP_SECRET", raising=False)
    load_app_secret(lambda name: pytest.fail(f"fetched {name}"))


def test_bedrock_model_ids_are_priced_like_their_model() -> None:
    from undercover_agent.models import PRICES, price_for  # noqa: PLC0415

    assert price_for("au.anthropic.claude-sonnet-5-5-v1:0") == PRICES["claude-sonnet-5-5"]
    assert price_for("claude-haiku-5-5") == PRICES["claude-haiku-5-5"]
    assert price_for("someone-elses-model") == (0.0, 0.0, 0.0, 0.0)


def test_no_guardrail_header_rides_on_claudes_calls() -> None:
    # The guardrail screens customer text only (the agent's screen), never a whole context.
    settings = Settings(
        model_provider="bedrock",
        aws_region="ap-southeast-2",
        bedrock_guardrail_id="gr-1",
        **BASE,  # pyright: ignore[reportArgumentType]
    )
    assert "X-Amzn-Bedrock-GuardrailIdentifier" not in claude_client(settings).default_headers


def test_an_unfilled_secret_placeholder_fails_at_start() -> None:
    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(anthropic_api_key="SET-ME: a key", anthropic_workspace_id="w", **BASE)  # pyright: ignore[reportArgumentType]
    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(anthropic_api_key="sk-test", anthropic_workspace_id="SET-ME: its id", **BASE)  # pyright: ignore[reportArgumentType]


def test_a_configurations_model_is_named_as_the_provider_names_it() -> None:
    from undercover_agent.models import provider_model  # noqa: PLC0415

    api = Settings(anthropic_api_key="sk-test", anthropic_workspace_id="w", **BASE)  # pyright: ignore[reportArgumentType]
    bedrock = Settings(
        model_provider="bedrock",
        aws_region="ap-southeast-2",
        claim_model="au.anthropic.claude-sonnet-5-5-v1:0",
        screening_model="au.anthropic.claude-haiku-5-5-v1:0",
        **BASE,  # pyright: ignore[reportArgumentType]
    )
    # A version saved on Bedrock works on the API, and one the improver proposed works on Bedrock.
    assert provider_model("au.anthropic.claude-sonnet-5-5-v1:0", api) == "claude-sonnet-5-5"
    assert provider_model("claude-haiku-5-5", api) == "claude-haiku-5-5"
    assert provider_model("claude-haiku-5-5", bedrock) == "au.anthropic.claude-haiku-5-5-v1:0"
    assert provider_model("claude-sonnet-5-5", bedrock) == "au.anthropic.claude-sonnet-5-5-v1:0"
    # A model with no configured profile is left as it is, for Bedrock to refuse plainly.
    assert provider_model("claude-opus-5-5", bedrock) == "claude-opus-5-5"


def test_the_first_configuration_holds_the_plain_name() -> None:
    from undercover_agent.models import plain_name  # noqa: PLC0415

    assert plain_name("au.anthropic.claude-sonnet-5-5-v1:0") == "claude-sonnet-5-5"
    assert plain_name("claude-haiku-5-5") == "claude-haiku-5-5"
    assert plain_name("au.anthropic.claude-sonnet-4-5-20250929-v1:0") == "claude-sonnet-4-5"
