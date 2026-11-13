"""The AI engineers' console has its own issuer: only an engineer's token opens its routes, and
an engineer's token opens nothing else."""

from api_helpers import AGENT, OLIVER, sign_in
from fastapi.testclient import TestClient


def test_only_an_engineers_token_opens_the_engineers_routes(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    oliver = sign_in(client, OLIVER, role="customer")
    me = client.get("/api/engineering/me", headers=sam)
    assert me.json() == {
        "engineer_id": "ENG-01",
        "name": "Sam Carter",
        "role": "AI Engineer",
        "email": "sam.carter@undercover.example",
    }
    for headers in (dana, oliver, {}):
        assert client.get("/api/engineering/me", headers=headers).status_code == 401
    assert client.get("/api/engineering/me", headers=AGENT).status_code == 403


def test_an_engineers_token_opens_no_handler_or_customer_route(
    client: TestClient, sam: dict[str, str]
) -> None:
    assert client.get("/api/staff/claims", headers=sam).status_code == 401
    assert client.get("/api/customer/claims", headers=sam).status_code == 401


def test_the_test_engineer_signs_in_without_a_password(client: TestClient) -> None:
    signed = client.post("/api/engineering/dev/test-sign-in", json={"account": "engineer"})
    assert signed.status_code == 200
    assert (
        client.post("/api/engineering/dev/test-sign-in", json={"account": "senior"}).status_code
        == 404
    )


def test_threat_coverage_maps_risks_to_tests_for_engineers_only(
    client: TestClient, sam: dict[str, str], dana: dict[str, str]
) -> None:
    run = {
        "results": [
            {
                "attack_id": "RT-01",
                "name": "Instruction on a receipt",
                "technique": "Hidden text",
                "owasp": "LLM01, ASI01",
                "claim_id": "CLM-1001",
                "outcome": "Referred",
                "decided_by": "Hidden-instruction check",
                "paid": 0,
                "passed": True,
                "note": "Held.",
            }
        ]
    }
    assert client.put("/api/engineering/redteam", json=run, headers=sam).status_code == 200
    coverage = client.get("/api/engineering/threats", headers=sam).json()
    rows = {row["owasp"]: row for row in coverage["threats"]}
    assert rows["LLM01"]["attacks"][0]["passed"] is True
    assert rows["ASI01"]["atlas"] == "AML.T0051"
    assert rows["LLM03"]["attacks"] == []
    assert coverage["payouts"]["paused"] is False
    assert any(agent["agent"] == "Claim agent" for agent in coverage["agents"])
    assert client.get("/api/engineering/threats", headers=dana).status_code == 401
