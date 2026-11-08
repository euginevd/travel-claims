from fastapi.testclient import TestClient

from undercover_agent.server import app


def test_health_says_ok() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
