"""The Copilot's settings, read from the environment once and validated at start-up."""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the Copilot reads from its environment. It holds no api key of its own: it
    acts with the signed-in handler's token on every call."""

    model_config = SettingsConfigDict(extra="ignore")

    anthropic_api_key: SecretStr
    anthropic_workspace_id: str = Field(min_length=1)
    undercover_api: str = "http://127.0.0.1:8000"
    # psycopg's own form (postgresql://...), where conversations and their progress are kept.
    checkpoint_database_url: SecretStr

    copilot_model: str = "claude-sonnet-5-5"
    copilot_max_tokens: int = 8_000
    model_timeout_seconds: float = 60.0
    model_retries: int = 2
    # The most model calls one turn may make before the Copilot stops and says so.
    max_model_calls: int = 12


@lru_cache
def get_settings() -> Settings:
    """The settings, read once."""
    return Settings()  # pyright: ignore[reportCallIssue] - pydantic-settings fills them in
