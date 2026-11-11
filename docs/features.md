# Features

The agreed features in priority order; the agent adds a row when you approve one and updates its status with the work. Ideas go in [TODO.md](../TODO.md). What each does is in [spec.md](spec.md); how it was built, in [status.md](status.md).

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 1 | Customers' portal: claims photo first, with Wattle AI drafting, receipts and save to finish later (spec 10) | Done | #37, #39 |
| 2 | One-tap delayed-flight claims from the flight-status feed (spec 10) | Done | #37 |
| 3 | Claim tracker, plain-English reasons, documents asked for, review requests, PayID and Updates (spec 11) | Done | #37 |
| 4 | Hidden-instruction check before any model reads a claim (spec 12) | Done | Status 4 |
| 5 | Claim agent with the context layer, specialists and decision records (spec 13) | Done | Status 2, 4, 9 |
| 6 | Payments under the approval limit, senior sign-off above it, pause payouts (spec 14) | Done | Status 3, #32 |
| 7 | Handlers' dashboard: queue, case brief, sign-off, send back, override, AI-drafted letters (spec 15) | Done | Status 5, 7 |
| 8 | Copilot: the handler's chat agent with confirm cards, memory and cost per turn (spec 15) | Done | Status 8, #72 |
| 9 | Live dispatch of the waiting queue, 1 to 25 agents (spec 15) | Done | #70 |
| 10 | AI assurance console: evaluations, scores, misses, tokens and cost (spec 16) | Done | #38 |
| 11 | Judge of each explanation against the handler's (spec 16) | Done | #70 |
| 12 | Improver and red team (spec 16) | Done | Status 7a, #55 |
| 13 | Project page with the walkthrough video (spec 17) | Done | #38 |
| 14 | Canopy design system across all four apps | Done | #71, #72 |
| 15 | Business settings with every change recorded (spec 14) | Done | #72 |
| 16 | Success criteria on the Scoreboard and for the Copilot (spec 16) | Done | #72 |
| 17 | Customer feedback on answers and decisions (spec 11, 21) | Done | #72 |
| 18 | Similar claims on the case brief (spec 15) | Done | #72 |
| 19 | Live page: production disagreements, added to the evaluation set (spec 16) | Done | #72 |
| 20 | Receipts in another currency, converted and marked to check (spec 28) | Done | #72 |
| 21 | Claim recovery: heartbeats, retry, watchdog (status 14a) | Done | #57 |
| 22 | Tier 2 on AWS: serverless, Cognito, Bedrock, AgentCore, Supabase (spec 5) | Done | #46 to #64; torn down, #66 |
| 23 | Tier 3 on EKS (spec 5) | Next | designed, not built |

Status: Next, Building, Done or Dropped (with the reason).
