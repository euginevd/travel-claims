"""The one place the api reaches AWS's SDK, used only on AWS: boto3 ships without type stubs,
so its untyped edges stay here."""

from typing import Any, cast


def aws_client(service: str, read_timeout: float | None = None) -> Any:
    """A boto3 client for the service, trying once when a read timeout is given."""
    import boto3  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]
    from botocore.config import Config  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

    if read_timeout is None:
        return cast(Any, boto3).client(service)
    config = cast(Any, Config)(
        connect_timeout=5, read_timeout=read_timeout, retries={"total_max_attempts": 1}
    )
    return cast(Any, boto3).client(service, config=config)
