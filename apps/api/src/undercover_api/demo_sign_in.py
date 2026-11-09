"""Stage 2's public demo (spec 35): the test-account buttons sign a fixed account in through its
Cognito pool with the password the apply keeps in Secrets Manager, so none reaches the browser."""

import json
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

from undercover_api.aws import aws_client
from undercover_api.models import SignIn
from undercover_api.settings import fetch_secret

UNAVAILABLE = "Sign-in isn't answering. Try again shortly."


class CognitoTestSignIn:
    """Signs a test account in with USER_PASSWORD_AUTH; the password never leaves the api."""

    def __init__(
        self, secret: str, fetch: Callable[[str], str] | None = None, cognito: Any = None
    ) -> None:
        self.secret = secret
        self.fetch = fetch or fetch_secret
        self.cognito = cognito

    def sign_in(self, email: str, client_id: str) -> SignIn:
        """The account's Cognito ID token; read the secret each time, so a reset password works."""
        try:
            passwords: dict[str, str] = json.loads(self.fetch(self.secret))
        except Exception:  # noqa: BLE001 - the secret's error may name it; say only that it failed
            raise HTTPException(503, UNAVAILABLE) from None
        password = passwords.get(email)
        if not password:
            raise HTTPException(404, "No such test account")
        try:
            self.cognito = self.cognito or aws_client("cognito-idp")
            answer = self.cognito.initiate_auth(
                AuthFlow="USER_PASSWORD_AUTH",
                ClientId=client_id,
                AuthParameters={"USERNAME": email, "PASSWORD": password},
            )
        except Exception:  # noqa: BLE001 - Cognito's error may echo the request; keep it out
            raise HTTPException(503, UNAVAILABLE) from None
        result: dict[str, Any] = answer.get("AuthenticationResult") or {}
        token = result.get("IdToken")
        if not isinstance(token, str):
            raise HTTPException(503, UNAVAILABLE)
        return SignIn(id_token=token, expires_in=int(result.get("ExpiresIn", 3600)))
