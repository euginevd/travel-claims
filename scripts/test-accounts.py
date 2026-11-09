"""Gives each Cognito test account a password (spec 35), kept in a secret. Stdlib and the AWS CLI.

python3 scripts/test-accounts.py <store> <pool-id>=<email> [<pool-id>=<email> ...]

Each account's password is generated once and kept in the secret as {email: password}; the
account is set to that password, so it signs in without a reset. Run by Terraform's apply with
the deploy role; it prints emails, never passwords.
"""

import json
import os
import secrets
import shutil
import string
import subprocess
import sys
import tempfile

SYMBOLS = "!#%+-.=@^_"
LENGTH = 20


def aws(*args: str) -> subprocess.CompletedProcess[str]:
    """One AWS CLI call, with fixed arguments and no shell."""
    cli = shutil.which("aws") or sys.exit("The AWS CLI isn't installed")
    return subprocess.run([cli, *args], capture_output=True, text=True, check=False)  # noqa: S603


def password() -> str:
    """A password the pools' policy accepts: every kind of character, 20 long."""
    kinds = (string.ascii_lowercase, string.ascii_uppercase, string.digits, SYMBOLS)
    chars = [secrets.choice(kind) for kind in kinds]
    chars += [secrets.choice("".join(kinds)) for _ in range(LENGTH - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def with_file(values: object, call: list[str]) -> subprocess.CompletedProcess[str]:
    """Pass a secret through a private temporary file, so it's never on a command line."""
    handle, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(values, file)
        return aws(*[part.replace("{file}", f"file://{path}") for part in call])
    finally:
        os.remove(path)


def main(store: str, accounts: list[str]) -> None:
    got = aws(
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        store,
        "--query",
        "SecretString",
        "--output",
        "text",
    )
    if got.returncode != 0 and "ResourceNotFoundException" not in got.stderr:
        sys.exit(f"Couldn't read {store}: {got.stderr.strip()}")
    kept: dict[str, str] = json.loads(got.stdout or "{}") if got.returncode == 0 else {}
    pairs = [account.split("=", 1) for account in accounts]
    missing = [email for _, email in pairs if email not in kept]
    # Saved first, so an account never gets a password the secret doesn't hold.
    if missing:
        kept.update({email: password() for email in missing})
        call = ["secretsmanager", "put-secret-value", "--secret-id", store, "--secret-string"]
        put = with_file(kept, [*call, "{file}"])
        if put.returncode != 0:
            sys.exit(f"Couldn't write {store}: {put.stderr.strip()}")
    for pool, email in pairs:
        request = {
            "UserPoolId": pool,
            "Username": email,
            "Password": kept[email],
            "Permanent": True,
        }
        call = ["cognito-idp", "admin-set-user-password", "--cli-input-json", "{file}"]
        done = with_file(request, call)
        if done.returncode != 0:
            sys.exit(f"Couldn't set {email}'s password: {done.stderr.strip()}")
        print(f"{email}: ready")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
