# Findings

Things found in AWS, the pipeline or the tools that we didn't expect, and what we changed. Newest last.

1. **An organisation-level Anthropic key needs a workspace** (2026-11-08). Impact: every API call was refused until a workspace was named. Action: `ANTHROPIC_WORKSPACE_ID` in `.env`, sent as the `anthropic-workspace-id` header by `models.py`.
2. **LangGraph's dependencies don't support Python 3.15 yet** (2026-11-08). Impact: `zstandard` has no 3.15 build. Action: Python 3.14 (decision 9).
3. **MCP's Python SDK 2.x renamed its API** (2026-11-08). Impact: `FastMCP` is now `MCPServer` and fields are snake_case (`read_only_hint`, `is_error`). Action: the context layer and the agent use the 2.x names.
4. **uv 0.13's images moved to Debian trixie** (2026-11-08). Impact: the `bookworm` tags don't exist, so image builds and the CI Python job failed. Action: build, runtime and CI images are the trixie ones, pinned by digest.
5. **The first live run matched the handlers on all five tiny claims** (2026-11-08). Impact: decisions and payouts agreed exactly, at about 2–4 cents a claim. Action: none; plan 2's evaluations will measure this on the whole sets.
