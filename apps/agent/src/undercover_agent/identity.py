"""The agent's own identity towards the api on AWS: the api accepts the agent's machine token,
which AgentCore Identity fetches from its token vault through the agent's workload identity, so
the agent never holds the client's secret and no shared key crosses the network."""

import base64
import json
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol, cast

# Cognito's tokens last an hour; take a new one well before that, and never later than five
# minutes before the token's own end, since the vault may hand back a token it already holds.
REUSE_SECONDS = 50 * 60
MARGIN_SECONDS = 5 * 60


class Token(Protocol):
    """The machine token: the one in hand, or with `fresh` a new one in place of a refused one."""

    def __call__(self, fresh: bool = False) -> str: ...


class VaultToken:
    """The agent's machine token for the api, reused until shortly before it expires."""

    def __init__(
        self,
        workload: str,
        provider: str,
        scope: str,
        client: Any,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._workload = workload
        self._provider = provider
        self._scope = scope
        self._client = client
        self._clock = clock
        self._lock = threading.Lock()
        self._token = ""
        self._until = 0.0

    def __call__(self, fresh: bool = False) -> str:
        """The token, fetched again near its end, or when `fresh` because one was refused."""
        with self._lock:
            if fresh or not self._token or self._clock() >= self._until:
                self._fetch(force=fresh)
                if not fresh and self._clock() >= self._until:
                    # The vault handed back a token it held that's already near its end.
                    self._fetch(force=True)
            return self._token

    def _fetch(self, force: bool) -> None:
        workload = self._client.get_workload_access_token(workloadName=self._workload)
        call: dict[str, Any] = {
            "workloadIdentityToken": workload["workloadAccessToken"],
            "resourceCredentialProviderName": self._provider,
            "scopes": [self._scope],
            "oauth2Flow": "M2M",
        }
        if force:
            call["forceAuthentication"] = True
        self._token = str(self._client.get_resource_oauth2_token(**call)["accessToken"])
        # The wall clock, since the token's own end is one.
        self._until = self._clock() + REUSE_SECONDS
        expires = expiry(self._token)
        if expires is not None:
            self._until = min(self._until, expires - MARGIN_SECONDS)


def expiry(token: str) -> float | None:
    """The JWT's `exp`, read without checking its signature: only to know when to renew it."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        expires = claims["exp"]
    except IndexError, KeyError, TypeError, ValueError:
        return None
    if isinstance(expires, bool) or not isinstance(expires, int | float):
        return None
    return float(expires)


def api_token(
    workload: str | None, provider: str | None, scope: str, region: str | None
) -> Token | None:
    """The machine token for the api when the agent's identity is set (AWS); none locally,
    where the agent sends its key."""
    if not workload or not provider:
        return None
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    client = cast(Any, boto3).client("bedrock-agentcore", region_name=region)
    return VaultToken(workload, provider, scope, client)
