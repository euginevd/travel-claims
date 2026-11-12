"""Cognito's pre-token-generation trigger for staff signed in through the company's Okta: their
Okta groups become the token's cognito:groups, kept to the one group the pool's app
checks. Anyone else's token is left as it is. Deployed alone as a Lambda function, so it uses the
standard library only.

Settings, from the identity unit: ALLOWED_GROUPS (the pool's group, such as handlers),
GROUP_IDS (optional, id=group pairs, for a provider that sends group IDs, not names) and
PROVIDER (the SAML identity provider's name in the pool)."""

import json
import os
from collections.abc import Mapping
from typing import Any, cast

GROUPS_ATTRIBUTE = "custom:groups"


def pairs(text: str) -> dict[str, str]:
    """Pairs written id=group,id=group, as the identity unit passes them."""
    found: dict[str, str] = {}
    for pair in text.split(","):
        key, _, value = pair.partition("=")
        if key.strip() and value.strip():
            found[key.strip()] = value.strip()
    return found


def values(raw: str) -> list[str]:
    """A multi-valued SAML attribute as Cognito stores it: "[a, b]", or a single value."""
    inner = raw.strip().removeprefix("[").removesuffix("]")
    return [value.strip() for value in inner.split(",") if value.strip()]


def federated(attributes: Mapping[str, str], provider: str) -> bool:
    """Whether the user signed in through the named identity provider."""
    try:
        identities = json.loads(attributes.get("identities") or "[]")
    except ValueError:
        return False
    if not isinstance(identities, list):
        return False
    return any(
        cast(dict[str, Any], identity).get("providerName") == provider
        for identity in cast(list[object], identities)
        if isinstance(identity, dict)
    )


def groups_for(
    attributes: Mapping[str, str], allowed: set[str], names: Mapping[str, str]
) -> list[str]:
    """The user's Okta groups, as names, kept to those allowed."""
    mapped = {names.get(value, value) for value in values(attributes.get(GROUPS_ATTRIBUTE, ""))}
    return sorted(mapped & allowed)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    """Cognito's event, with the groups overridden for a federated user only."""
    attributes: Mapping[str, str] = event["request"]["userAttributes"]
    if not federated(attributes, os.environ["PROVIDER"]):
        return event
    allowed = {group for group in os.environ["ALLOWED_GROUPS"].split(",") if group}
    kept = groups_for(attributes, allowed, pairs(os.environ.get("GROUP_IDS", "")))
    # No allowed group means an empty list, so the app refuses the person: it fails closed.
    override = {"groupOverrideDetails": {"groupsToOverride": kept}}
    event["response"]["claimsOverrideDetails"] = override
    return event
