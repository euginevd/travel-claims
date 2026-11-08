from api_helpers import OLIVER, sign_in
from fastapi.testclient import TestClient


def test_a_handler_finds_customers_by_part_of_a_name(
    client: TestClient, dana: dict[str, str]
) -> None:
    response = client.get("/api/staff/customers", params={"name": "grant"}, headers=dana)
    assert response.status_code == 200
    [oliver] = response.json()
    assert oliver["name"] == "Oliver Grant"
    assert oliver["claims"]
    assert set(oliver) == {"customer_id", "name", "claims"}


def test_a_name_needs_two_letters(client: TestClient, dana: dict[str, str]) -> None:
    response = client.get("/api/staff/customers", params={"name": "g"}, headers=dana)
    assert response.status_code == 422


def test_a_customer_cant_search_customers(client: TestClient) -> None:
    oliver = sign_in(client, OLIVER, "customer")
    response = client.get("/api/staff/customers", params={"name": "grant"}, headers=oliver)
    assert response.status_code == 401
