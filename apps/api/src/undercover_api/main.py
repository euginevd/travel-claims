"""The api's FastAPI app."""

from fastapi import FastAPI

app = FastAPI(title="UnderCover api")


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Say the api is up."""
    return {"status": "ok"}
