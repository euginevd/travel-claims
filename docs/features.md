# Features

The agreed features, by app, numbered so reviews can cite them (features 12). New requirements and known gaps start in [TODO.md](../TODO.md); the rules every feature keeps are in [spec.md](spec.md). PR is the pull request that first built it.

| App | For | Link (locally) |
|---|---|---|
| [Project page](#project-page-home) | Anyone looking at the project | http://127.0.0.1:5172 |
| [Customer portal](#customer-portal-portal) | Customers (Oliver Grant) | http://127.0.0.1:5173 |
| [Handlers' dashboard](#handlers-dashboard-dashboard) | Handlers and senior handlers (Marcus, Dana Whitfield) | http://127.0.0.1:5174 |
| [AI assurance console](#ai-assurance-console-console) | AI engineers (Sam Carter) | http://127.0.0.1:5175 |

Each app has its own sign-in, a **Use test account** button, the Canopy design (#71, #72) and a **← Project** link.

## Project page (`home`)

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | A short brief, the three-minute captioned walkthrough video and a link to each app and the code | Done | #38 |

## Customer portal (`portal`)

| # | Feature | Status | PR |
|---|---|---|---|
| 2 | **Claims** (side panel): the customer's own claims, in progress then done; each opens to where it stands, a tracker, what we need and, once decided, the reason (an approval in plain words) | Done | #37, #113 |
| 3 | **Make a claim by chat**, one question at a time, asking only what the records can't say, with up to five photos or files (unreadable ones refused or referred to a person). The trip is shown with *change*; the check card is edited in place; nothing is sent until the customer taps Send claim; saved to finish later | Done | #5, #113 |
| 4 | **Just tell Wattle**: typing trouble starts a claim, and the drafting assistant fills it in from the customer's words and files | Done | #71, #113 |
| 5 | Receipts in another currency converted to US dollars, the original kept and marked to check (spec 28) | Done | #72 |
| 6 | One-tap delayed-flight claims when the flight-status feed shows the flight qualifies | Done | #37 |
| 7 | A tracker per claim with a plain reason and AI disclosure; upload asked-for documents, ask for a person's review, get paid to a PayID | Done | #37 |
| 8 | **Messages** (side panel): every email and text, an email and its text as one, the newest three then the rest on a tap, a dot for anything new | Done | #37, #113 |
| 9 | **Wattle AI**: answers about the customer's cover or claim, citing the policy: a headline, up to three sourced points and one next question. The engineers' Wattle can put two agent versions side by side and lists what it read before answering | Done | #39, #113 |
| 10 | Thumbs up or down, with a comment, on Wattle's answers and each decision's explanation (spec 21) | Done | #72 |

## Handlers' dashboard (`dashboard`)

| # | Feature | Status | PR |
|---|---|---|---|
| 10a | **Chat-first portal**: Wattle is the home screen: a greeting, one dismissable news line, three suggestions and **At a glance** (claims, cover, getting paid), all from the customer's records. Wattle's answer names what to show and never changes anything (decision 53). **Home** returns to the start screen with the chat kept; **Settings** holds PayID, mobile and texts. Cover answers say *General information only; your policy wording decides* | Done | #113 |
| 11 | **Queue** opening on what needs the handler, screened claims flagged, red-team tests kept out; each claim due in ten business days | Done | #2 |
| 12 | **Case brief**: stage, the agent's recommendation, a sourced checklist, the payout line by line and the hidden-instruction check; the agent's latest step while it works | Done | #5 |
| 13 | **Sign off**, **send back** or **override** with a reason code; over the approval limit waits for a senior handler (spec 27) | Done | #2 |
| 14 | Ask the customer for documents, and send an AI-drafted letter after editing it | Done | #39 |
| 15 | **Similar claims**: up to five decided claims of the same type nearest in amount | Done | #72 |
| 16 | **Retry**: carry on a claim the agent stopped working | Done | #57 |
| 17 | **Pause payouts**: a senior handler stops every payment from the header | Done | #8 |
| 18 | **Dispatch**: a senior handler works the waiting queue with 1 to 25 claim agents at once | Done | #70 |
| 19 | **Settings** (senior handlers): approval limit ($100 to $5,000), improvement budget, targets and claims worked at once; every change recorded | Done | #72 |
| 20 | **Wattle AI Copilot**: answers as the handler who asked, acts only after a confirm card, and remembers preferences only (spec 22, 23, 27). Answers laid out like every Wattle's, with a card of what was checked or how the payout was worked out, from the claim's record; steps appear in turn | Done | #7, #113 |

## AI assurance console (`console`)

In menu order: Evals, then Security.

| # | Feature | Status | PR |
|---|---|---|---|
| 21 | **Scoreboard** (home): the version in use's exam with likely ranges and targets, every version on one chart, accuracy by claim type, and two runs compared | Done | #9 |
| 22 | The judge grades each explanation against the handler's, 0 to 3 (spec 24) | Done | #70 |
| 23 | **Success criteria** worked out in code, the last 14 days live beside the exam | Done | #72 |
| 24 | **Live**: live results against targets, by version and claim type; disagreements as a review queue that feeds the evaluation set | Done | #72 |
| 25 | **Improvement**: the improver proposes a new version, an engineer approves it, and it's kept only if clearly better on a 25-claim held-out exam; rollback with a reason | Done | #9 |
| 26 | **Trace**: one claim's steps, model calls, security checks and cost in one timeline; every claim number elsewhere opens it | Done | #38 |
| 27 | **Posture**: a plain verdict, four figures, defence in depth and the gaps to close, worked out in code | Done | #99 |
| 28 | **Detections**: each control that fired on a live claim, by period, each tile a filter | Done | #99 |
| 29 | **Red team**: eight attacks with what stopped each, the OWASP risks with their controls, and what each agent could do if tricked | Done | #8 |

Status: Planned, Next, Building, Done or Dropped (with the reason).
