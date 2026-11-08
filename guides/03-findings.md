# Findings

A worked example: `travel-claims`. Things found in AWS, the pipeline or the tools that we didn't expect, and what we changed. Newest last.

1. **The chosen Claude model wasn't in the Australian inference profile** (2026-11-12). Impact: the first deploy of the agent failed. Action: switched to a model the profile supports, and recorded it in decision 9.
2. **HTTP API access logs need log-delivery permissions** (2026-11-14). Impact: the apply failed on the API stage. Action: added the log-delivery actions to the bootstrap stack's deploy role.
3. **The agent's Lambda package passed the 250 MB limit** (2026-11-18). Impact: the deploy was rejected. Action: moved LangGraph and its dependencies into a container image.
