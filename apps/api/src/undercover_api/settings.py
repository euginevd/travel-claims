"""The api's settings, read from the environment and checked once at start-up."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the api reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = Field(min_length=1)
    environment: Literal["local", "dev", "prod"] = "local"
    undercover_api_key: SecretStr = Field(min_length=32)
    # The local sign-in stand-in issues tokens shaped like Cognito's; never on outside a laptop.
    local_sign_in: bool = False
    handler_password: SecretStr | None = None
    # Where ID tokens come from and who they are for: names, not secrets.
    token_issuer: str = "http://127.0.0.1:8000/api/dev"  # noqa: S105
    token_audience: str = "undercover-web"  # noqa: S105
    # Where seeding reads UnderCover's records: the repo's data/ folder.
    seed_data_dir: Path = Path("data")

    @model_validator(mode="after")
    def local_sign_in_stays_local(self) -> Self:
        """Refuse the sign-in stand-in anywhere but a laptop, and without its password."""
        if self.local_sign_in and self.environment != "local":
            raise ValueError("LOCAL_SIGN_IN may be true only when ENVIRONMENT is local")
        if self.local_sign_in and not self.handler_password:
            raise ValueError("LOCAL_SIGN_IN needs HANDLER_PASSWORD")
        return self


@lru_cache
def get_settings() -> Settings:
    """The settings from the environment, read once."""
    return Settings()  # pyright: ignore[reportCallIssue]
