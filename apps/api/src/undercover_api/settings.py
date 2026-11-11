"""The api's settings, read from the environment and checked once at start-up."""

import json
import os
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, Self, cast

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the api reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = Field(min_length=1)
    # No default: a deployment must say where it runs, so nothing local is on by accident.
    environment: Literal["local", "dev"]
    # The key the api and the agent share locally; none on AWS, where the agent sends its machine
    # token and the api reaches the agent through AgentCore Runtime.
    undercover_api_key: Annotated[SecretStr, Field(min_length=32)] | None = None
    # The local sign-in stand-in issues tokens shaped like Cognito's; never on outside a laptop.
    local_sign_in: bool = False
    handler_password: SecretStr | None = None
    # The AWS demo: test-account buttons signed in through Cognito, and the home page's counts.
    test_sign_in: bool = False
    # Where each audience's ID tokens come from and who they are for: names, not secrets.
    # Staff and customers have separate issuers (two Cognito user pools on AWS), so a
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
    # The agent: over HTTP locally, on AgentCore Runtime when its ARN is set (AWS).
    agent_url: str = "http://127.0.0.1:8080"
    agent_runtime_arn: str | None = None
    # On AWS: the runtime takes the api's machine token, which AgentCore Identity fetches from its
    # vault through this workload identity; the runtime is called with AWS signatures when unset.
    workload_name: str | None = None
    agent_token_provider: str | None = None
    agent_token_scope: str = "undercover-agent/invoke"  # noqa: S105 - a scope, not a secret
    # On AWS: the agent calls with a Cognito access token from this issuer and app client instead
    # of the key, which is then refused; unset locally, where the agent sends its key.
    agent_caller_issuer: str | None = None
    agent_caller_client: str | None = None
    # The claim agent's configuration version, named on every decision it makes.
    agent_version: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def local_things_stay_local(self) -> Self:
        """Refuse the sign-in stand-in anywhere but a laptop, and a plain-HTTP issuer there."""
        if self.local_sign_in and self.environment != "local":
            raise ValueError("LOCAL_SIGN_IN may be true only when ENVIRONMENT is local")
        if self.local_sign_in and not self.handler_password:
            raise ValueError("LOCAL_SIGN_IN needs HANDLER_PASSWORD")
        if self.local_sign_in and self.test_sign_in:
            raise ValueError("TEST_SIGN_IN is for AWS; locally the stand-in signs in")
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
        if self.undercover_api_key is None and not (
            self.agent_caller_issuer and self.agent_runtime_arn
        ):
            raise ValueError(
                "UNDERCOVER_API_KEY is needed unless AGENT_CALLER_ISSUER and AGENT_RUNTIME_ARN "
                "are set"
            )
        if self.agent_caller_issuer and not self.agent_caller_issuer.startswith("https://"):
            raise ValueError("AGENT_CALLER_ISSUER must be https")
        if self.agent_caller_issuer and not self.agent_caller_client:
            raise ValueError("AGENT_CALLER_ISSUER needs AGENT_CALLER_CLIENT")
        if len(set(issuers)) != len(issuers):
            raise ValueError("Staff, customers and engineers need separate token issuers")
        if len(set(audiences)) != len(audiences):
            raise ValueError("Staff, customers and engineers need separate token audiences")
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


@lru_cache
def get_settings() -> Settings:
    """The settings from the environment, read once."""
    load_app_secret()
    return Settings()  # pyright: ignore[reportCallIssue]
