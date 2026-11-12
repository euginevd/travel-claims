"""Keeps an API key in AgentCore Identity's token vault, as an API key credential provider.

python3 scripts/api-key-provider.py <name> --from-env <VAR>
python3 scripts/api-key-provider.py --delete <name>

Creates the provider, or updates its key, from the environment variable (a GitHub secret), so the
key is never on a command line or in Terraform's state; the apps fetch it with their workload
identity. Run by Terraform's apply with the deploy role, through the AWS CLI; it prints only what
it did, never the key.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def aws(*args: str) -> subprocess.CompletedProcess[str]:
    """One AgentCore control call through the AWS CLI, with fixed arguments and no shell."""
    cli = shutil.which("aws") or sys.exit("The AWS CLI isn't installed")
    return subprocess.run(  # noqa: S603
        [cli, "bedrock-agentcore-control", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def with_request(command: str, request: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """A call whose JSON goes through a private temporary file, so the key is never an argument.
    (The CLI reads `file:///dev/stdin` as empty on GitHub's runners.)"""
    handle, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(request, file)
        return aws(command, "--cli-input-json", f"file://{path}")
    finally:
        os.remove(path)


def put(name: str, key: str) -> str:
    """Update the provider's key, or create the provider when it doesn't exist yet."""
    request = {"name": name, "apiKey": key}
    updated = with_request("update-api-key-credential-provider", request)
    if updated.returncode == 0:
        return "updated"
    if "ResourceNotFound" not in updated.stderr:
        sys.exit(f"Couldn't update {name}: {updated.stderr.strip()}")
    created = with_request("create-api-key-credential-provider", request)
    if created.returncode != 0:
        sys.exit(f"Couldn't create {name}: {created.stderr.strip()}")
    return "created"


def delete(name: str) -> None:
    """Remove the provider and its vaulted key; one already gone is fine."""
    gone = aws("delete-api-key-credential-provider", "--name", name)
    if gone.returncode != 0 and "ResourceNotFound" not in gone.stderr:
        sys.exit(f"Couldn't delete {name}: {gone.stderr.strip()}")
    print(f"{name}: deleted")


def main(args: list[str]) -> None:
    if args[0] == "--delete":
        delete(args[1])
        return
    name, flag, var = args
    if flag != "--from-env":
        sys.exit(__doc__)
    key = os.environ.get(var) or sys.exit(f"Set {var} (a GitHub secret) to use it")
    print(f"{name}: {put(name, key)}")


if __name__ == "__main__":
    main(sys.argv[1:])
