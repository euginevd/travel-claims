"""Helpers shared by the api's tests."""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from undercover_api.settings import Settings

DATA = Path(__file__).resolve().parents[3] / "data"
AGENT_KEY = "k" * 64
PASSWORD = "local-test-password"
DANA = "dana.whitfield@undercover.example"
MARCUS = "marcus.oyelaran@undercover.example"


def make_settings(url: str, **changes: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": url,
        "environment": "local",
        "undercover_api_key": SecretStr(AGENT_KEY),
        "local_sign_in": True,
        "handler_password": SecretStr(PASSWORD),
        "seed_data_dir": DATA,
    }
    return Settings.model_validate(values | changes)


AGENT = {"X-API-Key": AGENT_KEY}


def sign_in(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/dev/sign-in", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['id_token']}"}


def start(client: TestClient, claim_id: str, thread_id: str = "thread-1") -> None:
    response = client.post(
        f"/api/agent/claims/{claim_id}/start", json={"thread_id": thread_id}, headers=AGENT
    )
    assert response.status_code == 200, response.text


def line(
    description: str,
    amount: float,
    *,
    kind: str = "item",
    quantity: int = 1,
    nights: int = 0,
    hours: float = 0,
) -> dict[str, Any]:
    return {
        "description": description,
        "amount": amount,
        "quantity": quantity,
        "kind": kind,
        "nights": nights,
        "hours": hours,
    }


def payout(
    client: TestClient,
    claim_id: str,
    benefit: str,
    lines: list[dict[str, Any]],
    paid_by_others: float = 0,
) -> dict[str, Any]:
    response = client.post(
        f"/api/agent/claims/{claim_id}/payout",
        json={"benefit": benefit, "lines": lines, "paid_by_others": paid_by_others},
        headers=AGENT,
    )
    assert response.status_code == 200, response.text
    return response.json()


def decide(client: TestClient, claim_id: str, decision: str, amount: float = 0) -> Any:
    return client.post(
        f"/api/agent/claims/{claim_id}/decision",
        json={
            "decision": decision,
            "payout": amount,
            "section": "Policy wording section 10",
            "reason": "The receipts support the claim under the plan's limits.",
            "decided_by": "UnderCover Agent v1",
        },
        headers=AGENT,
    )
