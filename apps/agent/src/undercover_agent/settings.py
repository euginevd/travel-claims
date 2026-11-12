"""The agent's settings, read from the environment once and validated at start-up."""

import json
import os
from collections.abc import Callable
from functools import lru_cache
from typing import Annotated, Any, Literal, Self, cast

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Everything the agent reads from its environment."""

    model_config = SettingsConfigDict(extra="ignore")

    # Anthropic API locally, Bedrock on AWS, where the model settings are Bedrock ids.
    model_provider: Literal["anthropic", "bedrock"] = "anthropic"
    anthropic_api_key: SecretStr | None = None
    anthropic_workspace_id: str | None = Field(default=None, min_length=1)
    aws_region: str | None = None
    # On AWS: a Bedrock guardrail on customer text before any model reads it, when its ID is set.
    bedrock_guardrail_id: str | None = None
    bedrock_guardrail_version: str = "1"
    # On AWS: Ask UnderCover's answers checked against what it read, and letters and drafts
    # checked for card, bank, tax and identity numbers, before anyone sees them, when set.
    bedrock_answer_guardrail_id: str | None = None
    bedrock_answer_guardrail_version: str = "1"
    bedrock_letter_guardrail_id: str | None = None
    bedrock_letter_guardrail_version: str = "1"
    # On AWS: Ask UnderCover's answers checked against the wording's rules (Automated Reasoning).
    bedrock_reasoning_guardrail_id: str | None = None
    bedrock_reasoning_guardrail_version: str = "1"
    # On AWS: sign calls to the context's IAM-only URL; trust Runtime's IAM check on /invocations.
    context_aws_auth: bool = False
    # The service the signature is for: bedrock-agentcore through Gateway, lambda to the URL.
    context_aws_service: Literal["bedrock-agentcore", "lambda"] = "lambda"
    # Gateway names each tool after its target (context___get_claim_rules); none locally.
    context_tool_prefix: str = ""
    # On AWS: the customers' memory on AgentCore Memory when set; the Postgres store otherwise.
    memory_id: str | None = None
    # On AWS: Ask UnderCover searches the wording in this Knowledge Base; the context otherwise.
    knowledge_base_id: str | None = None
    # On AWS: receipts read into fields before any model sees them, by Bedrock Data Automation or
    # Amazon Textract (decisions 48 and 49); none, they reach Claude as images.
    receipt_reader: Literal["none", "data-automation", "textract"] = "none"
    # Data Automation's project (made by the agent unit) and its cross-Region profile.
    data_automation_project_arn: str | None = None
    data_automation_profile: str = "apac.data-automation-v1"
    # On AWS: lookup programs on this AgentCore Code Interpreter, through the gateway; off unset.
    code_interpreter_id: str | None = None
    agentcore_runtime: bool = False
    # The key the api and the agent share locally. On Runtime with the machine token there's none:
    # the api calls through Runtime's token check, and the agent calls the api with its token.
    undercover_api_key: Annotated[SecretStr, Field(min_length=32)] | None = None
    # On AWS: the agent calls the api with a machine token, which AgentCore Identity fetches from
    # its vault through this workload identity; with the key above when unset (locally).
    workload_name: str | None = None
    api_token_provider: str | None = None
    api_token_scope: str = "undercover-api/agent"  # noqa: S105 - a scope, not a secret
    undercover_api: str = "http://127.0.0.1:8000"
    undercover_context: str = "http://127.0.0.1:8006/mcp"
    # Where the agent saves each claim's progress: DynamoDB on AWS (decision 30), else PostgreSQL
    # in psycopg's own form (postgresql://...), which also holds the customers' memory.
    checkpoint_table: str | None = None
    checkpoint_database_url: SecretStr | None = None

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
    judge_max_tokens: int = 1_000
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
        machine_token = self.workload_name and self.api_token_provider
        if self.undercover_api_key is None and not (self.agentcore_runtime and machine_token):
            raise ValueError(
                "UNDERCOVER_API_KEY is needed unless on Runtime with WORKLOAD_NAME and "
                "API_TOKEN_PROVIDER"
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
