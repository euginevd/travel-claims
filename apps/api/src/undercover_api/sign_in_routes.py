"""Sign-in that stands in for Cognito: on the laptop, the local issuer signs seeded people in;
on the public AWS demo, fixed test accounts sign in through Cognito. Each audience (staff,
customers, AI engineers) has its own issuer, so its routes are built the same way from one
description of it."""

import secrets
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import Connection, Table, func, select

from undercover_api.auth import (
    CUSTOMERS_GROUP,
    ENGINEERS_GROUP,
    HANDLERS_GROUP,
    Database,
)
from undercover_api.db import customers, engineers, handlers
from undercover_api.demo_sign_in import CognitoTestSignIn
from undercover_api.local_sign_in import TOKEN_LIFETIME, LocalIssuer
from undercover_api.models import SignIn, SignInRequest, TestSignInRequest
from undercover_api.settings import Settings

# The only people the test buttons sign in as; no password reaches the browser.
STAFF_TEST_ACCOUNTS = {
    "senior": "dana.whitfield@undercover.example",
    "handler": "marcus.oyelaran@undercover.example",
}
# The public AWS demo offers the plain handler only: the senior handler signs off payouts, sets
# the approval limit, pauses payouts and overrides decisions, which no passer-by should do.
DEMO_STAFF_TEST_ACCOUNTS = {"handler": STAFF_TEST_ACCOUNTS["handler"]}
CUSTOMER_TEST_ACCOUNTS = {"customer": "oliver.grant@example.com"}
# The red team files its attack claims as its own customer, never a test customer people use.
REDTEAM_TEST_ACCOUNTS = {"attacker": "derek.vance@example.com"}
ENGINEERING_TEST_ACCOUNTS = {"engineer": "sam.carter@undercover.example"}


def no_extra() -> dict[str, tuple[dict[str, str], str]]:
    return {}


@dataclass(frozen=True)
class Audience:
    """One audience's sign-in: its name in paths and operation IDs, its people and group, and
    the test accounts offered on the laptop and on the AWS demo."""

    name: str
    op: str
    people: Table
    group: str
    test_accounts: dict[str, str]
    demo_accounts: dict[str, str]
    # Extra test-account routes, such as the red team's, by path: (accounts, operation ID part).
    extra: dict[str, tuple[dict[str, str], str]] = field(default_factory=no_extra)


STAFF = Audience(
    "staff", "staff", handlers, HANDLERS_GROUP, STAFF_TEST_ACCOUNTS, DEMO_STAFF_TEST_ACCOUNTS
)
CUSTOMER = Audience(
    "customer",
    "customer",
    customers,
    CUSTOMERS_GROUP,
    CUSTOMER_TEST_ACCOUNTS,
    CUSTOMER_TEST_ACCOUNTS,
    extra={"/redteam-sign-in": (REDTEAM_TEST_ACCOUNTS, "redteam_sign_in")},
)
ENGINEERING = Audience(
    "engineering",
    "engineer",
    engineers,
    ENGINEERS_GROUP,
    ENGINEERING_TEST_ACCOUNTS,
    ENGINEERING_TEST_ACCOUNTS,
)
AUDIENCES = (STAFF, CUSTOMER, ENGINEERING)


def check_local_password(settings: Settings, password: str) -> bool:
    """Whether the shared local password is right, compared in constant time."""
    expected = settings.handler_password.get_secret_value() if settings.handler_password else ""
    return secrets.compare_digest(password.encode(), expected.encode())


def known_email(db: Connection, email: str, people: Table) -> str | None:
    """The seeded email matching one given, ignoring case, or none."""
    found = db.execute(
        select(people.c.email).where(func.lower(people.c.email) == email.lower())
    ).scalar_one_or_none()
    return None if found is None else str(found).lower()


def issuer_of(request: Request, audience: Audience) -> LocalIssuer:
    issuer: LocalIssuer = getattr(request.app.state, f"{audience.name}_issuer")
    return issuer


def local_routes(audience: Audience) -> APIRouter:
    """The laptop's sign-in for one audience: the shared password, the test buttons and the
    issuer's public keys at the path Cognito uses."""
    router = APIRouter(prefix=f"/api/{audience.name}/dev")
    op = audience.op

    def sign_in(request: Request, body: SignInRequest, db: Database) -> SignIn:
        email = known_email(db, body.email, audience.people)
        right = check_local_password(request.app.state.settings, body.password)
        if email is None or not right:
            raise HTTPException(401, "The email or password is wrong")
        token = issuer_of(request, audience).issue(email, audience.group)
        return SignIn(id_token=token, expires_in=TOKEN_LIFETIME)

    def test_account(accounts: dict[str, str], missing: str) -> Any:
        def sign_in_as(request: Request, body: TestSignInRequest, db: Database) -> SignIn:
            email = accounts.get(body.account)
            if email is None or known_email(db, email, audience.people) is None:
                raise HTTPException(404, missing)
            token = issuer_of(request, audience).issue(email, audience.group)
            return SignIn(id_token=token, expires_in=TOKEN_LIFETIME)

        return sign_in_as

    def jwks(request: Request) -> dict[str, list[dict[str, Any]]]:
        return issuer_of(request, audience).jwks()

    router.add_api_route(
        "/sign-in",
        sign_in,
        methods=["POST"],
        operation_id=f"sign_in_{op}",
        summary=f"Sign a seeded {op} in with the shared local password; local only",
    )
    router.add_api_route(
        "/test-sign-in",
        test_account(audience.test_accounts, "No such test account"),
        methods=["POST"],
        operation_id=f"test_sign_in_{op}",
        summary="Sign in as a fixed test account; local only",
    )
    for path, (accounts, name) in audience.extra.items():
        router.add_api_route(
            path,
            test_account(accounts, "No such red-team account"),
            methods=["POST"],
            operation_id=f"{name}_{op}",
            summary="Sign in as the red team's attacker; local only, never offered in the app",
        )
    router.add_api_route(
        "/.well-known/jwks.json",
        jwks,
        methods=["GET"],
        operation_id=f"get_{audience.name}_jwks",
        summary="The issuer's public signing keys, at the path Cognito uses",
    )
    return router


def demo_routes(audience: Audience) -> APIRouter:
    """The AWS demo's sign-in for one audience: fixed test accounts, through Cognito. The pool's
    ID ends its issuer."""
    router = APIRouter(prefix=f"/api/{audience.name}/dev")
    op = audience.op

    def test_account(accounts: dict[str, str]) -> Any:
        def sign_in_as(request: Request, body: TestSignInRequest) -> SignIn:
            email = accounts.get(body.account)
            if email is None:
                raise HTTPException(404, "No such test account")
            settings: Settings = request.app.state.settings
            issuer = getattr(settings, f"{audience.name}_token_issuer")
            client_id = getattr(settings, f"{audience.name}_token_audience")
            signer: CognitoTestSignIn = request.app.state.test_sign_in
            return signer.sign_in(email, issuer.rsplit("/", 1)[-1], client_id)

        return sign_in_as

    router.add_api_route(
        "/test-sign-in",
        test_account(audience.demo_accounts),
        methods=["POST"],
        operation_id=f"demo_sign_in_{op}",
        summary="Sign in as a fixed test account, through Cognito",
    )
    for path, (accounts, name) in audience.extra.items():
        router.add_api_route(
            path,
            test_account(accounts),
            methods=["POST"],
            operation_id=f"demo_{name}_{op}",
            summary="Sign in as the red team's attacker, through Cognito; never offered in the app",
        )
    return router
