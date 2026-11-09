"""The agent's settings, read from the environment once and validated at start-up."""

import json
import os
from collections.abc import Callable
from functools import lru_cache
from typing import Any, Literal, Self, cast

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the agent reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    # Anthropic API locally, Bedrock on AWS (tier 2), where the model settings are Bedrock ids.
    model_provider: Literal["anthropic", "bedrock"] = "anthropic"
    anthropic_api_key: SecretStr | None = None
    anthropic_workspace_id: str | None = Field(default=None, min_length=1)
    aws_region: str | None = None
    # Tier 2: a Bedrock guardrail on every model call, when its ID is set.
    bedrock_guardrail_id: str | None = None
    bedrock_guardrail_version: str = "1"
    # Tier 2: sign calls to the context's IAM-only URL; trust Runtime's IAM check on /invocations.
    context_aws_auth: bool = False
    agentcore_runtime: bool = False
    undercover_api_key: SecretStr = Field(min_length=32)
    undercover_api: str = "http://127.0.0.1:8000"
    undercover_context: str = "http://127.0.0.1:8006/mcp"
    # psycopg's own form (postgresql://...), where the agent saves each claim's progress.
    checkpoint_database_url: SecretStr

    claim_model: str = "claude-sonnet-5-5"
    claim_effort: str = "medium"
    claim_max_tokens: int = 16_000
    screening_model: str = "claude-haiku-5-5"
    screening_effort: str = "low"
    screening_max_tokens: int = 2_000
    specialist_model: str = "claude-haiku-5-5"
    specialist_max_tokens: int = 3_000
    drafting_model: str = "claude-haiku-5-5"
    drafting_max_tokens: int = 2_000
    improver_model: str = "claude-sonnet-5-5"
    improver_max_tokens: int = 16_000
    model_timeout_seconds: float = 60.0
    model_retries: int = 2
    # The most model calls one attempt at a claim may make before it is referred.
    max_model_calls: int = 25

    @model_validator(mode="after")
    def provider_has_what_it_needs(self) -> Self:
        """The Anthropic API needs its key and workspace; Bedrock uses the role's credentials."""
        key = self.anthropic_api_key.get_secret_value() if self.anthropic_api_key else ""
        # The app secret's placeholders start SET-ME until a person fills them in.
        if self.model_provider == "anthropic" and (
            not key
            or not self.anthropic_workspace_id
            or "SET-ME" in key
            or "SET-ME" in self.anthropic_workspace_id
        ):
            raise ValueError(
                "MODEL_PROVIDER=anthropic needs ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID"
            )
        return self


def load_app_secret(fetch: Callable[[str], str] | None = None) -> None:
    """On AWS (tier 2), fill in settings from the JSON secret named by APP_SECRET; anything already
    in the environment wins. Off AWS there's no APP_SECRET and nothing happens."""
    name = os.environ.get("APP_SECRET")
    if not name:
        return
    values = json.loads((fetch or fetch_secret)(name))
    for key, value in values.items():
        os.environ.setdefault(str(key), str(value))


def fetch_secret(name: str) -> str:
    """A secret's value from Secrets Manager, with the role's credentials."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    client = cast(Any, boto3).client("secretsmanager")
    return str(client.get_secret_value(SecretId=name)["SecretString"])


@lru_cache
def get_settings() -> Settings:
    """The settings, read once."""
    load_app_secret()
    return Settings()  # pyright: ignore[reportCallIssue] - pydantic-settings fills them in
