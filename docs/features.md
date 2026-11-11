# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the [README](../README.md#quick-start). Numbered across the file so reviews can cite them (features 12); the last column is the pull request that first built it.

| App | For | Link (tier 1) |
|---|---|---|
| [Project page](#project-page-home) | Anyone looking at the project | http://127.0.0.1:5172 |
| [Customer portal](#customer-portal-portal) | Customers (Oliver Grant) | http://127.0.0.1:5173 |
| [Handlers' dashboard](#handlers-dashboard-dashboard) | Handlers and senior handlers (Marcus, Dana Whitfield) | http://127.0.0.1:5174 |
| [AI assurance console](#ai-assurance-console-console) | AI engineers (Sam Carter) | http://127.0.0.1:5175 |

Each app has its own sign-in, token issuer and audience, a **Use test account** button and the Canopy design (#71, #72).

## Project page (`home`)

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | One screen: a short brief, the three-minute captioned walkthrough video and a link to each app | Done | #38 |

## Customer portal (`portal`)

| # | Feature | Status | PR |
|---|---|---|---|
| 2 | **My claims**: only the customer's own claims, in progress and completed, each with its stage, the stage's usual time and a **Send it** link when something is asked for | Done | #37 |
| 3 | **Make a claim** in three steps, photo first: what happened, up to five receipts (JPEG, PNG or PDF, 5 MB each), then check what the AI drafted; the customer's words stay the record. A document checklist per claim type, and saving to finish later | Done | #5 |
| 4 | **Rather just tell us?**: one sentence to the drafting assistant, which fills in the claim | Done | #71 |
| 5 | Receipts in another currency converted to US dollars, the original kept in the description and marked to check (spec 28) | Done | #72 |
| 6 | One-tap delayed-flight claims when the flight-status feed shows the flight qualifies | Done | #37 |
| 7 | A tracker per claim (received, checked, assessed, decided, paid) with a plain-English reason and an AI disclosure; upload each document asked for, ask a person to review any decision, and get paid to a PayID | Done | #37 |
| 8 | **Updates**: every email and text, with filters (an outbox in tier 1) | Done | #37 |
| 9 | **Wattle AI**: questions about the customer's cover, answered with the policy wording cited; cover per trip | Done | #39 |
| 10 | Thumbs up or down on Wattle's answers and on each decision's explanation, with an optional comment (spec 21) | Done | #72 |

## Handlers' dashboard (`dashboard`)

| # | Feature | Status | PR |
|---|---|---|---|
| 11 | **Queue** that opens on what needs the handler, with screened claims flagged | Done | #2 |
| 12 | **Case brief**: stage tracker, the agent's recommendation, a checklist with a source on every line, the payout line by line, and the agent's activity live in plain words | Done | #5 |
| 13 | **Sign off**, **send back** or **override** with a reason code; approvals under the approval limit pay at once, larger ones wait for a senior handler (spec 27) | Done | #2 |
| 14 | Ask the customer for documents, and send an AI-drafted letter after editing it | Done | #39 |
| 15 | **Similar claims**: up to five decided claims of the same type nearest in amount | Done | #72 |
| 16 | **Retry**: carry on a claim the agent stopped working | Done | #57 |
| 17 | **Pause payouts**: a senior handler stops every payment from the header | Done | #8 |
| 18 | **Dispatch**: a senior handler works the waiting queue with 1 to 25 claim agents at once | Done | #70 |
| 19 | **Settings** (senior handlers): approval limit ($100 to $5,000), round spending limit, accuracy and straight-through objectives, agents at once; every change recorded | Done | #72 |
| 20 | **Wattle AI Copilot**, acting as the handler who asked: what needs me, a claim and its steps, the latest dispatch, payouts, settings, success criteria and policy lookups; sign-off, dispatch and send-back only after a confirm card; remembers the handler's preferences (never claim or customer data); shows each turn's steps, time and cost (spec 22, 23, 27) | Done | #7 |

## AI assurance console (`console`)

| # | Feature | Status | PR |
|---|---|---|---|
| 21 | **Scoreboard**: evaluation runs on the evaluation or held-out set, tiny (5 claims) or full (25), 1 to 25 agents at once, restart-safe, with scores and misses against the handlers' decisions | Done | #9 |
| 22 | The judge's grade of each explanation against the handler's: 0 to 3, same grounds, same section (spec 24) | Done | #70 |
| 23 | **Success criteria** worked out in code: straight through and held-out accuracy against their objectives, and no payment over the limit without a person | Done | #72 |
| 24 | **Trace**: any claim's steps, model calls, tokens and cost | Done | #38 |
| 25 | **Live**: straight through, handler disagreement, referrals, flags, cost and time by day, and customer feedback; **Add to evaluation set** turns an override or send-back into a labelled evaluation claim | Done | #72 |
| 26 | **Improvement**: the improver's prompt proposals, kept only if they score better and the red team still holds | Done | #9 |
| 27 | **Red team**: eight attacks against the agent, each mapped to the OWASP Top 10 for LLMs; **Threats**: each risk with its controls | Done | #8 |

## Behind every app

| # | Feature | Status | PR |
|---|---|---|---|
| 28 | The hidden-instruction check reads every claim and receipt first, on a separate model; a flagged claim goes to a handler unseen by the claim agent | Done | #2 |
| 29 | The claim agent with the context layer, specialists (document checker, duplicate receipts, medical reviewer), the customer's earlier claims and claim recovery (heartbeats, retry, a watchdog) | Done | #2 |
| 30 | Tier 2: the same apps serverless on AWS (spec 5) | Done, torn down to save cost | #46 |
| 31 | Tier 3: the same apps on EKS in a private network (spec 5) | Planned | |

Status: Planned, Next, Building, Done or Dropped (with the reason).
