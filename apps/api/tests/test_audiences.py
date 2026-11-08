"""Staff and customers are separate audiences: separate issuers, keys and audiences, so one's
token is refused on the other's routes before any group check runs."""

import time
from typing import Any, cast

import jwt
import pytest
from api_helpers import DANA, MAYA, PASSWORD, make_settings, sign_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from undercover_api.local_sign_in import LocalIssuer

STAFF_ROUTES = [
    ("GET", "/api/staff/me"),
    ("GET", "/api/staff/claims"),
    ("GET", "/api/staff/claims/CLM-1001"),
    ("GET", "/api/staff/claims/CLM-1001/steps"),
    ("POST", "/api/staff/claims/CLM-1001/work"),
    ("POST", "/api/staff/claims/CLM-1003/sign-off"),
    ("POST", "/api/staff/claims/CLM-1003/send-back"),
    ("GET", "/api/staff/claims/CLM-1001/receipts/" + "0" * 32),
]
CUSTOMER_ROUTES = [
    ("GET", "/api/customer/profile"),
    ("GET", "/api/customer/policies"),
    ("GET", "/api/customer/claims"),
    ("GET", "/api/customer/claims/CLM-1001"),
    ("POST", "/api/customer/claims"),
]


def issuer(client: TestClient, audience: str) -> LocalIssuer:
    return cast(LocalIssuer, getattr(cast(FastAPI, client.app).state, f"{audience}_issuer"))


def token(signer: LocalIssuer, claims: dict[str, Any]) -> dict[str, str]:
    """A token signed with one issuer's own key, carrying the claims given."""
    now = int(time.time())
    body = {
        "sub": "s",
        "email_verified": True,
        "token_use": "id",
        "iat": now,
        "exp": now + 60,
    } | claims
    key = signer._key  # pyright: ignore[reportPrivateUsage]
    signed = jwt.encode(body, key, algorithm="RS256", headers={"kid": signer.key_id})
    return {"Authorization": f"Bearer {signed}"}


def call(client: TestClient, method: str, path: str, headers: dict[str, str]) -> int:
    body = {"note": "Check"} if path.endswith("send-back") else None
    return client.request(method, path, headers=headers, json=body).status_code


@pytest.mark.parametrize(("method", "path"), STAFF_ROUTES)
def test_a_customer_token_is_refused_on_every_staff_route(
    client: TestClient, method: str, path: str
) -> None:
    assert call(client, method, path, sign_in(client, MAYA, role="customer")) == 401


@pytest.mark.parametrize(("method", "path"), CUSTOMER_ROUTES)
def test_a_staff_token_is_refused_on_every_customer_route(
    client: TestClient, method: str, path: str
) -> None:
    assert call(client, method, path, sign_in(client, DANA)) == 401


def test_staff_claims_from_the_customer_key_are_refused(client: TestClient) -> None:
    """Right issuer name, audience and group for staff, but signed with the customer key."""
    staff = issuer(client, "staff")
    forged = token(
        issuer(client, "customer"),
        {
            "iss": staff.issuer,
            "aud": staff.audience,
            "email": DANA,
            "cognito:groups": ["handlers"],
        },
    )
    assert client.get("/api/staff/me", headers=forged).status_code == 401


def test_a_staff_signed_token_for_the_customer_audience_is_refused(client: TestClient) -> None:
    """Signed with the staff key but aimed at the customers' audience and group."""
    customer = issuer(client, "customer")
    aimed = token(
        issuer(client, "staff"),
        {
            "iss": customer.issuer,
            "aud": customer.audience,
            "email": MAYA,
            "cognito:groups": ["customers"],
        },
    )
    assert client.get("/api/customer/profile", headers=aimed).status_code == 401


def test_a_staff_token_with_the_customers_group_is_still_refused(client: TestClient) -> None:
    """The group check is defence in depth: a right-key staff token can't claim the customers'
    group to reach customer routes, and can't pass as staff without the handlers' group."""
    staff = issuer(client, "staff")
    claims = {"iss": staff.issuer, "aud": staff.audience, "email": DANA}
    wrong_group = token(staff, claims | {"cognito:groups": ["customers"]})
    assert client.get("/api/staff/me", headers=wrong_group).status_code == 403
    assert client.get("/api/customer/profile", headers=wrong_group).status_code == 401


def test_each_audience_signs_in_only_its_own_people(client: TestClient) -> None:
    staff = {"email": DANA, "password": PASSWORD}
    customer = {"email": MAYA, "password": PASSWORD}
    assert client.post("/api/staff/dev/sign-in", json=staff).status_code == 200
    assert client.post("/api/customer/dev/sign-in", json=customer).status_code == 200
    assert client.post("/api/staff/dev/sign-in", json=customer).status_code == 401
    assert client.post("/api/customer/dev/sign-in", json=staff).status_code == 401


def test_each_audience_publishes_its_own_key_set(client: TestClient) -> None:
    [staff] = client.get("/api/staff/dev/.well-known/jwks.json").json()["keys"]
    [customer] = client.get("/api/customer/dev/.well-known/jwks.json").json()["keys"]
    assert staff["kid"] != customer["kid"]
    assert staff["n"] != customer["n"]


def test_the_old_shared_paths_are_gone(client: TestClient) -> None:
    dana = sign_in(client, DANA)
    for path in ("/api/me", "/api/claims", "/api/my/profile"):
        assert client.get(path, headers=dana).status_code == 404
    assert (
        client.post("/api/dev/sign-in", json={"email": DANA, "password": PASSWORD}).status_code
        == 404
    )


def test_the_audiences_must_differ(database_url: str) -> None:
    with pytest.raises(ValidationError, match="separate token issuers"):
        make_settings(
            database_url,
            customer_token_issuer="http://127.0.0.1:8000/api/staff/dev",
        )
    with pytest.raises(ValidationError, match="separate token audiences"):
        make_settings(database_url, customer_token_audience="undercover-staff")


def test_both_issuers_must_be_https_outside_a_laptop(database_url: str) -> None:
    with pytest.raises(ValidationError, match="https"):
        make_settings(
            database_url,
            environment="dev",
            local_sign_in=False,
            staff_token_issuer="https://cognito-idp.example/staff",
            customer_token_issuer="http://cognito-idp.example/customer",
        )
