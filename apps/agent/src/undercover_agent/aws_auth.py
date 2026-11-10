"""Signs the agent's calls to the context layer with its AWS role (tier 2): to AgentCore Gateway,
or to the context's IAM-only function URL directly. botocore ships without type stubs, so its
untyped edges stay here."""

from collections.abc import Callable, Generator
from typing import Any, cast

import httpx2


def role_credentials() -> Any:
    """The role's current credentials, refreshed by botocore as they near expiry."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    return cast(Any, boto3).Session().get_credentials().get_frozen_credentials()


class SigV4Signer(httpx2.Auth):
    """AWS Signature Version 4 for one service: bedrock-agentcore for Gateway, lambda for a
    function URL with AWS_IAM auth."""

    requires_request_body = True

    def __init__(
        self, region: str, service: str, credentials: Callable[[], Any] = role_credentials
    ) -> None:
        self._region = region
        self._service = service
        self._credentials = credentials

    def auth_flow(self, request: httpx2.Request) -> Generator[httpx2.Request, httpx2.Response]:
        from botocore.auth import SigV4Auth  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]
        from botocore.awsrequest import AWSRequest  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

        headers = {"Host": request.url.host}
        if "Content-Type" in request.headers:
            headers["Content-Type"] = request.headers["Content-Type"]
        signed = cast(Any, AWSRequest)(
            method=request.method, url=str(request.url), data=request.content, headers=headers
        )
        cast(Any, SigV4Auth)(self._credentials(), self._service, self._region).add_auth(signed)
        for name in ("Authorization", "X-Amz-Date", "X-Amz-Security-Token"):
            if name in signed.headers:
                request.headers[name] = signed.headers[name]
        yield request
