"""Real responses from the api, kept in apps/web/src/fixtures/ for the dashboard's tests to parse
with its schemas, so the two can't drift apart unseen.

Write them afresh with UPDATE_WEB_FIXTURES=1 uv run pytest apps/api/tests/test_web_contract.py;
otherwise this fails when a response's shape (its keys and value types) no longer matches the
committed copy.
"""

import json
import os
from pathlib import Path
from typing import Any, cast

from api_helpers import AGENT, DANA, PASSWORD, decide, line, payout
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[2] / "web" / "src" / "fixtures"
UPDATE = os.environ.get("UPDATE_WEB_FIXTURES") == "1"
SOURCE = {
    "file": "policy_wording.md",
    "system": "Published policy documents",
    "owner": "Legal",
    "reviewed": "2026-09-01",
}


def shape(value: Any) -> Any:
    """A value's keys and types, without its values: what the dashboard's schemas care about."""
    if isinstance(value, dict):
        fields = cast(dict[str, Any], value)
        return {key: shape(fields[key]) for key in sorted(fields)}
    if isinstance(value, list):
        items = cast(list[Any], value)
        return [shape(items[0])] if items else []
    return "null" if value is None else type(value).__name__


def keep(name: str, value: Any) -> None:
    path = FIXTURES / f"{name}.json"
    if UPDATE:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8", newline="\n")
        return
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert shape(value) == shape(committed), f"{path.name} is stale: set UPDATE_WEB_FIXTURES=1"


def step(client: TestClient, claim_id: str, kind: str, content: str, sources: list[Any]) -> None:
    response = client.post(
        f"/api/agent/claims/{claim_id}/steps",
        json={"thread_id": None, "kind": kind, "content": content, "sources": sources},
        headers=AGENT,
    )
    assert response.status_code == 201


def test_the_dashboards_fixtures_match_the_api(client: TestClient, dana: dict[str, str]) -> None:
    signed_in = client.post("/api/dev/sign-in", json={"email": DANA, "password": PASSWORD}).json()
    keep("sign-in", signed_in | {"id_token": "header.claims.signature"})
    keep("me", client.get("/api/me", headers=dana).json())
    keep("claims", client.get("/api/claims", headers=dana).json()[:3])
    keep("claim-waiting", client.get("/api/claims/CLM-1001", headers=dana).json())

    # Worked, with a check and a lookup recorded, then approved under the limit and paid.
    client.post("/api/claims/CLM-1001/work", headers=dana)
    step(client, "CLM-1001", "screening", "No instructions found.", [])
    step(client, "CLM-1001", "lookup", "Read policy wording section 10.", [SOURCE])
    keep("claim-in-progress", client.get("/api/claims/CLM-1001", headers=dana).json())
    keep("steps", client.get("/api/claims/CLM-1001/steps", headers=dana).json())
    worked = payout(client, "CLM-1001", "trip_delay", [line("Taxis", 80, kind="expense")])
    decide(client, "CLM-1001", "approve", worked["payout"])
    client.post(
        "/api/agent/claims/CLM-1001/payment", json={"amount": worked["payout"]}, headers=AGENT
    )
    keep("claim-paid", client.get("/api/claims/CLM-1001", headers=dana).json())

    # Approved over the limit: held, then sent back with a note.
    client.post("/api/claims/CLM-1003/work", headers=dana)
    over = payout(client, "CLM-1003", "emergency_medical", [line("Hospital", 3800, kind="expense")])
    decide(client, "CLM-1003", "approve", over["payout"])
    keep("claim-held", client.get("/api/claims/CLM-1003", headers=dana).json())
    sent = client.post("/api/claims/CLM-1003/send-back", json={"note": "Check"}, headers=dana)
    keep("claim-sent-back", sent.json())

    # Referred by the hidden-instruction check.
    client.post("/api/claims/CLM-1901/work", headers=dana)
    client.post(
        "/api/agent/claims/CLM-1901/decision",
        json={
            "decision": "refer",
            "payout": 0,
            "section": "Claims manual section 3",
            "reason": "The claim tells whoever handles it to approve it in full.",
            "maker": "hidden_instruction_check",
        },
        headers=AGENT,
    )
    keep("claim-screened", client.get("/api/claims/CLM-1901", headers=dana).json())

    keep("error-409", client.post("/api/claims/CLM-1001/work", headers=dana).json())
    keep(
        "error-422",
        client.post("/api/dev/sign-in", json={"email": "not-an-email", "password": "x"}).json(),
    )


def test_the_portals_fixtures_match_the_api(client: TestClient) -> None:
    body = {"email": "maya.patel@example.com", "password": PASSWORD, "role": "customer"}
    token = client.post("/api/dev/sign-in", json=body).json()["id_token"]
    maya = {"Authorization": f"Bearer {token}"}
    keep("my-profile", client.get("/api/my/profile", headers=maya).json())
    keep("my-policies", client.get("/api/my/policies", headers=maya).json())
    made = client.post(
        "/api/my/claims",
        json={
            "policy_id": "POL-2001",
            "claim_type": "trip_delay",
            "incident_date": "2026-06-17",
            "incident_location": "Rome, Italy",
            "summary": "Flight delayed overnight",
            "story": "My flight home was delayed overnight.",
            "items": [{"description": "Airport hotel", "category": "accommodation", "amount": 180}],
        },
        headers=maya,
    ).json()
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    with_receipt = client.post(
        f"/api/my/claims/{made['claim_id']}/receipts",
        files=[("files", ("r.png", png, "image/png"))],
        headers=maya,
    ).json()
    keep("my-claim", with_receipt)
    keep("my-claims", client.get("/api/my/claims", headers=maya).json())
