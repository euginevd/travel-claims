"""Serve the context layer on the laptop: uv run -m undercover_context."""

import uvicorn

from undercover_context.server import PORT, build_app

if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=PORT)
