"""Who is calling: the agent with its API key, or a handler with an ID token. Every route but
the health check and sign-in has exactly one of these gates, and anything else is refused."""

import logging
import secrets
from collections.abc import Iterator
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Connection, Engine, select

from undercover_api.db import handlers
from undercover_api.local_sign_in import LocalIssuer
from undercover_api.models import Handler

log = logging.getLogger(__name__)

AGENT_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
BEARER = HTTPBearer(auto_error=False)

NOT_SIGNED_IN = HTTPException(401, "Sign in first", headers={"WWW-Authenticate": "Bearer"})
KEY_IS_NOT_A_HANDLER = HTTPException(403, "The agent's key can't act as a handler")
NOT_THE_AGENT = HTTPException(403, "Only the agent may do this")
OVER_THE_LIMIT_ONLY = HTTPException(
    403, "Only a handler who can sign off over the approval limit may do this"
)


class KeySource(Protocol):
    """Where token signing keys come from: the local issuer or Cognito's key set."""

    def signing_key(self, token: str) -> Any: ...


class LocalKeys:
    def __init__(self, issuer: LocalIssuer) -> None:
        self._issuer = issuer

    def signing_key(self, token: str) -> Any:
        return jwt.PyJWK(self._issuer.public_jwk()).key


class RemoteKeys:
    """An issuer's key set at its well-known path, as Cognito serves it."""

    def __init__(self, issuer: str) -> None:
        self._client = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)

    def signing_key(self, token: str) -> Any:
        return self._client.get_signing_key_from_jwt(token).key


class TokenVerifier:
    """Checks an ID token's signature, issuer, audience, expiry and use."""

    def __init__(self, keys: KeySource, issuer: str, audience: str) -> None:
        self._keys = keys
        self._issuer = issuer
        self._audience = audience

    def email(self, token: str) -> str:
        try:
            claims = jwt.decode(
                token,
                self._keys.signing_key(token),
                algorithms=["RS256"],
                issuer=self._issuer,
                audience=self._audience,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWTError as error:
            log.info("token refused: %s", type(error).__name__)
            raise NOT_SIGNED_IN from error
        if claims.get("token_use") != "id" or not isinstance(claims.get("email"), str):
            raise NOT_SIGNED_IN
        return claims["email"]


def get_db(request: Request) -> Iterator[Connection]:
    """A connection in a transaction for one request, committed when it ends without error."""
    engine: Engine = request.app.state.engine
    with engine.begin() as connection:
        yield connection


Database = Annotated[Connection, Depends(get_db)]


def is_the_agent(request: Request, key: str | None) -> bool:
    """Whether the request carries the agent's key. A wrong key is refused outright."""
    if key is None:
        return False
    expected: str = request.app.state.settings.undercover_api_key.get_secret_value()
    if not secrets.compare_digest(key.encode(), expected.encode()):
        raise HTTPException(401, "The API key is wrong")
    return True


def require_agent(request: Request, key: Annotated[str | None, Depends(AGENT_KEY_HEADER)]) -> None:
    """Only the agent, with its key."""
    if not is_the_agent(request, key):
        raise NOT_THE_AGENT


def signed_in_handler(
    request: Request,
    db: Database,
    key: Annotated[str | None, Depends(AGENT_KEY_HEADER)],
    bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(BEARER)],
) -> Handler:
    """The handler signed in. The agent's key never stands in for one, whatever else it sends."""
    if key is not None:
        raise KEY_IS_NOT_A_HANDLER
    if bearer is None:
        raise NOT_SIGNED_IN
    verifier: TokenVerifier = request.app.state.verifier
    email = verifier.email(bearer.credentials)
    row = db.execute(select(handlers).where(handlers.c.email == email)).mappings().first()
    if row is None:
        raise HTTPException(403, "You aren't a claims handler")
    return Handler.model_validate(dict(row))


SignedIn = Annotated[Handler, Depends(signed_in_handler)]


def over_the_limit_handler(handler: SignedIn) -> Handler:
    """A handler who can sign off over the approval limit."""
    if not handler.can_approve_over_limit:
        raise OVER_THE_LIMIT_ONLY
    return handler


SeniorHandler = Annotated[Handler, Depends(over_the_limit_handler)]


def agent_or_handler(
    request: Request,
    db: Database,
    key: Annotated[str | None, Depends(AGENT_KEY_HEADER)],
    bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(BEARER)],
) -> None:
    """The agent with its key, or a signed-in handler."""
    if is_the_agent(request, key):
        return
    signed_in_handler(request, db, None, bearer)
