"""Fills the app's SecureString parameter of JSON settings (decision 30), never overwriting a value.

python3 scripts/fill-secret.py <name> [KEY=VALUE ...] [--from-env NAME ...] [--remove NAME ...]
python3 scripts/fill-secret.py --delete <name>

Adds the agent's key (random) when missing, keeps every value already set, and sets each KEY=VALUE
given (such as the agent's runtime ARN), checking after each write that another unit didn't undo
it. Run by Terraform's apply with the deploy role, through the AWS CLI; it prints only whether it
changed anything. --from-env takes each value from the environment (such as an API key from a
GitHub secret), so it's never on a command line; --remove drops keys.
"""

import json
import os
import random
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

ATTEMPTS = 5


def aws(*args: str) -> subprocess.CompletedProcess[str]:
    """One SSM call through the AWS CLI, with fixed arguments and no shell."""
    cli = shutil.which("aws") or sys.exit("The AWS CLI isn't installed")
    return subprocess.run([cli, "ssm", *args], capture_output=True, text=True, check=False)  # noqa: S603


def current(name: str) -> dict[str, str]:
    """The parameter's JSON, or nothing when it doesn't exist yet."""
    got = aws(
        "get-parameter",
        "--name",
        name,
        "--with-decryption",
        "--query",
        "Parameter.Value",
        "--output",
        "text",
    )
    if got.returncode != 0:
        if "ParameterNotFound" in got.stderr:
            return {}
        sys.exit(f"Couldn't read {name}: {got.stderr.strip()}")
    return json.loads(got.stdout or "{}")


def fill(values: dict[str, str], given: dict[str, str], remove: tuple[str, ...] = ()) -> list[str]:
    """Add what's missing and what's given, and drop what's removed; the names changed."""
    changed = [key for key in remove if values.pop(key, None) is not None]
    if "UNDERCOVER_API_KEY" not in values:
        values["UNDERCOVER_API_KEY"] = secrets.token_hex(32)
        changed.append("UNDERCOVER_API_KEY")
    for key, value in given.items():
        if values.get(key) != value:
            values[key] = value
            changed.append(key)
    return changed


def write(name: str, values: dict[str, str]) -> None:
    """Put the JSON through a private temporary file, so it's never on a command line."""
    handle, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(values, file)
        put = aws(
            "put-parameter",
            "--name",
            name,
            "--type",
            "SecureString",
            "--overwrite",
            "--value",
            f"file://{path}",
        )
        if put.returncode != 0:
            sys.exit(f"Couldn't write {name}: {put.stderr.strip()}")
    finally:
        os.remove(path)


def delete(name: str) -> None:
    """Remove the parameter; one already gone is fine."""
    gone = aws("delete-parameter", "--name", name)
    if gone.returncode != 0 and "ParameterNotFound" not in gone.stderr:
        sys.exit(f"Couldn't delete {name}: {gone.stderr.strip()}")
    print(f"{name}: deleted")


def parse(args: list[str]) -> tuple[str, dict[str, str], tuple[str, ...]]:
    """The parameter's name, the values to set and the keys to remove."""
    given: dict[str, str] = {}
    remove: list[str] = []
    mode = "pairs"
    for arg in args[1:]:
        if arg in ("--from-env", "--remove"):
            mode = arg
        elif mode == "--from-env":
            given[arg] = os.environ.get(arg) or sys.exit(f"Set {arg} (a GitHub secret) to use it")
        elif mode == "--remove":
            remove.append(arg)
        else:
            key, value = arg.split("=", 1)
            given[key] = value
    return args[0], given, tuple(remove)


def main(args: list[str]) -> None:
    if args[0] == "--delete":
        delete(args[1])
        return
    name, given, remove = parse(args)
    # Units can write at once and the last write wins, so check ours survived and merge again.
    for _ in range(ATTEMPTS):
        values = current(name)
        if not fill(values, given, remove):
            # Whether it changed, never which values: nothing from the parameter reaches the log.
            print(f"{name}: up to date")
            return
        write(name, values)
        time.sleep(random.uniform(1, 3))  # noqa: S311 - spacing, not security
    sys.exit(f"{name}: another writer kept overwriting it")


if __name__ == "__main__":
    main(sys.argv[1:])
