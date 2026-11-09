"""The api's settings, read from the environment and checked once at start-up."""

import json
import os
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Self, cast

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the api reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = Field(min_length=1)
    # No default: a deployment must say where it runs, so nothing local is on by accident.
    environment: Literal["local", "dev", "prod"]
    undercover_api_key: SecretStr = Field(min_length=32)
    # The local sign-in stand-in issues tokens shaped like Cognito's; never on outside a laptop.
    local_sign_in: bool = False
    handler_password: SecretStr | None = None
    # Where each audience's ID tokens come from and who they are for: names, not secrets.
    # Staff and customers have separate issuers (two Cognito user pools in stage 2), so a
    # token for one audience fails the other's signature and audience checks.
    staff_token_issuer: str = "http://127.0.0.1:8000/api/staff/dev"  # noqa: S105
    staff_token_audience: str = "undercover-staff"  # noqa: S105
    customer_token_issuer: str = "http://127.0.0.1:8000/api/customer/dev"  # noqa: S105
    customer_token_audience: str = "undercover-customer"  # noqa: S105
    # AI engineers have a third issuer: the console that changes how the agent behaves is kept
    # apart from the handlers' and customers' apps.
    engineering_token_issuer: str = "http://127.0.0.1:8000/api/engineering/dev"  # noqa: S105
    engineering_token_audience: str = "undercover-engineering"  # noqa: S105
    # Where seeding reads UnderCover's records: the repo's data/ folder.
    seed_data_dir: Path = Path("data")
    # Where receipts are kept: a Docker volume locally, a private S3 bucket when the bucket is set.
    receipts_dir: Path = Path("receipts")
    receipts_bucket: str | None = None
    # The agent's service, which the api asks to work or resume a claim: over HTTP locally, or
    # on AgentCore Runtime when its ARN is set (stage 2).
    agent_url: str = "http://127.0.0.1:8080"
    agent_runtime_arn: str | None = None
    # The claim agent's configuration version, named on every decision it makes.
    agent_version: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def local_things_stay_local(self) -> Self:
        """Refuse the sign-in stand-in anywhere but a laptop, and a plain-HTTP issuer there."""
        if self.local_sign_in and self.environment != "local":
            raise ValueError("LOCAL_SIGN_IN may be true only when ENVIRONMENT is local")
        if self.local_sign_in and not self.handler_password:
            raise ValueError("LOCAL_SIGN_IN needs HANDLER_PASSWORD")
        issuers = (
            self.staff_token_issuer,
            self.customer_token_issuer,
            self.engineering_token_issuer,
        )
        audiences = (
            self.staff_token_audience,
            self.customer_token_audience,
            self.engineering_token_audience,
        )
        if self.environment != "local" and not all(i.startswith("https://") for i in issuers):
            raise ValueError("Token issuers must be https outside ENVIRONMENT=local")
        if len(set(issuers)) != len(issuers):
            raise ValueError("Staff, customers and engineers need separate token issuers")
        if len(set(audiences)) != len(audiences):
            raise ValueError("Staff, customers and engineers need separate token audiences")
        return self


def load_app_secret(fetch: Callable[[str], str] | None = None) -> None:
    """On AWS (stage 2), fill in settings from the JSON secret named by APP_SECRET; anything already
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
    """The settings from the environment, read once."""
    load_app_secret()
    return Settings()  # pyright: ignore[reportCallIssue]
