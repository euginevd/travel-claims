# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the [README](../README.md#quick-start). Numbered across the file so reviews can cite them (features 12); the last column is the pull request that first built it.

| App | For | Link (locally) |
|---|---|---|
| [Project page](#project-page-home) | Anyone looking at the project | http://127.0.0.1:5172 |
| [Customer portal](#customer-portal-portal) | Customers (Oliver Grant) | http://127.0.0.1:5173 |
| [Handlers' dashboard](#handlers-dashboard-dashboard) | Handlers and senior handlers (Marcus, Dana Whitfield) | http://127.0.0.1:5174 |
| [AI assurance console](#ai-assurance-console-console) | AI engineers (Sam Carter) | http://127.0.0.1:5175 |

Each app has its own sign-in, token issuer and audience, a **Use test account** button and the Canopy design (#71, #72), and a **← Project** link back to the project page in its header and on its sign-in page.

## Project page (`home`)

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | One screen: a short brief, the three-minute captioned walkthrough video (one dark play button under it, a light control bar of its own instead of the browser's dark one) and a link to each app; the code on GitHub at the top and foot | Done | #38 |

## Customer portal (`portal`)

| # | Feature | Status | PR |
|---|---|---|---|
| 2 | **My claims**: only the customer's own claims, in progress and completed, each with its stage, the stage's usual time and a **Send it** link when something is asked for | Done | #37 |
| 3 | **Make a claim** in three steps, photo first: what happened, up to five receipts (JPEG, PNG or PDF, 5 MB each; an image too small or damaged to read is refused with a plain message, and one the model still can't open refers the claim to a person instead of stalling it), then check what the AI drafted; the customer's words stay the record. A document checklist per claim type, and saving to finish later | Done | #5 |
| 4 | **Rather just tell us?**: one sentence to the drafting assistant, which fills in the claim | Done | #71 |
| 5 | Receipts in another currency converted to US dollars, the original kept in the description and marked to check (spec 28) | Done | #72 |
| 6 | One-tap delayed-flight claims when the flight-status feed shows the flight qualifies | Done | #37 |
| 7 | A tracker per claim (received, checked, assessed, decided, paid) with a plain-English reason and an AI disclosure; upload each document asked for, ask a person to review any decision, and get paid to a PayID | Done | #37 |
| 8 | **Updates**: every email and text, each showing its first lines with a link to the claim, with filters (an outbox locally) | Done | #37 |
| 9 | **Wattle AI**: questions about the customer's cover, answered with the policy wording cited; cover per trip. Each answer is laid out as data, never markup: a one-line headline, up to three short points each citing a numbered source, and one most likely next question; on a claim's page it answers about that claim (only if it's the customer's own); the Wattle mark animates while it works. The AI engineers' Wattle in the console answers in the same shape | Done | #39 |
| 10 | Thumbs up or down on Wattle's answers and on each decision's explanation, with an optional comment (spec 21) | Done | #72 |

## Handlers' dashboard (`dashboard`)

| # | Feature | Status | PR |
|---|---|---|---|
| 11 | **Queue** that opens on what needs the handler, with screened claims flagged; the red team's attack claims are tagged as tests and kept out of what needs the handler; each claim is due ten business days after it was submitted, a seeded claim's clock starting on the day the queue was loaded, so a demo queue isn't overdue months later | Done | #2 |
| 12 | **Case brief**: stage tracker, the agent's recommendation, a checklist with a source on every line, the payout line by line, and what the hidden-instruction check found; while the agent works, one line with its latest step in plain words (the step-by-step trace is the AI assurance console's) | Done | #5 |
| 13 | **Sign off**, **send back** or **override** with a reason code; approvals under the approval limit pay at once, larger ones wait for a senior handler (spec 27) | Done | #2 |
| 14 | Ask the customer for documents, and send an AI-drafted letter after editing it | Done | #39 |
| 15 | **Similar claims**: up to five decided claims of the same type nearest in amount | Done | #72 |
| 16 | **Retry**: carry on a claim the agent stopped working | Done | #57 |
| 17 | **Pause payouts**: a senior handler stops every payment from the header | Done | #8 |
| 18 | **Dispatch**: a senior handler works the waiting queue with 1 to 25 claim agents at once | Done | #70 |
| 19 | **Settings** (senior handlers), in plain words: approval limit ($100 to $5,000), the AI improvement budget, the accuracy and decided-alone targets, claims worked at once; every change recorded | Done | #72 |
| 20 | **Wattle AI Copilot**, acting as the handler who asked: what needs me, a claim and its steps, the latest dispatch, payouts, settings, success criteria and policy lookups; sign-off, dispatch and send-back only after a confirm card; remembers the handler's preferences (never claim or customer data); shows each turn's steps, time and cost (spec 22, 23, 27) | Done | #7 |

## AI assurance console (`console`)

In the order of its menu: Evals, then Security, each section's pages left to right.

| # | Feature | Status | PR |
|---|---|---|---|
| 21 | **Scoreboard**, the console's home: the version in use's exam measure by measure, each score with its likely range (Wilson, 95%) and target; every version's exam on one chart; right decision by claim type, weakest first; any two runs compared claim by claim; practice runs by hand on the evaluation set (5 or 25 claims), the held-out exam left to improvement rounds; all runs tagged exam or practice with their round | Done | #9 |
| 22 | The judge's grade of each explanation against the handler's: 0 to 3, same grounds, same section (spec 24) | Done | #70 |
| 23 | **Success criteria** worked out in code, with the last 14 days live beside the exam: straight through and held-out accuracy against their objectives, and no payment over the limit without a person | Done | #72 |
| 24 | **Live**: the version in use's exam beside its live results; claims decided, straight through, cost, handler disagreement, referrals and flags, each marked when past its target; by version and by claim type; disagreements as a review queue, where **Add to evaluation set** turns an override or send-back into a labelled evaluation claim; customer feedback last | Done | #72 |
| 25 | **Improvement**: the improver proposes a new version (instructions, model, effort) from the practice run's misses and what earlier rounds tried and how their exams ended, an engineer approves it, and it's kept only if it's clearly better on a 25-claim held-out exam (at least 2 claims more on a measure, or over 10% cheaper), worse on nothing, and holds against the red team; otherwise "no clear difference" or rolled back. Each round shows its path, the change in one sentence, before and after, and claim by claim; the version in use with its exam score, how often the exam set was used, and a rollback to an earlier kept version with a reason on the record | Done | #9 |
| 26 | **Trace**: one claim's outcome, agent version, steps and model calls in one readable timeline, security checks and cost against the average live claim; it suggests the live claim with the most model calls, and every claim number on Detections, Red team and Live opens its trace | Done | #38 |
| 27 | **Posture**, Security's first page: a plain verdict, four figures (attacks stopped, risks tested by an attack, what fired on live claims, the payouts switch), defence in depth (which layer stopped each of the latest run's attacks, untested layers marked) and the gaps to close, most urgent first, all worked out in code from runs against the agent version in use | Done | |
| 28 | **Detections**: each control that fired on a live claim (hidden-instruction check, Bedrock guardrail, model refusal, payout held), once per claim, by period; each control's tile is also its filter | Done | |
| 29 | **Red team**: eight attacks made through the portal, each with what stopped it and what was paid, each run tagged with the claim agent version it attacked; then each OWASP risk for LLM and agentic apps with its control, the attacks that test it and how often it fired live; then what each agent could do if tricked and what stops it | Done | #8 |

Status: Planned, Next, Building, Done or Dropped (with the reason).
