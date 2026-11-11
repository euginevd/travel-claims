# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. Ideas go in [TODO.md](../TODO.md). What each does is in [spec.md](spec.md); how it was built, in [status.md](status.md). Numbered across the file so reviews can cite them (features 12).

| App | For | Link (tier 1) |
|---|---|---|
| [Project page](#project-page-home) | Anyone looking at the project | http://127.0.0.1:5172 |
| [Customer portal](#customer-portal-portal) | Customers (Oliver Grant) | http://127.0.0.1:5173 |
| [Handlers' dashboard](#handlers-dashboard-dashboard) | Handlers and senior handlers (Marcus, Dana Whitfield) | http://127.0.0.1:5174 |
| [AI assurance console](#ai-assurance-console-console) | AI engineers (Sam Carter) | http://127.0.0.1:5175 |

Each app has its own sign-in, token issuer and audience, and a **Use test account** button.

## Project page (`home`)

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 1 | One screen: headline, a short brief and a link to each app (spec 17) | Done | #38, #72 |
| 2 | The three-minute captioned walkthrough video | Done | #72 |

## Customer portal (`portal`)

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 3 | **My claims**: only the customer's own claims, each with its stage and the stage's usual time, and a **Send it** link when something is asked for (spec 10, 11) | Done | #37, #71 |
| 4 | **Make a claim** in three steps: what happened, up to five receipts (JPEG, PNG or PDF, 5 MB each), then check what the AI drafted; the customer's words stay the record (spec 10) | Done | #37, #39 |
| 5 | **Rather just tell us?**: one sentence to the drafting assistant, which fills in the claim | Done | #71 |
| 6 | A document checklist per claim type, and saving a claim to finish later | Done | #37, #71 |
| 7 | Receipts in another currency converted to US dollars, the original kept in the description and marked to check (spec 28) | Done | #72 |
| 8 | One-tap delayed-flight claims when the flight-status feed shows the flight qualifies (spec 10) | Done | #37 |
| 9 | A tracker per claim (received, checked, assessed, decided, paid) with a plain-English reason and an AI disclosure (spec 11) | Done | #37 |
| 10 | Upload each document asked for, and ask a person to review any decision (spec 11) | Done | #37 |
| 11 | Payment to a PayID (spec 11) | Done | #37 |
| 12 | **Updates**: every email and text, with filters (an outbox in tier 1) | Done | #37, #71 |
| 13 | **Wattle AI**: questions about the customer's cover, answered with the policy wording cited | Done | #39 |
| 14 | Cover per trip, collapsible | Done | #71 |
| 15 | Thumbs up or down on Wattle's answers and on each decision's explanation, with an optional comment (spec 11, 21) | Done | #72 |

## Handlers' dashboard (`dashboard`)

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 16 | **Queue** that opens on what needs the handler, with screened claims flagged (spec 15) | Done | Status 5, 7 |
| 17 | **Case brief**: stage tracker, the agent's recommendation, a checklist with a source on every line and the payout line by line (spec 15) | Done | Status 7 |
| 18 | The agent's activity in plain words, live, in its own rail | Done | Status 5, 7 |
| 19 | **Sign off**, **send back**, or **override** with a reason code (spec 14, 15) | Done | Status 5, 7 |
| 20 | Ask the customer for documents, and send an AI-drafted letter after editing it (spec 15) | Done | #39 |
| 21 | Approvals under the approval limit pay at once; larger ones wait for a senior handler's sign-off (spec 14, 27) | Done | Status 3 |
| 22 | **Pause payouts**: a senior handler stops every payment from the header (spec 14) | Done | #32 |
| 23 | **Similar claims**: up to five decided claims of the same type nearest in amount, beside each claim (spec 15) | Done | #72 |
| 24 | **Dispatch**: a senior handler works the waiting queue with 1 to 25 claim agents at once (spec 15) | Done | #70 |
| 25 | **Retry**: carry on a claim the agent stopped working | Done | #57 |
| 26 | **Settings** (senior handlers): approval limit ($100 to $5,000), round spending limit, accuracy and straight-through objectives, agents at once; every change recorded (spec 14) | Done | #72 |
| 27 | **Wattle AI Copilot**: what needs me, the queue, a claim and its steps, the latest dispatch, the payouts switch, settings, success criteria, policy wording and claims manual lookups (spec 15) | Done | Status 8, #72 |
| 28 | The Copilot's actions (sign-off, dispatch, send-back) run only after the handler confirms on a card, as the handler who asked (spec 22, 27) | Done | Status 8, #72 |
| 29 | The Copilot remembers each handler's preferences (never claim or customer data), forgets them on request, and shows each turn's steps, time and cost (spec 23) | Done | #72 |

## AI assurance console (`console`)

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 30 | **Scoreboard**: evaluation runs on the evaluation or held-out set, tiny (5 claims) or full (25), 1 to 25 agents at once, restart-safe (spec 16) | Done | Status 7a |
| 31 | Each run's scores and misses against the handlers' decisions | Done | Status 7a |
| 32 | The judge's grade of each explanation against the handler's (0 to 3, same grounds, same section) (spec 16, 24) | Done | #70 |
| 33 | **Success criteria** worked out in code: straight through and held-out accuracy against their objectives, and no payment over the limit without a person | Done | #72 |
| 34 | **Trace**: any claim's steps, tokens and cost (spec 16) | Done | #38 |
| 35 | **Live**: straight through, handler disagreement, referrals, flags, cost and time by day, and customer feedback (spec 16) | Done | #72 |
| 36 | **Add to evaluation set**: an override or send-back from Live becomes a labelled evaluation claim | Done | #72 |
| 37 | **Improvement**: the improver's prompt proposals, kept only if they score better and the red team still holds (spec 16) | Done | Status 7a |
| 38 | **Red team**: eight attacks run against the agent, each mapped to the OWASP Top 10 for LLMs (spec 16) | Done | #39, #55 |
| 39 | **Threats**: threat coverage, each risk with its controls | Done | #38 |

## Behind every app

| # | Feature | Status | Plan or PR |
|---|---|---|---|
| 40 | The hidden-instruction check reads every claim and receipt first, on a separate model; a flagged claim goes to a handler unseen by the claim agent (spec 12) | Done | Status 4 |
| 41 | The claim agent with the context layer, specialists (document checker, duplicate receipts, medical reviewer) and the customer's earlier claims (spec 13) | Done | Status 2, 4, 9 |
| 42 | Claim recovery: heartbeats, retry and a watchdog | Done | #57 |
| 43 | The Canopy design system across all four apps | Done | #71, #72 |
| 44 | Tier 2: the same apps serverless on AWS (spec 5) | Done, torn down to save cost | #46 to #64, #66 |
| 45 | Tier 3: the same apps on EKS in a private network (spec 5) | Next: designed, not built | |

Status: Next, Building, Done or Dropped (with the reason).
