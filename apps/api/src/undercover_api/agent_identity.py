"""The api's own identity towards the agent on AWS: AgentCore Runtime accepts only the
api's machine token, which AgentCore Identity fetches from its token vault through the api's
workload identity, so the api never holds the client's secret and AWS keeps no shared key.

BearerRuntime calls the runtime as boto3's invoke_agent_runtime would, but over HTTPS with that
token, since a runtime that checks tokens refuses AWS signatures."""

import io
import threading
import time
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from typing import Any

# Cognito's tokens last an hour; take a new one well before that.
REUSE_SECONDS = 50 * 60


class VaultToken:
    """The api's machine token for the agent's runtime, reused until shortly before it expires."""

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


class BearerRuntime:
    """invoke_agent_runtime over HTTPS with a bearer token; answers as boto3 does."""

    def __init__(self, token: Callable[[], str], timeout: float) -> None:
        self._token = token
        self._timeout = timeout

    def invoke_agent_runtime(self, **call: Any) -> dict[str, Any]:
        arn = str(call["agentRuntimeArn"])
        region = arn.split(":")[3]
        url = (
            f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/"
            f"{urllib.parse.quote(arn, safe='')}/invocations?qualifier=DEFAULT"
        )
        request = urllib.request.Request(  # noqa: S310 - an https URL built from our own ARN
            url,
            data=call["payload"],
            headers={
                "Authorization": f"Bearer {self._token()}",
                "Content-Type": call.get("contentType", "application/json"),
                "Accept": call.get("accept", "application/json"),
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": call.get(
                    "runtimeSessionId", f"undercover-{uuid.uuid4().hex}"
                ),
            },
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
