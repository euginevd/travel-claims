"""Tier 2's model switch: Bedrock when MODEL_PROVIDER=bedrock, the Anthropic API otherwise."""

import os

import anthropic
import pytest
from anthropic.lib.bedrock import AnthropicBedrock
from pydantic import ValidationError

from undercover_copilot.claude import claude_client
from undercover_copilot.settings import Settings, load_vaulted_key

BASE = {"checkpoint_database_url": "postgresql://x"}


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
    from undercover_copilot.settings import load_app_secret  # noqa: PLC0415

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
    from undercover_copilot.settings import load_app_secret  # noqa: PLC0415

    monkeypatch.delenv("APP_SECRET", raising=False)
    load_app_secret(lambda name: pytest.fail(f"fetched {name}"))


def test_no_guardrail_header_rides_on_claudes_calls() -> None:
    # The guardrail screens customer text only (the agent's screen), never a whole context.
    settings = Settings(
        model_provider="bedrock",
        aws_region="ap-southeast-2",
        **BASE,  # pyright: ignore[reportArgumentType]
    )
    assert "X-Amzn-Bedrock-GuardrailIdentifier" not in claude_client(settings).default_headers


def test_an_unfilled_secret_placeholder_fails_at_start() -> None:
    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(anthropic_api_key="SET-ME: a key", anthropic_workspace_id="w", **BASE)  # pyright: ignore[reportArgumentType]


def test_the_vaulted_key_is_fetched_only_with_a_provider_and_workload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_KEY_PROVIDER", raising=False)
    monkeypatch.setenv("WORKLOAD_NAME", "travel-claims-dev-app")
    load_vaulted_key(lambda workload, provider: "never")
    assert "ANTHROPIC_API_KEY" not in os.environ
    monkeypatch.setenv("ANTHROPIC_KEY_PROVIDER", "travel-claims-dev-anthropic")
    asked: list[tuple[str, str]] = []
    load_vaulted_key(lambda workload, provider: asked.append((workload, provider)) or "sk-vault")
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-vault"
    assert asked == [("travel-claims-dev-app", "travel-claims-dev-anthropic")]
