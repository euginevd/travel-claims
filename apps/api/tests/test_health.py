from fastapi.testclient import TestClient

from undercover_api.main import app


def test_health_says_ok() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
