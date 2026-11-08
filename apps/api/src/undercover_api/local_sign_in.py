"""The local sign-in stand-in: issues RS256 ID tokens shaped like Cognito's, signed with a key
made when the process starts, and serves the key set at the issuer's well-known path, as
Cognito does. Mounted only when LOCAL_SIGN_IN is on, which settings allow only locally."""

import json
import secrets
import time
import uuid
from typing import Any, cast

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

TOKEN_LIFETIME = 3600


class LocalIssuer:
    """A signing key for this process and the tokens it signs."""

    def __init__(self, issuer: str, audience: str) -> None:
        self.issuer = issuer
        self.audience = audience
        self.key_id = uuid.uuid4().hex
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def public_jwk(self) -> dict[str, Any]:
        jwk = cast(dict[str, Any], json.loads(RSAAlgorithm.to_jwk(self._key.public_key())))
        return jwk | {"kid": self.key_id, "use": "sig", "alg": "RS256"}

    def jwks(self) -> dict[str, list[dict[str, Any]]]:
        return {"keys": [self.public_jwk()]}

    def issue(self, email: str) -> str:
        """An ID token for a handler, with Cognito's claims."""
        issued = int(time.time())
        claims = {
            "iss": self.issuer,
            "aud": self.audience,
            "sub": str(uuid.uuid5(uuid.NAMESPACE_URL, email)),
            "email": email,
            "email_verified": True,
            "token_use": "id",
            "auth_time": issued,
            "iat": issued,
            "exp": issued + TOKEN_LIFETIME,
            "jti": secrets.token_hex(16),
        }
        return jwt.encode(claims, self._key, algorithm="RS256", headers={"kid": self.key_id})
