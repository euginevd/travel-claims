"""The agent's settings, read from the environment once and validated at start-up."""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the agent reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    anthropic_api_key: SecretStr
    anthropic_workspace_id: str = Field(min_length=1)
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
    model_timeout_seconds: float = 60.0
    model_retries: int = 2
    # The most model calls one attempt at a claim may make before it is referred.
    max_model_calls: int = 25


@lru_cache
def get_settings() -> Settings:
    """The settings, read once."""
    return Settings()  # pyright: ignore[reportCallIssue] - pydantic-settings fills them in
