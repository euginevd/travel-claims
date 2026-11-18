# Plan: the walkthrough video, re-recorded

TODO item 23. Profile: prototype. A draft for the developer to change before recording.

## Goal

About 3½ minutes, with a voiceover and captions, on the project page and linked from the README. The story is **AI engineering and AI security together**: agents settle the routine claims, a person makes the call on the rest, and security is what lets the agents act, not a brake on them.

## How to record

- Record each segment on its own, so a retake costs one segment, then join them in the editor.
- A browser window at 1920×1080, zoom 100%, exported at 1600×900, the size the project page's player expects. Hide the bookmarks bar; one tab only.
- The voiceover goes on after, read from the script below over the cut. The captions file (`apps/home/media/walkthrough.en.vtt`) uses the same lines.
- Keep the poster: `apps/home/img/walkthrough-poster.jpg`, the agent team.

## Before recording, the same day

1. Reset the demo (dashboard, Settings, as Dana), so the queue starts fresh.
2. Turn the agent on and let it work three or four claims, so the Overview's cards say *Working* and the feed fills. Record the console segment within the hour, while they're still recent.
3. Run the red team from the console, so Posture shows a run from today: 27 of 27.
4. Have `04-injection-test-mara-lodge.png` and an honest receipt from `data/sample-receipts` ready on the desktop.

## Shot list

| # | Time | Screen | What happens | Voiceover |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Project page | The poster, then scroll to the architecture | "UnderCover is a team of AI agents that settles routine travel insurance claims in minutes, so people spend their time on the claims that need judgement." |
| 2 | 0:15–0:30 | GitHub, the README | Results table, then the security picture | "It runs on AWS with Bedrock and AgentCore. Every risk in the threat model has a control, and a red team attacks every agent." |
| 3 | 0:30–1:05 | Portal, as Oliver | Ask Wattle what the policy covers; make a claim from the honest receipt; check the draft and send it | "A customer asks Wattle, which answers from their own policy and cites it. A receipt is enough to start a claim: Wattle drafts it, the customer checks it and sends it." |
| 4 | 1:05–1:15 | Portal | Upload the injection receipt as a second claim | "This receipt hides an instruction for the AI. Watch what happens to it." |
| 5 | 1:15–1:55 | Dashboard, as Dana | Today's brief; the honest claim decided by the agent with its reasons and sources; the injected one referred by the instruction check; sign off a payout over the limit | "Handlers start from Today. The agent settled the honest claim and shows its reasons. The hidden instruction was caught before the agent ever read it, and the claim came to a person. Payouts over the limit always wait for a senior to sign off. Agents settle the routine; you make the call." |
| 6 | 1:55–2:25 | Console, Overview, as Sam | The agent team, then the live feed, then open one row's trace | "For AI engineers, the agent team: nine agents, each with its model, its work and its cost, and a live feed of what they're doing: tools called, the policy read, one agent asking another. Every step opens its trace, each model call and each cent." |
| 7 | 2:25–2:45 | Console, Evaluate | Scoreboard, then Compare models | "Every version is examined against claims experts' decisions, and models are compared on the same claims, so the cheapest model that meets the targets runs." |
| 8 | 2:45–3:20 | Console, Secure | Posture's verdict; Coverage across LLM 2026, Agentic 2026, MCP and MAESTRO; Defence in depth; then the red team's list | "Security is built in, not bolted on. Twenty-seven attacks hit every agent a customer or handler can reach, and every one was stopped. Each risk in OWASP's 2026 lists, the MCP Top 10 and MAESTRO's layers is mapped to its control and the attacks that test it, so an agent's freedom to act comes with the evidence it's safe to." |
| 9 | 3:20–3:35 | Console, Govern, Cost | Today against the budget, cost per claim | "And it's cheap to run: two to four cents of Claude a claim, against a daily budget that stops the agent on its own." |
| 10 | 3:35–3:45 | Project page | Back to the poster | "UnderCover: AI agents that act, people who decide, and security that makes both possible." |

## What I can script

The navigation in segments 3 to 9 can be driven by a Playwright script with pauses, so takes are identical and only the voiceover is read live. The developer records the screen; the script moves the mouse and types. Worth it if more than two retakes are likely.

## Decisions for the developer

1. Local or the AWS demo? Local works today; AWS needs the bootstrap redeployed and migrations 0018 and 0019 (TODO 1 and 2).
2. Your voice, or captions only as before?
3. Scripted (Playwright) or by hand?
