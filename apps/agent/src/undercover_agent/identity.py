"""The agent's own identity towards the api on AWS: the api accepts the agent's machine token,
which AgentCore Identity fetches from its token vault through the agent's workload identity, so
the agent never holds the client's secret and no shared key crosses the network."""

import threading
import time
from collections.abc import Callable
from typing import Any, cast

# Cognito's tokens last an hour; take a new one well before that.
REUSE_SECONDS = 50 * 60


class VaultToken:
    """The agent's machine token for the api, reused until shortly before it expires."""

    def __init__(
        self,
        workload: str,
        provider: str,
        scope: str,
        client: Any,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._workload = workload
        self._provider = provider
        self._scope = scope
        self._client = client
        self._clock = clock
        self._lock = threading.Lock()
        self._token = ""
        self._until = 0.0

    def __call__(self) -> str:
        with self._lock:
            if not self._token or self._clock() >= self._until:
                workload = self._client.get_workload_access_token(workloadName=self._workload)
                reply = self._client.get_resource_oauth2_token(
                    workloadIdentityToken=workload["workloadAccessToken"],
                    resourceCredentialProviderName=self._provider,
                    scopes=[self._scope],
                    oauth2Flow="M2M",
                )
                self._token = str(reply["accessToken"])
                self._until = self._clock() + REUSE_SECONDS
            return self._token


def api_token(
    workload: str | None, provider: str | None, scope: str, region: str | None
) -> Callable[[], str] | None:
    """The machine token for the api when the agent's identity is set (AWS); none locally,
    where the agent sends its key."""
    if not workload or not provider:
        return None
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    client = cast(Any, boto3).client("bedrock-agentcore", region_name=region)
    return VaultToken(workload, provider, scope, client)
