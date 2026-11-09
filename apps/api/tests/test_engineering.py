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
