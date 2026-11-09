"""The agent signs its calls to the context's IAM-only function URL (tier 2)."""

import httpx2
from botocore.credentials import ReadOnlyCredentials  # pyright: ignore[reportMissingTypeStubs]

from undercover_agent.aws_auth import LambdaUrlSigner

URL = "https://abc123.lambda-url.ap-southeast-2.on.aws/mcp"


def test_requests_are_signed_for_lambda_in_the_region() -> None:
    signer = LambdaUrlSigner(
        "ap-southeast-2", lambda: ReadOnlyCredentials("AKIDEXAMPLE", "secret", "token-1")
    )
    request = httpx2.Request("POST", URL, json={"jsonrpc": "2.0"})
    signed = next(signer.auth_flow(request))
    auth = signed.headers["Authorization"]
    assert auth.startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")
    assert "/ap-southeast-2/lambda/aws4_request" in auth
    assert signed.headers["X-Amz-Security-Token"] == "token-1"
    assert "X-Amz-Date" in signed.headers
