"""Fills the app secret's JSON (spec 37), never overwriting a value. Stdlib and the AWS CLI.

python3 scripts/fill-secret.py <secret-id> [KEY=VALUE ...]

Adds the agent's key (random) and SET-ME placeholders for the values only a person has, keeps
every value already set, and sets each KEY=VALUE given (such as the agent's runtime ARN). Run by
Terraform's apply with the deploy role; it prints only whether it changed anything.
"""

import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile

# Filled once and kept; a person overwrites the SET-ME ones in the console.
DEFAULTS = {
    "DATABASE_URL": "SET-ME: Supabase session pooler URL as postgresql+psycopg://",
    "CHECKPOINT_DATABASE_URL": "SET-ME: the same URL as postgresql://",
}


def aws(*args: str) -> subprocess.CompletedProcess[str]:
    """One Secrets Manager call through the AWS CLI, with fixed arguments and no shell."""
    cli = shutil.which("aws") or sys.exit("The AWS CLI isn't installed")
    command = [cli, "secretsmanager", *args]
    return subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603


def current(secret_id: str) -> dict[str, str]:
    """The secret's JSON, or nothing when it has no value yet."""
    got = aws(
        "get-secret-value", "--secret-id", secret_id, "--query", "SecretString", "--output", "text"
    )
    if got.returncode != 0:
        if "ResourceNotFoundException" in got.stderr:
            return {}
        sys.exit(f"Couldn't read {secret_id}: {got.stderr.strip()}")
    return json.loads(got.stdout or "{}")


def fill(values: dict[str, str], given: dict[str, str]) -> list[str]:
    """Add what's missing and what's given; the names changed."""
    changed = []
    wanted = {**DEFAULTS, "UNDERCOVER_API_KEY": secrets.token_hex(32)}
    for key, value in wanted.items():
        if key not in values:
            values[key] = value
            changed.append(key)
    for key, value in given.items():
        if values.get(key) != value:
            values[key] = value
            changed.append(key)
    return changed


def write(secret_id: str, values: dict[str, str]) -> None:
    """Put the JSON through a private temporary file, so it's never on a command line."""
    handle, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(values, file)
        put = aws("put-secret-value", "--secret-id", secret_id, "--secret-string", f"file://{path}")
        if put.returncode != 0:
            sys.exit(f"Couldn't write {secret_id}: {put.stderr.strip()}")
    finally:
        os.remove(path)


def main(secret_id: str, pairs: list[str]) -> None:
    given = dict(pair.split("=", 1) for pair in pairs)
    values = current(secret_id)
    changed = fill(values, given)
    if changed:
        write(secret_id, values)
    # Whether it changed, never which values: nothing drawn from the secret reaches the log.
    print(f"{secret_id}: {'updated' if changed else 'nothing to add'}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
