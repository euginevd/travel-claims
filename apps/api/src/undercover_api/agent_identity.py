"""The api's own identity towards the agent on AWS: AgentCore Runtime accepts only the
api's machine token, which AgentCore Identity fetches from its token vault through the api's
workload identity, so the api never holds the client's secret and AWS keeps no shared key.

BearerRuntime calls the runtime as boto3's invoke_agent_runtime would, but over HTTPS with that
token, since a runtime that checks tokens refuses AWS signatures."""

import base64
import io
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from http import HTTPStatus
from typing import Any, Protocol

# Cognito's tokens last an hour; take a new one well before that, and never later than five
# minutes before the token's own end, since the vault may hand back a token it already holds.
REUSE_SECONDS = 50 * 60
MARGIN_SECONDS = 5 * 60
# The runtime's answers to a token it won't take: worth one retry with a fresh token.
REFUSED = {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}


class Token(Protocol):
    """The machine token: the one in hand, or with `fresh` a new one in place of a refused one."""

    def __call__(self, fresh: bool = False) -> str: ...


class VaultToken:
    """The api's machine token for the agent's runtime, reused until shortly before it expires."""

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


class BearerRuntime:
    """invoke_agent_runtime over HTTPS with a bearer token; answers as boto3 does."""

    def __init__(self, token: Token, timeout: float) -> None:
        self._token = token
        self._timeout = timeout

    def invoke_agent_runtime(self, **call: Any) -> dict[str, Any]:
        arn = str(call["agentRuntimeArn"])
        region = arn.split(":")[3]
        url = (
            f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/"
            f"{urllib.parse.quote(arn, safe='')}/invocations?qualifier=DEFAULT"
        )
        headers = {
            "Content-Type": call.get("contentType", "application/json"),
            "Accept": call.get("accept", "application/json"),
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": call.get(
                "runtimeSessionId", f"undercover-{uuid.uuid4().hex}"
            ),
        }
        try:
            return self._send(url, call["payload"], headers, self._token())
        except urllib.error.HTTPError as error:
            if error.code not in REFUSED:
                raise
        # Refused at the door, so the agent did no work: one retry with a fresh token is safe.
        return self._send(url, call["payload"], headers, self._token(fresh=True))

    def _send(
        self, url: str, payload: bytes, headers: dict[str, str], token: str
    ) -> dict[str, Any]:
        request = urllib.request.Request(  # noqa: S310 - an https URL built from our own ARN
            url,
            data=payload,
            headers=headers | {"Authorization": f"Bearer {token}"},
            method="POST",
        )
        # nosemgrep: dynamic-urllib-use-detected - an https URL built from our own ARN
        with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
            return {"response": io.BytesIO(response.read())}


def bearer_runtime(workload: str, provider: str, scope: str, timeout: float) -> BearerRuntime:
    """The runtime client the api uses on AWS, with its token from the vault."""
    from undercover_api.aws import aws_client  # noqa: PLC0415 - only AWS needs it

    return BearerRuntime(
        VaultToken(workload, provider, scope, aws_client("bedrock-agentcore")), timeout
    )
