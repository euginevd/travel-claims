# To do

1. Wattle AI, live progress for handlers and engineers (~1 h): a plain line for each step as it finishes, sent with the checked answer and shown in turn. Real streaming through AgentCore, Lambda and API Gateway later (~half a day, plus testing on AWS).
2. Wattle AI, tidy up: hold each point to its length in code if the model still writes long ones, and delete the mockup `docs/mockups/wattle.html` once built.
3. The project page's three-minute walkthrough, re-recorded once Wattle is done: it still shows the old portal pages, the handlers' agent activity panel and the old Wattle answers.
4. Red-team report refreshed (~10 min, a few cents): `docs/redteam-report.md` is from 8 November, before claim agent version 3; rerun `uv run -m undercover_agent.redteam` so it matches the console.
5. Permissions audit (~1 h), before any redeploy to AWS: narrow the bootstrap's deploy role, plan role and boundary to the actions the units and apps actually call (CloudTrail's event history and IAM Access Analyzer's policy generation show them), drop the AI and workflow services left unused, and remove the Checkov skips that cover the width ([decision 32](docs/decisions.md)).

## Notes

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.
