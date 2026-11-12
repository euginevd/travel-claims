# To do

1. Wattle AI, the handlers' Copilot (~1 to 1.5 h): the same layout as Ask UnderCover and the engineers' Wattle, a one-sentence headline, up to three short points citing their sources and one most likely next question, with its confirm cards still working.
2. Wattle AI, answer cards (~2 to 3 h): small cards built in code from real records, never by the model: a customer's claim and cover, what was checked for a handler, v3 against v2 for an engineer, and a payout breakdown.
3. Wattle AI, live progress (~1 h): a plain line for each step as it finishes, sent with the checked answer and shown in turn. Real streaming through AgentCore, Lambda and API Gateway later (~half a day, plus testing on AWS).
4. Wattle AI, tidy up: hold each point to its length in code if the model still writes long ones, and delete the mockup `docs/mockups/wattle.html` once built.
5. The project page's three-minute walkthrough, re-recorded once Wattle is done: it still shows the handlers' agent activity panel and the old Wattle answers.

## Notes

Your requirements, features and ideas, numbered, in your own words. The agent confirms with you before starting one, adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.
