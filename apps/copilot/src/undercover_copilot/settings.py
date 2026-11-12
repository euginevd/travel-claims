"""The Copilot's settings, read from the environment once and validated at start-up."""

import json
import os
from collections.abc import Callable
from functools import lru_cache
from typing import Any, Literal, Self, cast

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the Copilot reads from its environment. It holds no api key of its own: it
    acts with the signed-in handler's token on every call."""

    model_config = SettingsConfigDict(extra="ignore")

    # Anthropic API locally, Bedrock on AWS, where the model settings are Bedrock ids.
    model_provider: Literal["anthropic", "bedrock"] = "anthropic"
    anthropic_api_key: SecretStr | None = None
    anthropic_workspace_id: str | None = Field(default=None, min_length=1)
    aws_region: str | None = None
    undercover_api: str = "http://127.0.0.1:8000"
    # The context layer's MCP url, for the policy wording and the claims manual.
    undercover_context: str = "http://127.0.0.1:8006/mcp"
    # On AWS: the context gateway's URL, from the app secret the agent unit fills; calls to it are
    # signed with the function's role and its tools are named context___<lookup>. Unset locally.
    context_gateway: str | None = None
    # Where conversations and their progress are kept: DynamoDB on AWS (decision 30), both tables
    # set; else PostgreSQL in psycopg's own form (postgresql://...).
    checkpoint_table: str | None = None
    copilot_table: str | None = None
    checkpoint_database_url: SecretStr | None = None

    copilot_model: str = "claude-sonnet-5-5"
    copilot_max_tokens: int = 8_000
    model_timeout_seconds: float = 60.0
    model_retries: int = 2
    # The most model calls one turn may make before the Copilot stops and says so.
    max_model_calls: int = 12

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
    """On AWS, fill in settings from the JSON parameter named by APP_SECRET; what is
    already in the environment wins. Off AWS there's no APP_SECRET and nothing happens."""
    name = os.environ.get("APP_SECRET")
    if not name:
        return
    values = json.loads((fetch or fetch_secret)(name))
    for key, value in values.items():
        os.environ.setdefault(str(key), str(value))


def fetch_secret(name: str) -> str:
    """The settings parameter's decrypted value from SSM, with the role's credentials."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    client = cast(Any, boto3).client("ssm")
    return str(client.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"])


def load_vaulted_key(fetch: Callable[[str, str], str] | None = None) -> None:
    """On AWS with the Anthropic API, the key from AgentCore Identity's token vault,
    fetched with this app's workload identity; it's in no shared settings. Off AWS, or on
    Bedrock, ANTHROPIC_KEY_PROVIDER is unset and nothing happens."""
    provider = os.environ.get("ANTHROPIC_KEY_PROVIDER")
    workload = os.environ.get("WORKLOAD_NAME")
    if not provider or not workload or os.environ.get("ANTHROPIC_API_KEY"):
        return
    os.environ["ANTHROPIC_API_KEY"] = (fetch or fetch_api_key)(workload, provider)


def fetch_api_key(workload: str, provider: str) -> str:
    """The provider's API key, through a workload access token for this app's identity."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    client = cast(Any, boto3).client("bedrock-agentcore")
    token = client.get_workload_access_token(workloadName=workload)["workloadAccessToken"]
    reply = client.get_resource_api_key(
        workloadIdentityToken=token, resourceCredentialProviderName=provider
    )
    return str(reply["apiKey"])


@lru_cache
def get_settings() -> Settings:
    """The settings, read once."""
    load_app_secret()
    load_vaulted_key()
    return Settings()  # pyright: ignore[reportCallIssue] - pydantic-settings fills them in
