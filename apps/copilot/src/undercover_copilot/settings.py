"""The Copilot's settings, read from the environment once and validated at start-up."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the Copilot reads from its environment. It holds no api key of its own: it
    acts with the signed-in handler's token on every call."""

    model_config = SettingsConfigDict(extra="ignore")

    # Claude through the Anthropic API locally, or through Bedrock with the role's credentials
    # (stage 2); on Bedrock the model settings below are Bedrock model or inference profile ids.
    model_provider: Literal["anthropic", "bedrock"] = "anthropic"
    anthropic_api_key: SecretStr | None = None
    anthropic_workspace_id: str | None = Field(default=None, min_length=1)
    aws_region: str | None = None
    undercover_api: str = "http://127.0.0.1:8000"
    # psycopg's own form (postgresql://...), where conversations and their progress are kept.
    checkpoint_database_url: SecretStr

    copilot_model: str = "claude-sonnet-5-5"
    copilot_max_tokens: int = 8_000
    model_timeout_seconds: float = 60.0
    model_retries: int = 2
    # The most model calls one turn may make before the Copilot stops and says so.
    max_model_calls: int = 12

    @model_validator(mode="after")
    def provider_has_what_it_needs(self) -> Self:
        """The Anthropic API needs its key and workspace; Bedrock uses the role's credentials."""
        if self.model_provider == "anthropic" and not (
            self.anthropic_api_key and self.anthropic_workspace_id
        ):
            raise ValueError(
                "MODEL_PROVIDER=anthropic needs ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """The settings, read once."""
    return Settings()  # pyright: ignore[reportCallIssue] - pydantic-settings fills them in
