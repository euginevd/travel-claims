"""The Identity Center trigger: a federated person's groups become cognito:groups, kept to the
pool's own group; everyone else's token is untouched."""

import json
from typing import Any

import pytest

from undercover_api import sso_groups

IDENTITIES = json.dumps([{"providerName": "IdentityCenter", "providerType": "SAML"}])


@pytest.fixture(autouse=True)
def staff_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER", "IdentityCenter")
    monkeypatch.setenv("ALLOWED_GROUPS", "handlers")
    monkeypatch.setenv("GROUP_IDS", "9a1b-handlers-id=handlers, bad-pair ,=x")


def event(**attributes: str) -> dict[str, Any]:
    return {"request": {"userAttributes": attributes}, "response": {}}


def overridden(found: dict[str, Any]) -> list[str]:
    return found["response"]["claimsOverrideDetails"]["groupOverrideDetails"]["groupsToOverride"]


def test_a_federated_handler_gets_the_handlers_group_only() -> None:
    raw = "[handlers, engineers, finance]"
    found = sso_groups.handler(event(identities=IDENTITIES, **{"custom:groups": raw}), None)
    assert overridden(found) == ["handlers"]


def test_identity_center_group_ids_are_named() -> None:
    found = sso_groups.handler(
        event(identities=IDENTITIES, **{"custom:groups": "9a1b-handlers-id"}), None
    )
    assert overridden(found) == ["handlers"]


def test_a_federated_person_in_no_allowed_group_gets_none() -> None:
    found = sso_groups.handler(event(identities=IDENTITIES, **{"custom:groups": "[]"}), None)
    assert overridden(found) == []
    assert overridden(sso_groups.handler(event(identities=IDENTITIES), None)) == []


@pytest.mark.parametrize(
    "attributes",
    [
        {},
        {"identities": "not json"},
        {"identities": json.dumps({"providerName": "IdentityCenter"})},
        {"identities": json.dumps([{"providerName": "Other"}])},
        {"identities": json.dumps(["IdentityCenter"])},
    ],
)
def test_anyone_not_federated_is_left_as_they_are(attributes: dict[str, str]) -> None:
    found = sso_groups.handler(event(**attributes, **{"custom:groups": "handlers"}), None)
    assert found["response"] == {}
