"""The agent's HTTP server, which the api calls to start or resume work on a claim."""

from fastapi import FastAPI

app = FastAPI(title="UnderCover agent")


@app.get("/health", operation_id="health")
def health() -> dict[str, str]:
    """Say the agent is up."""
    return {"status": "ok"}
