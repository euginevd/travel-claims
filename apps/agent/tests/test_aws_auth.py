"""The agent signs its calls to the context layer (tier 2): to AgentCore Gateway, or to the
context's IAM-only function URL."""

import httpx2
import pytest
from botocore.credentials import ReadOnlyCredentials  # pyright: ignore[reportMissingTypeStubs]

from undercover_agent.aws_auth import SigV4Signer

URL = "https://abc123.gateway.bedrock-agentcore.ap-southeast-2.amazonaws.com/mcp"


@pytest.mark.parametrize("service", ["bedrock-agentcore", "lambda"])
def test_requests_are_signed_for_the_service_in_the_region(service: str) -> None:
    signer = SigV4Signer(
        "ap-southeast-2", service, lambda: ReadOnlyCredentials("AKIDEXAMPLE", "secret", "token-1")
    )
    request = httpx2.Request("POST", URL, json={"jsonrpc": "2.0"})
    signed = next(signer.auth_flow(request))
    auth = signed.headers["Authorization"]
    assert auth.startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")
    assert f"/ap-southeast-2/{service}/aws4_request" in auth
    assert signed.headers["X-Amz-Security-Token"] == "token-1"
    assert "X-Amz-Date" in signed.headers
