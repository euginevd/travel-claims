"""Tier 2's public demo: the test-account buttons sign a fixed account in through
its Cognito pool. Each sign-in sets a fresh random password and uses it at once, so none is
stored."""

import secrets
import string
from typing import Any

from fastapi import HTTPException

from undercover_api.aws import aws_client
from undercover_api.models import SignIn

UNAVAILABLE = "Sign-in isn't answering. Try again shortly."
SYMBOLS = "!#%+-.=@^_"
KINDS = (string.ascii_lowercase, string.ascii_uppercase, string.digits, SYMBOLS)
LENGTH = 32


def one_time_password() -> str:
    """A password the pools' policy accepts: every kind of character, 32 long."""
    chars = [secrets.choice(kind) for kind in KINDS]
    chars += [secrets.choice("".join(KINDS)) for _ in range(LENGTH - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


class CognitoTestSignIn:
    """Sets the account's password, then signs in with it; tries twice, as two clicks can race."""

    def __init__(self, cognito: Any = None) -> None:
        self.cognito = cognito

    def sign_in(self, email: str, pool_id: str, client_id: str) -> SignIn:
        """The account's Cognito ID token."""
        for _ in range(2):
            password = one_time_password()
            try:
                self.cognito = self.cognito or aws_client("cognito-idp")
                self.cognito.admin_set_user_password(
                    UserPoolId=pool_id, Username=email, Password=password, Permanent=True
                )
                answer = self.cognito.initiate_auth(
                    AuthFlow="USER_PASSWORD_AUTH",
                    ClientId=client_id,
                    AuthParameters={"USERNAME": email, "PASSWORD": password},
                )
            except Exception:  # noqa: BLE001, S112 - Cognito's error may echo the request; keep it out
                continue
            result: dict[str, Any] = answer.get("AuthenticationResult") or {}
            token = result.get("IdToken")
            if isinstance(token, str):
                return SignIn(id_token=token, expires_in=int(result.get("ExpiresIn", 3600)))
        raise HTTPException(503, UNAVAILABLE)
